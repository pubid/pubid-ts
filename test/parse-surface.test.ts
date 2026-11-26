import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as pubid from "../src/index.js";
import {
  loadBundledCorpus,
  parse,
  parseOk,
  render,
  laneKeys,
  norm,
  undatedNorm,
  allPartsNorm,
  ParseError,
  isErrorCase,
  isQuarantined,
  isReview,
} from "../src/index.js";
import type { CorpusCase } from "../src/corpus/types.js";

// The parse surface export (pubid/pubid-ts#226): every new export proved
// against corpus rows — the bundled corpus artifact is the pinned
// testsuite goldens, and the keys fixture is the Ruby reference's own
// lane-key computation (the corpus-lane generator relaton-api-js runs as
// their parity gate; their #176).

interface KeysRow {
  flavor: string;
  input: string;
  canonical: string;
  keys: { norm: string; undated: string; allparts: string };
}

const keysCorpus: KeysRow[] = JSON.parse(
  readFileSync(new URL("../../test/fixtures/parse-keys-corpus.json", import.meta.url), "utf8"),
) as KeysRow[];

// The engine-coverage gaps of the keys fixture: inputs the Ruby reference
// parses but the TS grammar does not yet. Pinned exactly, so a grammar
// round that closes one surfaces here and shrinks the list.
const PARSE_GAPS: readonly string[] = ["iec:IEC 60285-/1:1989"];

// The keys fixture's canonicals were generated at an earlier Ruby state;
// the grammar rounds since then widened renders (the iho appendix/supplement
// spellings, the S-8A/B part faces, the DIR SUP month forms, the FIPS
// prefix). For these the pinned testsuite corpus - not the stale fixture
// canonical - is the golden, so the row is pinned to its TS canonical and
// the fixture keys are not consulted. When the fixture regenerates at the
// current Ruby, this map empties.
const CANONICAL_DIVERGED: Record<string, string> = {
  "iso:ISO/IEC DIR 1 + IEC SUP:2016-05": "ISO/IEC DIR 1 + IEC SUP:2016-05",
  "iso:ISO/IEC DIR 1 + IEC SUP:2017-05": "ISO/IEC DIR 1 + IEC SUP:2017-05",
  "iso:ISO/IEC DIR 1 + IEC SUP:2018-05": "ISO/IEC DIR 1 + IEC SUP:2018-05",
  "iso:ISO/IEC DIR 1 + IEC SUP:2019-05": "ISO/IEC DIR 1 + IEC SUP:2019-05",
  "iso:ISO/IEC DIR 1 + IEC SUP:2020-05": "ISO/IEC DIR 1 + IEC SUP:2020-05",
  "iho:P-1/22": "IHO P-1 Vol. 22",
  "iho:S-122 Appendix B": "IHO S-122 Appendix B",
  "iho:S-122 Appendix D-2": "IHO S-122 Appendix D-2",
  "iho:S-123 Appendix B": "IHO S-123 Appendix B",
  "iho:S-123 Appendix D-2": "IHO S-123 Appendix D-2",
  "iho:S-5B": "IHO S-5 Part B",
  "iho:S-65 Ap. A": "IHO S-65 Appendix A",
  "iho:S-65 Ap. B": "IHO S-65 Appendix B",
  "iho:S-66 Suppl 1": "IHO S-66 Sup 1",
  "iho:S-66 Suppl 3": "IHO S-66 Sup 3",
  "iho:S-8A": "IHO S-8 Part A",
  "nist:NIST FIPS 140-3": "FIPS PUB 140-3",
};

/** Deterministic sample: about `stride` rows, evenly spread from the first. */
function sample<T>(rows: T[], stride: number): T[] {
  const out: T[] = [];
  const step = Math.max(1, Math.floor(rows.length / stride));
  for (let i = 0; i < rows.length; i += step) {
    const row = rows[i];
    if (row !== undefined) out.push(row);
  }
  return out;
}

const parseableRows = (cases: CorpusCase[]): CorpusCase[] =>
  cases.filter(
    (c) =>
      c.identifier !== undefined &&
      !isErrorCase(c) &&
      !isQuarantined(c) &&
      c.render_unreparseable !== true &&
      c.roundtrip !== true &&
      !isReview(c),
  );

const errorInputs = (cases: CorpusCase[]): CorpusCase[] =>
  cases.filter((c) => isErrorCase(c) && c.input !== undefined);

const corpus = loadBundledCorpus();

// --- the exports are present --------------------------------------------

test("the parse surface exports are present at the package root", () => {
  const functions = ["parse", "parseOk", "render", "laneKeys", "norm", "undatedNorm", "allPartsNorm"];
  for (const name of functions) {
    assert.equal(typeof (pubid as Record<string, unknown>)[name], "function", `${name} export`);
  }
  assert.equal(typeof ParseError, "function");
  assert.ok(new ParseError("x", { input: "x" }) instanceof ParseError);
});

// --- lane-key derivation helpers (the Ruby semantics, pinned) -----------

test("norm uppercases and deletes exactly the space character", () => {
  assert.equal(norm("iso 19115-1:2014"), "ISO19115-1:2014");
  assert.equal(norm("NIST SP 800-53 Rev. 5"), "NISTSP800-53REV.5");
  assert.equal(norm("ИСО 639-1"), "ИСО639-1");
});

test("undatedNorm strips every colon-year not followed by a dash", () => {
  // Base and supplement years alike: one rule, no per-flavor casing.
  assert.equal(undatedNorm("ISO9001:2015/AMD1:2018"), "ISO9001/AMD1");
  assert.equal(undatedNorm("ISO19115-1:2014"), "ISO19115-1");
  assert.equal(undatedNorm("IEC61010-2-201:2015+AMD1:2018CSV"), "IEC61010-2-201+AMD1CSV");
  // A dash after the year (a day of an ISO date, not a document year) stays.
  assert.equal(undatedNorm("ISO1234:2020-5"), "ISO1234:2020-5");
  // The verbatim Ruby gsub: the match starts at the digits, so an
  // ITU-style parenthesized year leaves its parens (the reference does
  // exactly this - the keys fixture pins the same value).
  assert.equal(undatedNorm("ITU-TG.7710/Y.1705(2001)"), "ITU-TG.7710/Y.1705()");
});

test("allPartsNorm strips the first trailing part, structurally only", () => {
  assert.equal(allPartsNorm("ISO19115-1", "1"), "ISO19115");
  assert.equal(allPartsNorm("ISO/IEC11172-2/COR1", "2"), "ISO/IEC11172/COR1");
  // Ruby sub: first occurrence wins; a part with no undashed tail strips nothing.
  assert.equal(allPartsNorm("ISO53798-2", "2"), "ISO53798");
  // A blank part never strips.
  assert.equal(allPartsNorm("ISO19115", undefined), "ISO19115");
  assert.equal(allPartsNorm("ISO19115", ""), "ISO19115");
});

// --- lane keys against the Ruby reference's own corpus-lane goldens -----

test("norm and undatedNorm reproduce every Ruby-computed key in the corpus lanes", () => {
  // No parse needed: the fixture carries the reference's canonical, so
  // this proves the pure derivations across the whole lane corpus.
  const misses = keysCorpus.filter(
    (row) => norm(row.canonical) !== row.keys.norm || undatedNorm(row.keys.norm) !== row.keys.undated,
  );
  assert.deepEqual(
    misses.map((m) => `${m.flavor}:${m.input}`),
    [],
    "norm/undated derivation drift against the Ruby-computed keys",
  );
});

test("parse reproduces the Ruby canonical and lane keys for the lane corpus rows", () => {
  // Full pipeline over the whole lane corpus: parse -> components ->
  // structural part -> keys, byte-compared against the Ruby key
  // generator's output wherever the canonicals agree.
  const misses: string[] = [];
  const gaps: string[] = [];
  const diverged: string[] = [];
  for (const row of keysCorpus) {
    const key = `${row.flavor}:${row.input}`;
    let result;
    try {
      result = parse(row.input, row.flavor);
    } catch {
      gaps.push(key);
      continue;
    }
    if (result.canonical !== row.canonical) {
      diverged.push(key);
      assert.equal(
        CANONICAL_DIVERGED[key],
        result.canonical,
        `${key}: untracked canonical drift (stale-fixture set needs updating)`,
      );
      continue;
    }
    if (result.keys.dated !== row.keys.norm) {
      misses.push(`${key} dated ${result.keys.dated} != ruby ${row.keys.norm}`);
    }
    if (result.keys.undated !== row.keys.undated) {
      misses.push(`${key} undated ${result.keys.undated} != ruby ${row.keys.undated}`);
    }
    if (result.keys.all_parts !== row.keys.allparts) {
      misses.push(`${key} allparts ${result.keys.all_parts} != ruby ${row.keys.allparts}`);
    }
  }
  assert.deepEqual(gaps, [...PARSE_GAPS], "untracked parse gaps in the keys fixture");
  assert.equal(diverged.length, Object.keys(CANONICAL_DIVERGED).length, "divergence set size");
  assert.deepEqual(misses, [], "parse/laneKeys drift against the Ruby reference");
});

test("laneKeys() and render() agree with parse() for the sampled rows", () => {
  for (const row of sample(keysCorpus, 25)) {
    const result = parse(row.input, row.flavor);
    assert.deepEqual(laneKeys(row.input, row.flavor), result.keys, row.input);
    assert.equal(render(row.input, row.flavor), result.canonical, row.input);
  }
});

// --- parse / render / components against the bundled corpus rows --------

test("parse components, canonical, urn, year and part match the corpus rows", () => {
  const misses: string[] = [];
  let checked = 0;
  for (const [flavor, payloads] of corpus.flavors) {
    for (const row of sample(parseableRows(payloads.cases), 2)) {
      checked += 1;
      const result = parse(row.representations.human, flavor);
      const hash = row.identifier!;
      assert.deepEqual(result.components, hash, `${row.id} components`);
      if (result.canonical !== row.representations.human) {
        misses.push(`${row.id} canonical ${result.canonical} != ${row.representations.human}`);
      }
      // The runner's contract: the URN is asserted when the corpus
      // expects one (emission-where-none is the engine's business, not
      // the surface's - the reference's own gate does not assert it).
      if (row.representations.urn !== undefined && result.urn !== row.representations.urn) {
        misses.push(`${row.id} urn ${String(result.urn)} != ${row.representations.urn}`);
      }
      const expectedYear = typeof hash["year"] === "number" ? String(hash["year"]) : hash["year"];
      if (result.year !== expectedYear) {
        misses.push(`${row.id} year ${String(result.year)} != ${String(expectedYear)}`);
      }
      // The structural part: the row's own part facet, else the base's.
      const base = hash["base"] as Record<string, unknown> | undefined;
      const rawPart = hash["part"] ?? base?.["part"];
      const expectedPart =
        typeof rawPart === "string"
          ? rawPart
          : rawPart !== undefined && rawPart !== null && typeof rawPart === "object"
            ? String((rawPart as Record<string, unknown>)["value"])
            : undefined;
      if (result.part !== expectedPart) {
        misses.push(`${row.id} part ${String(result.part)} != ${String(expectedPart)}`);
      }
    }
  }
  assert.ok(checked > 50, `expected a real sample, got ${checked}`);
  assert.deepEqual(misses, [], "parse drift against the corpus rows");
});

test("the sampled corpus rows satisfy the lane-key invariants", () => {
  const misses: string[] = [];
  for (const [flavor, payloads] of corpus.flavors) {
    for (const row of sample(parseableRows(payloads.cases), 1)) {
      const result = parse(row.representations.human, flavor);
      const keys = result.keys;
      // The dated lane is the norm of the canonical render.
      assert.equal(keys.dated, norm(result.canonical), `${row.id} dated`);
      // The undated strip is idempotent: no strippable year remains.
      if (/:?(?:19|20)\d{2}(?=[^-]*$)/.test(keys.undated)) {
        misses.push(`${row.id} undated ${keys.undated} still carries a year`);
      }
      // The helpers compose into the returned keys exactly.
      if (keys.all_parts !== allPartsNorm(keys.undated, result.part)) {
        misses.push(`${row.id} all_parts ${keys.all_parts} breaks the composition identity`);
      }
    }
  }
  assert.deepEqual(misses, [], "lane-key invariant violations");
});

test("render returns the canonical human for the corpus rows", () => {
  for (const [flavor, payloads] of corpus.flavors) {
    for (const row of sample(parseableRows(payloads.cases), 1)) {
      assert.equal(render(row.representations.human, flavor), row.representations.human, row.id);
    }
  }
});

// --- parse_ok: the verdict helper ----------------------------------------

test("parseOk is true for corpus positives and false for the expect-error negatives", () => {
  const wrong: string[] = [];
  let positives = 0;
  let negatives = 0;
  for (const [flavor, payloads] of corpus.flavors) {
    for (const row of sample(parseableRows(payloads.cases), 1)) {
      positives += 1;
      if (!parseOk(row.representations.human, flavor)) wrong.push(`${row.id} rejected`);
    }
    for (const row of sample(errorInputs(payloads.negatives), 1)) {
      negatives += 1;
      if (parseOk(row.input!, flavor)) wrong.push(`${row.id} accepted`);
    }
  }
  assert.ok(positives > 40 && negatives > 20, `thin sample: ${positives}+/${negatives}-`);
  assert.deepEqual(wrong, [], "verdict drift against the corpus rows");
});

test("parseOk is false for unknown flavors and never throws", () => {
  assert.equal(parseOk("ISO 9001:2015", "no_such_flavor"), false);
  assert.equal(parseOk("", "iso"), false);
  assert.equal(parseOk("complete garbage", "iso"), false);
});

// --- the surfaced error class ---------------------------------------------

test("rejections raise the surfaced ParseError with the input and flavor", () => {
  try {
    parse("complete garbage", "iso");
    assert.fail("expected a ParseError");
  } catch (error) {
    assert.ok(error instanceof ParseError, `got ${(error as Error).constructor.name}`);
    assert.ok(error instanceof Error);
    assert.equal((error as ParseError).name, "ParseError");
    assert.equal((error as ParseError).input, "complete garbage");
    assert.equal((error as ParseError).flavor, "iso");
    assert.match((error as Error).message, /cannot parse/);
  }
});

test("unknown flavors raise ParseError naming the flavor", () => {
  try {
    parse("ISO 9001:2015", "no_such_flavor");
    assert.fail("expected a ParseError");
  } catch (error) {
    assert.ok(error instanceof ParseError);
    assert.equal((error as ParseError).flavor, "no_such_flavor");
    assert.match((error as Error).message, /unknown flavor/);
  }
});

test("engine failures ride as the cause of the ParseError", () => {
  try {
    parse("complete garbage", "iso");
    assert.fail("expected a ParseError");
  } catch (error) {
    assert.ok(error instanceof ParseError);
    assert.ok((error as ParseError).cause !== undefined, "expected a preserved cause");
  }
});
