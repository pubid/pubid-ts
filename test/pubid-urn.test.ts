import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadBundledCorpus } from "../src/corpus/artifact.js";
import {
  PREFIX,
  NULL,
  MAX_LENGTH,
  Decoder,
  Encoder,
  UrnParseError,
  InvalidInputError,
  decode as escapeDecode,
  encode as escapeEncode,
  force as escapeForce,
  define,
  flavorSchema,
  flavorSegment,
  generate,
  isPubidUrn,
  parse,
  splitToken,
  splitTop,
  structural,
  toSlug,
  fromSlug,
  typeSchemaOrThrow,
} from "../src/pubid-urn/index.js";
import type { CorpusCase } from "../src/corpus/types.js";
import { grammarImplementation } from "../src/flavors/index.js";

// The pubid-scheme URN contract (pubid-ts#161), the TS twin of the ruby
// spec/pubid/pubid_urn_contract_spec.rb, over the bundled corpus:
//   (a) EMIT parity: encode(hash) equals the ruby reference's URN,
//       byte-exactly, for every corpus row (committed fixture);
//   (b) ROUND-TRIP: decode(urn) rebuilds the hash;
//   (c) CANONICAL: parse(urn) rebuilds through fromHash and re-encodes
//       to exactly the input;
//   (d) INJECTIVE: two different hashes never share a URN;
//   (e) PATH-SAFE: only [A-Za-z0-9._~,()-] and ":", no empty segment;
//   (f) SLUG: toSlug/fromSlug round-trip.
// The official URN (toUrn()) is NOT under this contract: it may be lossy.

type Row = { id: string; urn: string };
type Fixture = {
  generatedFrom: { note: string };
  urns: Record<string, Record<string, string>>;
  hashOverrides: Record<string, Record<string, unknown>>;
};

const fixture: Fixture = JSON.parse(
  gunzipSync(readFileSync(new URL("../../test/fixtures/pubid-urn-parity.json.gz", import.meta.url)))
    .toString("utf8"),
);

/** Flavors whose identifier class is not ported yet (see
 *  scripts/probe-pubid-urn.mjs BUILD_PENDING): emit/decode/parity run,
 *  the canonical rebuild cannot until the model lands. */
const BUILD_PENDING = new Set(["ccsds"]);

/** Rows pending the rebuild on the port's own pinned quirks (the nist
 *  yaml-float wire quirk; see scripts/probe-pubid-urn.mjs). */
const REBUILD_PENDING = new Set([
  "nist.commercial_standard.1870",
  "nist.commercial_standard.1951",
  "nist.commercial_standard.2046",
  "nist.commercial_standard.2067",
  "nist.commercial_standard.2079",
  "nist.commercial_standard.2123",
]);

const canon = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(canon);
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node as object).sort()) {
      out[key] = canon((node as Record<string, unknown>)[key]);
    }
    return out;
  }
  return node;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const PATH_SAFE = /^urn:pubid:[A-Za-z0-9._~,()\-:]+$/;
const pathSafe = (urn: string) =>
  PATH_SAFE.test(urn) && !urn.includes("::") && !urn.endsWith(":");

const corpus = loadBundledCorpus();
const rowsByFlavor = new Map<string, CorpusCase[]>();
for (const [flavor, payloads] of corpus.flavors) {
  const rows = payloads.cases.filter((c) => c.identifier !== undefined && c.identifier !== null);
  if (rows.length > 0) rowsByFlavor.set(flavor, rows);
}

const fixtureFlavors = Object.keys(fixture.urns).sort();
const corpusFlavors = [...rowsByFlavor.keys()].sort();

test("the parity fixture covers exactly the corpus flavors", () => {
  assert.deepEqual(fixtureFlavors, corpusFlavors);
});

test("every corpus row is in the fixture and vice versa", () => {
  for (const flavor of corpusFlavors) {
    const fixtureIds = new Set(Object.keys(fixture.urns[flavor] ?? {}));
    const corpusIds = rowsByFlavor.get(flavor)!.map((r) => r.id);
    const extraFixture = [...fixtureIds].filter((id) => !corpusIds.includes(id));
    const missingFixture = corpusIds.filter((id) => !fixtureIds.has(id));
    assert.equal(
      extraFixture.length + missingFixture.length,
      0,
      `${flavor}: fixture-only ${extraFixture.slice(0, 3)}, corpus-only ${missingFixture.slice(0, 3)}`,
    );
  }
});

// The global injectivity map: one walk over the whole corpus.
const seen = new Map<string, string>();
const emitFailures: string[] = [];
const safeFailures: string[] = [];
const decodeFailures: string[] = [];
const canonicalFailures: string[] = [];
const slugFailures: string[] = [];
let checked = 0;

for (const flavor of corpusFlavors) {
  for (const row of rowsByFlavor.get(flavor)!) {
    const hash = (fixture.hashOverrides[row.id] ?? row.identifier) as Record<string, unknown>;
    const urn = generate(hash);
    checked += 1;

    // (a) EMIT parity — byte-exact against the ruby reference.
    const expected = fixture.urns[flavor]?.[row.id];
    if (expected !== urn) {
      emitFailures.push(`${row.id}: ${urn} != ruby ${expected}`);
      continue;
    }

    // (e) PATH-SAFE.
    if (!pathSafe(urn)) safeFailures.push(`${row.id}: not path-safe: ${urn}`);

    // (d) INJECTIVE.
    const key = JSON.stringify(canon(hash));
    const prior = seen.get(urn);
    if (prior !== undefined && prior !== key) {
      safeFailures.push(`${row.id}: collision on ${urn}`);
    } else {
      seen.set(urn, key);
    }

    // (b) ROUND-TRIP.
    let back: Record<string, unknown>;
    try {
      back = new Decoder(urn.slice(PREFIX.length)).toIdentifierHash();
    } catch (e) {
      decodeFailures.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!same(back, hash)) decodeFailures.push(`${row.id}: ${urn} rebuilt a different hash`);

    // (c)+(f) CANONICAL + SLUG — pending where noted above.
    if (BUILD_PENDING.has(flavor) || REBUILD_PENDING.has(row.id)) continue;
    try {
      const rebuilt = parse(urn);
      const reUrn = generate(rebuilt.toHash());
      if (reUrn !== urn) canonicalFailures.push(`${row.id}: non-canonical rebuild ${reUrn}`);
      const slug = toSlug(urn);
      if (generate(fromSlug(slug).toHash()) !== urn) {
        slugFailures.push(`${row.id}: slug ${slug} broke the round-trip`);
      }
    } catch (e) {
      canonicalFailures.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

test(`(a) every corpus row emits the ruby reference URN byte-exactly (${checked} rows)`, () => {
  assert.equal(emitFailures.length, 0, emitFailures.slice(0, 10).join("\n"));
});

test(`(d)+(e) every corpus URN is injective and path-safe`, () => {
  assert.equal(safeFailures.length, 0, safeFailures.slice(0, 10).join("\n"));
});

test(`(b) every corpus URN decodes back to its hash`, () => {
  assert.equal(decodeFailures.length, 0, decodeFailures.slice(0, 10).join("\n"));
});

test(`(c) every corpus URN rebuilds canonically through fromHash`, () => {
  assert.equal(canonicalFailures.length, 0, canonicalFailures.slice(0, 10).join("\n"));
});

test(`(f) every corpus slug round-trips`, () => {
  assert.equal(slugFailures.length, 0, slugFailures.slice(0, 10).join("\n"));
});

// --- the codec units ---------------------------------------------------------

test("the escape covers structure-shaped and multibyte values", () => {
  assert.equal(escapeEncode("9001"), "9001");
  assert.equal(escapeEncode("158:100"), "158~3A100"); // the IHO colon number
  assert.equal(escapeEncode("Publicly Available"), "Publicly~20Available");
  assert.equal(escapeForce("i"), "~69"); // "iec.is" -> "~69ec.is"
  assert.equal(escapeEncode("iec.is"), "iec.is"); // safe chars pass
  // Multibyte: one ~XX pair per UTF-8 byte, uppercase hex (easc Cyrillic).
  assert.equal(escapeForce("Ж"), "~D0~96");
  assert.equal(escapeDecode("~D0~96"), "Ж");
  // CJK: three bytes.
  assert.equal(escapeForce("版"), "~E7~89~88");
  assert.equal(escapeDecode("~E7~89~88"), "版");
  assert.equal(escapeDecode(escapeEncode("G.711 (2024)")), "G.711 (2024)");
  assert.throws(() => escapeDecode("a:b"), UrnParseError); // raw structure char
  assert.throws(() => escapeDecode("~d0"), UrnParseError); // lower-case escape
  assert.throws(() => escapeDecode("~D0~96~"), UrnParseError); // truncated
  // Invalid UTF-8 byte sequence.
  assert.throws(() => escapeDecode("~FF"), UrnParseError);
});

test("structural tokens read by shape, never by value", () => {
  assert.equal(structural("amd"), true);
  assert.equal(structural("amd-1"), true);
  assert.equal(structural("f"), true);
  assert.equal(structural("year"), true);
  assert.equal(structural("iec.is"), true); // another flavor's token
  assert.equal(structural("3gpp.ts"), true);
  assert.equal(structural("9001"), false); // digit-led number
  assert.equal(structural("802.11"), false); // no letter before the dot
  assert.equal(structural("G.711"), false); // upper-case lead
  assert.equal(structural("part-A"), true); // "part" then "-": the atom-prefix shape
});

test("splitTop respects brackets and refuses empty segments", () => {
  assert.deepEqual(splitTop("a:b:c", ":"), ["a", "b", "c"]);
  assert.deepEqual(splitTop("a:b(1:2):c", ":"), ["a", "b(1:2)", "c"]);
  assert.deepEqual(splitTop("x,y", ",", true), ["x", "y"]);
  assert.deepEqual(splitTop(",", ",", true), ["", ""]);
  assert.throws(() => splitTop("a:b(1:2", ":"), UrnParseError);
  assert.throws(() => splitTop("a:b)", ":"), UrnParseError);
  assert.throws(() => splitTop("a::b", ":"), UrnParseError);
});

test("the schema DSL validates names, kinds and uniqueness", () => {
  const s = define("testflavor", (schema) => {
    schema.atom("part", "part");
    schema.type("pubid:testflavor:standard", "std");
    schema.type("pubid:testflavor:report", "tr", { core: [] });
  });
  assert.equal(s.forToken("std")?.type, "pubid:testflavor:standard");
  assert.equal(s.forToken("std")?.core.length, 1);
  assert.equal(s.forToken("tr")?.core.length, 0);
  assert.throws(() => define("bad", (x) => x.atom("a", "Part")), /must match/);
  assert.throws(() => define("bad", (x) => x.atom("a", "part", "nope" as never)), /unknown atom kind/);
  assert.throws(
    () => define("bad", (x) => x.atom("a.*", "part", "int" as never)),
    /reads a list/,
  );
  assert.throws(() => define("bad", (x) => x.type("pubid:bad:f", "f")), /reserved or taken/);
  assert.throws(
    () =>
      define("bad", (x) => {
        x.atom("a", "dup");
        x.type("pubid:bad:t1", "t1");
        x.type("pubid:bad:t2", "t2", { atoms: [["b", "dup"]] });
      }),
    /repeats in pubid:bad:t2/,
  );
});

test("every declared flavor schema carries its types", () => {
  for (const flavor of fixtureFlavors) {
    const segment = flavorSegment(`pubid:${flavor === "cen_cenelec" ? "cencenelec" : flavor === "tgpp" ? "3gpp" : flavor}:x`);
    const schema = flavorSchema(segment ?? "");
    assert.notEqual(schema, undefined, `${flavor}: no schema for segment ${segment}`);
    assert.ok(schema!.types.size > 0, `${flavor}: no types`);
  }
});

test("the encoder refuses an unplaced key and a bad core kind", () => {
  assert.throws(
    () => generate({ _type: "pubid:iho:standard", number: "1", bogus: "x" }),
    InvalidInputError,
  );
  assert.throws(
    () => generate({ _type: "pubid:plateau:identifier", number: "1.5" }),
    /is not int/,
  );
  assert.throws(
    () => generate({ _type: "pubid:iho:standard", number: 42 }),
    /must be a non-empty String/,
  );
  assert.throws(() => generate({ number: "1" }), /identifier hash/);
});

test("parse enforces the canonical re-encode", () => {
  // Absent core in the middle must be "~", not an empty segment.
  assert.throws(() => parse("urn:pubid:iso:is:9001::year-2015"), UrnParseError);
  // Atoms out of schema order are rejected.
  assert.throws(
    () => parse("urn:pubid:iho:std:100:part-2:ed-1.0.0"),
    /out of order or repeated/,
  );
  // A non-canonical escape spelling is rejected.
  assert.throws(() => parse("urn:pubid:iho:std:158~3a100"), UrnParseError);
  // An unknown type token is rejected.
  assert.throws(() => parse("urn:pubid:iho:zz:1"), UrnParseError);
  // The facet marker as a node token is rejected.
  assert.throws(() => parse("urn:pubid:iso:f"), UrnParseError);
  // The type-metadata token is rejected.
  assert.throws(() => parse("urn:pubid:iso:type:x"), UrnParseError);
  // A bad boolean atom value is rejected.
  assert.throws(() => parse("urn:pubid:iso:is:1:undated-yes"), UrnParseError);
  // Unknown flavor namespace.
  assert.throws(() => parse("urn:pubid:nosuch:std:1"), UrnParseError);
  // Empty segment.
  assert.throws(() => parse("urn:pubid:iho::std:1"), UrnParseError);
  // Degenerate inputs wrap as pubid errors, never raw engine errors.
  assert.throws(() => parse(""), UrnParseError);
  assert.throws(() => parse("urn:iso:std:9001"), UrnParseError);
  assert.throws(() => parse("not-a-urn"), UrnParseError);
});

test("input guards: length and type", () => {
  assert.equal(MAX_LENGTH, 16000);
  assert.equal(isPubidUrn("URN:PUBID:iso:is:1"), true);
  assert.equal(isPubidUrn("urn:iso:std:1"), false);
  assert.throws(() => parse(`urn:pubid:iho:std:${"1".repeat(MAX_LENGTH)}`), InvalidInputError);
  assert.throws(() => toSlug(`urn:pubid:iho:std:${"1".repeat(MAX_LENGTH)}`), InvalidInputError);
  assert.throws(() => fromSlug("x".repeat(MAX_LENGTH + 1)), InvalidInputError);
});

test("nested identifiers ride brackets, facets ride the f group", () => {
  const member = { _type: "pubid:iso:international-standard", number: "9001" };
  const bundle = {
    _type: "pubid:iso:bundled-identifier",
    number: "210",
    supplements: [member, { ...member, year: "2015" }],
  };
  const urn = generate(bundle);
  assert.match(urn, /sups-\(iso:is:9001\),\(iso:is:9001:year-2015\)/);
  const back = new Decoder(urn.slice(PREFIX.length)).toIdentifierHash();
  assert.ok(same(back, bundle));

  const withFacet = {
    _type: "pubid:iso:international-standard",
    number: "9001",
    languages: [{ code: "en", original_code: "E" }],
  };
  const facetUrn = generate(withFacet);
  assert.match(facetUrn, /:lang-en:f:0\.langsrc-E$/);
  const facetBack = new Decoder(facetUrn.slice(PREFIX.length)).toIdentifierHash();
  assert.ok(same(facetBack, withFacet));
  // A list with an absent element keeps its slot.
  const spliced = generate({
    _type: "pubid:iso:international-standard",
    number: "1",
    languages: [{ code: "en" }, { code: "fr" }],
  });
  assert.ok(spliced.includes("lang-en,fr"));
  assert.equal(NULL, "~");
});

test("an id with its facets cut differs only in the f group", () => {
  const urn = generate({
    _type: "pubid:iso:international-standard",
    number: "9001",
    year: "2015",
    languages: [{ code: "en", original_code: "E" }],
  });
  const cut = urn.replace(/:f:.*$/, "");
  assert.notEqual(cut, urn);
  const back = new Decoder(cut.slice(PREFIX.length)).toIdentifierHash();
  assert.deepEqual(back["languages"], [{ code: "en" }]);
  assert.equal(back["year"], "2015");
});

test(`slug clothes: each ":" segment becomes a "/" segment`, () => {
  const urn = generate({ _type: "pubid:iho:standard", number: "100", edition: "1.0.0" });
  const slug = toSlug(urn);
  assert.equal(slug, "iho/std/100/ed-1.0.0");
  assert.ok(!slug.startsWith("/") && !slug.endsWith("/"));
  assert.throws(() => fromSlug("iho//std/100"), UrnParseError);
  assert.throws(() => fromSlug(""), UrnParseError);
  assert.throws(() => fromSlug("iso/is/9001:year"), UrnParseError); // a ":" is not path-safe
  // A slug of a URN whose value carries an escaped colon round-trips.
  const colonUrn = generate({ _type: "pubid:iho:standard", number: "158:100" });
  assert.equal(toSlug(colonUrn), "iho/std/158~3A100");
  assert.equal(generate(fromSlug(toSlug(colonUrn)).toHash()), colonUrn);
});

test("identifiers expose toPubidUrn and it round-trips through parse", () => {
  const impl = grammarImplementation("iso");
  assert.notEqual(impl, undefined);
  const id = impl!.parse("ISO/IEC 13818-1:2015");
  const urn = (id as unknown as { toPubidUrn(): string }).toPubidUrn();
  assert.match(urn, /^urn:pubid:iso:is:13818/);
  const back = parse(urn);
  assert.ok(same(back.toHash(), id.toHash()));
});

test("typeSchemaOrThrow names the gap loudly", () => {
  assert.throws(() => typeSchemaOrThrow("pubid:iho:no-such-type"), /no pubid URN schema/);
  assert.equal(typeSchemaOrThrow("pubid:iho:standard").token, "std");
  assert.deepEqual(splitToken("iec.is", "iso"), ["iec", "is"]);
  assert.deepEqual(splitToken("std", "iso"), ["iso", "std"]);
});

test("the encoder mutates a copy, never the caller's hash", () => {
  const hash = { _type: "pubid:iho:standard", number: "100", edition: "1.0.0" };
  const snapshot = JSON.stringify(canon(hash));
  generate(hash);
  assert.equal(JSON.stringify(canon(hash)), snapshot);
  new Encoder(hash).body();
  assert.equal(JSON.stringify(canon(hash)), snapshot);
});
