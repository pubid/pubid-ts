import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { euGrammarImplementation } from "../src/flavors/eu/index.js";
import { EuIdentifier } from "../src/flavors/eu/model.js";
import { grammarImplementation } from "../src/flavors/index.js";
import { subsetMatch } from "../src/model/subset-match.js";
import type { BaseIdentifier } from "../src/model/identifier.js";
import { generate as generateUrn, parse as parseUrn } from "../src/pubid-urn/index.js";

/**
 * The eu flavor (pubid#752, the gem flavor at 2.0.44): regulations,
 * directives and decisions of the Official Journal, in four forms —
 * canonical ("EU Regulation 1227/2011"), the Official-Journal long form
 * ("Regulation (EU) No 1227/2011"), CELEX ("32011R1227") and ELI
 * (https://data.europa.eu/eli/reg/2011/1227/oj). The number order is
 * spelling (number_first, equality-ignored); the renderer prints "No"
 * when the plain pair would read back as another act.
 *
 * Byte parity runs against the ruby-generated fixture
 * (test/fixtures/eu-arxiv-parity.json.gz, the output of
 * scripts/eu-arxiv-parity-ruby-probe.rb against the gem checkout); the
 * corpus gate loops the gem's generated fixtures
 * (test/fixtures/eu/identifiers/, copied byte-identical).
 */

const impl = euGrammarImplementation();

interface PassRow {
  input: string;
  rendered?: string;
  to_s?: string;
  hash?: Record<string, unknown>;
  pubid_urn?: string;
  urn?: string;
  bare?: string;
  celex?: string;
  eli?: string;
  family?: string | null;
  number_first?: boolean | null;
  rejects?: boolean;
}
interface FailRow {
  input: string;
  error: string;
  message: string;
}
interface SweepRow {
  input: string;
  hash: Record<string, unknown>;
  bare: string;
}
interface MatchRow {
  a: string;
  b: string;
  subset: boolean;
  eq: boolean;
}
interface ParityDoc {
  version: string;
  eu: { pass: PassRow[]; fail: FailRow[]; sweep: SweepRow[]; matches: MatchRow[] };
  arxiv: unknown;
}

const parity = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../../test/fixtures/eu-arxiv-parity.json.gz", import.meta.url)),
  ).toString("utf8"),
) as ParityDoc;

/** The gem fixture text format: "!input!rendered" pairs, plain lines
 *  round-trip; fail files carry "#input# ErrorClass: message" comments. */
function passEntries(file: URL): [string, string][] {
  return readFixture(file).map((line) => {
    const m = /^!(.+)!(.+)$/.exec(line);
    return m !== null ? [m[1]!, m[2]!] : [line, line];
  });
}
function failInputs(file: URL): string[] {
  const text = readFileSync(file, "utf8");
  return text
    .split("\n")
    .map((line) => /^#(.+)# .+$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]!);
}
function readFixture(file: URL): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

const FIX = new URL("../../test/fixtures/eu/identifiers/", import.meta.url);
const passFiles = readdirSync(new URL("pass/", FIX))
  .filter((f) => f.endsWith(".txt"))
  .sort();
const failFiles = readdirSync(new URL("fail/", FIX))
  .filter((f) => f.endsWith(".txt"))
  .sort();

test("the registry backs eu", () => {
  assert.ok(grammarImplementation("eu"), "eu is grammar-backed");
});

for (const file of passFiles) {
  test(`every entry of pass/${file} parses and renders`, () => {
    const entries = passEntries(new URL(`pass/${file}`, FIX));
    assert.ok(entries.length > 0);
    for (const [input, rendered] of entries) {
      assert.equal(impl.parse(input).toHuman(), rendered, input);
    }
  });
}

for (const file of failFiles) {
  test(`every entry of fail/${file} is rejected`, () => {
    const inputs = failInputs(new URL(`fail/${file}`, FIX));
    assert.ok(inputs.length > 0);
    for (const input of inputs) {
      assert.throws(() => impl.parse(input), input);
    }
  });
}

test("pass/ + fail/ conserve the full/ inputs", () => {
  const full = readFixture(new URL("full/identifiers.txt", FIX)).sort();
  const classified = [
    ...passFiles.flatMap((f) => passEntries(new URL(`pass/${f}`, FIX)).map(([i]) => i)),
    ...failFiles.flatMap((f) => failInputs(new URL(`fail/${f}`, FIX))),
  ].sort();
  assert.deepEqual(classified, full);
});

test("every ruby reference row reproduces byte-exactly", () => {
  for (const row of parity.eu.pass) {
    if (row.rejects === true) {
      assert.throws(() => impl.parse(row.input), row.input);
      continue;
    }
    const id = impl.parse(row.input) as BaseIdentifier & {
      toHuman(opts?: { withPublisher?: boolean }): string;
    };
    assert.equal(id.toHuman(), row.to_s, `${row.input}: to_s`);
    assert.deepEqual(id.toHash(), row.hash, `${row.input}: to_hash`);
    assert.equal(id.toPubidUrn(), row.pubid_urn, `${row.input}: pubid urn`);
    assert.equal(id.toUrn(), row.urn, `${row.input}: urn`);
    assert.equal(id.toHuman({ withPublisher: false }), row.bare, `${row.input}: bare`);
    const eu = id as unknown as {
      toCelex(): string;
      toEli(): string;
      family?: string;
      number_first?: boolean;
    };
    assert.equal(eu.toCelex(), row.celex, `${row.input}: celex`);
    assert.equal(eu.toEli(), row.eli, `${row.input}: eli`);
    assert.equal(eu.family ?? null, row.family ?? null, `${row.input}: family`);
    assert.equal(eu.number_first ?? null, row.number_first ?? null,
      `${row.input}: number_first`);
    // from_hash round-trips (the gem's serialization block).
    const back = EuIdentifier.fromHash(row.hash!) as BaseIdentifier;
    assert.equal(back.toHuman(), row.to_s, `${row.input}: from_hash render`);
    assert.deepEqual(back.toHash(), row.hash, `${row.input}: from_hash hash`);
  }
});

test("every ruby rejection row reproduces", () => {
  for (const row of parity.eu.fail) {
    let message: string | undefined;
    try {
      impl.parse(row.input);
    } catch (e) {
      message = (e as Error).message;
    }
    assert.ok(message !== undefined, `${row.input} must be rejected`);
    // Builder-stage messages are the flavor's own words — byte-equal.
    // Grammar-stage messages carry the engine's failure text, which the
    // wasm engine spells differently from parslet; the row's REJECTION
    // is the parity fact there.
    if (row.message.startsWith("EU legal act:")) {
      assert.equal(message, row.message, `${row.input}: message`);
    }
  }
});

test("every sweep print reads back as its own act", () => {
  for (const row of parity.eu.sweep) {
    const act = EuIdentifier.fromHash(row.hash) as BaseIdentifier;
    // The gem's property is parse(print) == act — lutaml equality, which
    // skips the equality_ignored number_first flag (a from_hash row
    // carries a flag a parser round-trip would not store, and the
    // degenerate number==year prints re-render unflagged). Render
    // stability is NOT the property the gem locks.
    const reparsed = impl.parse(row.input) as BaseIdentifier;
    assert.equal(reparsed.equals(act), true, `${row.input}: == act`);
    const bare = impl.parse(row.bare) as BaseIdentifier;
    assert.equal(bare.equals(act), true, `${row.bare}: bare == act`);
  }
});

test("the matching rows reproduce (=== and ==)", () => {
  for (const row of parity.eu.matches) {
    const a = impl.parse(row.a) as BaseIdentifier;
    const b = impl.parse(row.b) as BaseIdentifier;
    assert.equal(subsetMatch(a, b), row.subset, `${row.a} === ${row.b}`);
    assert.equal(a.equals(b), row.eq, `${row.a} == ${row.b}`);
  }
});

test("each pubid urn round-trips through the codec", () => {
  // Registered in the pubid-urn schema registry: the codec is exercised
  // for real (generate/parse), not by string comparison alone.
  for (const row of parity.eu.pass) {
    if (row.rejects === true || row.hash === undefined) continue;
    const urn = generateUrn(row.hash!);
    assert.equal(urn, row.pubid_urn, `${row.input}: codec generate`);
    const back = parseUrn(urn) as BaseIdentifier;
    assert.deepEqual(back.toHash(), row.hash, `${row.input}: codec parse`);
  }
});

test("the year-less face prints without a slash", () => {
  // Ruby exclude(:year) — a hash without the date renders "EU Regulation 1227".
  const id = EuIdentifier.fromHash({ _type: "pubid:eu:regulation", number: "1227" });
  assert.equal(id.toHuman(), "EU Regulation 1227");
});

// testsuite#117: the ELI implemented/delegated-act rows. The subtype
// ("impl", "del", "financ") strips before the baked grammar (which knows
// only reg/dir/dec) and rides the build as an equality-ignored facet —
// the gem's Identifier.bound_without_subtype.
test("the ELI subtype is a spelling facet, not identity", () => {
  assert.equal(
    impl.parse("http://data.europa.eu/eli/reg_impl/2016/1356/oj").toHuman(),
    "EU Regulation 2016/1356",
  );
  assert.equal(
    impl.parse("http://data.europa.eu/eli/reg_del/2025/934/oj").toHuman(),
    "EU Regulation 2025/934",
  );
  assert.equal(
    impl.parse("http://data.europa.eu/eli/dir_del/2014/69/oj").toHuman(),
    "EU Directive 2014/69",
  );
  assert.equal(
    impl.parse("http://data.europa.eu/eli/dec_impl/2026/732/oj").toHuman(),
    "EU Decision 2026/732",
  );
  // The subtype rides #toEli back out and == skips it.
  const implemented = impl.parse("http://data.europa.eu/eli/reg_impl/2016/1356/oj") as BaseIdentifier;
  assert.equal(
    (implemented as unknown as { toEli(): string }).toEli(),
    "http://data.europa.eu/eli/reg_impl/2016/1356/oj",
  );
  assert.equal(implemented.equals(impl.parse("EU Regulation 2016/1356") as BaseIdentifier), true);
  // The subtype serializes (equality_ignored affects ==, not the hash).
  assert.equal((implemented.toHash() as Record<string, unknown>).subtype, "impl");
  // An unknown subtype stays in the input, so the grammar rejects it.
  assert.throws(() => impl.parse("http://data.europa.eu/eli/reg_foo/2016/1356/oj"));
});
