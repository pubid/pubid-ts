import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { arxivGrammarImplementation } from "../src/flavors/arxiv/index.js";
import { ArxivIdentifier, ArxivEprint } from "../src/flavors/arxiv/model.js";
import { grammarImplementation } from "../src/flavors/index.js";
import { subsetMatch } from "../src/model/subset-match.js";
import type { BaseIdentifier } from "../src/model/identifier.js";
import { generate as generateUrn, parse as parseUrn } from "../src/pubid-urn/index.js";

/**
 * The arxiv flavor (pubid#753, the gem flavor at 2.0.44): arXiv
 * e-prints, new form (`2301.00001`, 0704–1412 four-digit / 1501+
 * five-digit numbers) and old form (`hep-th/9901001`,
 * `math.GT/0309136`, 9108–0703), optional `vN` versions. The grammar
 * checks the shape, the builder checks the ranges. Byte parity runs
 * against the ruby-generated fixture
 * (test/fixtures/eu-arxiv-parity.json.gz, the output of
 * scripts/eu-arxiv-parity-ruby-probe.rb against the gem checkout); the
 * corpus gate loops the gem's generated fixtures
 * (test/fixtures/arxiv/identifiers/, copied byte-identical).
 */

const impl = arxivGrammarImplementation();

interface PassRow {
  input: string;
  rendered?: string;
  to_s?: string;
  hash?: Record<string, unknown>;
  pubid_urn?: string;
  urn?: string;
  bare?: string;
  root_number?: string;
  rejects?: boolean;
}
interface FailRow {
  input: string;
  error: string;
  message: string;
}
interface MatchRow {
  a: string;
  b: string;
  subset: boolean;
  eq: boolean;
}
interface ParityDoc {
  version: string;
  eu: unknown;
  arxiv: { pass: PassRow[]; fail: FailRow[]; matches: MatchRow[] };
}

const parity = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../../test/fixtures/eu-arxiv-parity.json.gz", import.meta.url)),
  ).toString("utf8"),
) as ParityDoc;

function passEntries(file: URL): [string, string][] {
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  return lines.map((line) => {
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

const FIX = new URL("../../test/fixtures/arxiv/identifiers/", import.meta.url);
const passFiles = readdirSync(new URL("pass/", FIX))
  .filter((f) => f.endsWith(".txt"))
  .sort();
const failFiles = readdirSync(new URL("fail/", FIX))
  .filter((f) => f.endsWith(".txt"))
  .sort();

test("the registry backs arxiv", () => {
  assert.ok(grammarImplementation("arxiv"), "arxiv is grammar-backed");
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
  const full = readFileSync(new URL("full/eprint.txt", FIX), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .sort();
  const classified = [
    ...passFiles.flatMap((f) => passEntries(new URL(`pass/${f}`, FIX)).map(([i]) => i)),
    ...failFiles.flatMap((f) => failInputs(new URL(`fail/${f}`, FIX))),
  ].sort();
  assert.deepEqual(classified, full);
});

test("every ruby reference row reproduces byte-exactly", () => {
  for (const row of parity.arxiv.pass) {
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
    // The index key: a non-empty root number (the sequence only).
    assert.equal(id.toHash()["number"], row.root_number, `${row.input}: root number`);
    // from_hash round-trips (the gem's serialization block).
    const back = ArxivIdentifier.fromHash(row.hash!) as BaseIdentifier;
    assert.equal(back.toHuman(), row.to_s, `${row.input}: from_hash render`);
    assert.deepEqual(back.toHash(), row.hash, `${row.input}: from_hash hash`);
  }
});

test("every ruby rejection row reproduces", () => {
  for (const row of parity.arxiv.fail) {
    let message: string | undefined;
    try {
      impl.parse(row.input);
    } catch (e) {
      message = (e as Error).message;
    }
    assert.ok(message !== undefined, `${JSON.stringify(row.input)} must be rejected`);
    // Builder-stage messages are the flavor's own words — byte-equal.
    // Grammar-stage messages carry the engine's failure text, which the
    // wasm engine spells differently from parslet; the row's
    // REJECTION is the parity fact there.
    if (row.message.startsWith("invalid arXiv identifier")) {
      assert.equal(message, row.message, `${JSON.stringify(row.input)}: message`);
    }
  }
});

test("the matching rows reproduce (=== and ==)", () => {
  for (const row of parity.arxiv.matches) {
    const a = impl.parse(row.a) as BaseIdentifier;
    const b = impl.parse(row.b) as BaseIdentifier;
    assert.equal(subsetMatch(a, b), row.subset, `${row.a} === ${row.b}`);
    assert.equal(a.equals(b), row.eq, `${row.a} == ${row.b}`);
  }
});

test("an empty hand-built reference matches nothing", () => {
  const empty = new ArxivEprint() as unknown as BaseIdentifier;
  const full = impl.parse("2301.00001") as BaseIdentifier;
  assert.equal(subsetMatch(empty, full), false);
});

test("a version-less hash omits the version key", () => {
  const hash = impl.parse("2301.00001").toHash();
  assert.equal("version" in hash, false);
});

test("each pubid urn round-trips through the codec", () => {
  // Registered in the pubid-urn schema registry: the codec is exercised
  // for real (generate/parse), not by string comparison alone.
  for (const row of parity.arxiv.pass) {
    if (row.rejects === true || row.hash === undefined) continue;
    const urn = generateUrn(row.hash!);
    assert.equal(urn, row.pubid_urn, `${row.input}: codec generate`);
    const back = parseUrn(urn) as BaseIdentifier;
    assert.deepEqual(back.toHash(), row.hash, `${row.input}: codec parse`);
  }
});

test("distinct papers never share a urn", () => {
  const a = impl.parse("2301.00001v1").toUrn();
  const b = impl.parse("2302.00001v2").toUrn();
  assert.notEqual(a, b);
  const c = impl.parse("hep-th/0101001").toUrn();
  const d = impl.parse("math/0101001").toUrn();
  assert.notEqual(c, d);
});
