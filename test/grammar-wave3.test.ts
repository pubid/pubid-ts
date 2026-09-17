import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// Grammar wave 3: plateau, w3c — full ports of the Ruby flavors, gated
// through the same conformance checks as corpus mode.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

const WAVE = ["plateau", "w3c"] as const;

for (const flavor of WAVE) {
  test(`every ${flavor} corpus case passes through the grammar`, () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const payloads = corpus.flavors.get(flavor)!;
    const impl = grammarImplementation(flavor)!;
    assert.ok(impl, `${flavor} is grammar-backed`);
    const report = runFlavor(flavor, payloads, impl, new PendingRegistry());
    assert.equal(report.failures.length, 0, report.failures.join("; "));
    assert.equal(report.outcome, "pass");
    assert.equal(report.cases, payloads.cases.length);
    assert.ok(report.cases > 0);
  });
}

test("plateau parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("plateau")!;
  // Number/edition spellings absent from the corpus.
  assert.equal(impl.parse("PLATEAU Handbook #99 第9.9版").toHuman(),
    "PLATEAU Handbook #99 第9.9版");
  assert.equal(impl.parse("PLATEAU Handbook #99 第9.9版").toUrn(),
    "urn:plateau:handbook:99");
  // Legacy Latin edition on a Technical Report: captured by the handbook
  // rule, dropped by the builder (Ruby parity).
  assert.deepEqual(impl.parse("PLATEAU Technical Report #00 1.0").toHash(), {
    _type: "pubid:plateau:technical-report",
    number: 0,
  });
  // Legacy underscore annex separator renders as the canonical dash.
  assert.equal(impl.parse("PLATEAU Technical Report #46_2").toHuman(),
    "PLATEAU Technical Report #46-2");
});

test("plateau rejects non-identifiers and the upstream-broken Annex form", () => {
  const impl = grammarImplementation("plateau")!;
  assert.throws(() => impl.parse("PLATEAU Handbook #1.0"));
  assert.throws(() => impl.parse("PLATEAU Guide #01"));
  assert.throws(() => impl.parse("PLATEAU Handbook #01 第1.0版 Annex A"));
});

test("w3c parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("w3c")!;
  assert.equal(impl.parse("W3C REC-some-new-doc-20260101").toUrn(),
    "urn:w3c:rec:some-new-doc:20260101");
  assert.deepEqual(impl.parse("W3C totally-new-slug").toHash(), {
    _type: "pubid:w3c:standard",
    number: "totally-new-slug",
  });
  // A token only counts as a type when followed by "-": a bare slug that
  // spells a token is a Standard.
  assert.equal(impl.parse("W3C rec").toUrn(), "urn:w3c:rec");
  // Legacy 6-digit date.
  assert.equal(impl.parse("W3C WD-proxy-971024").toHuman(),
    "W3C WD-proxy-971024");
  // Slugs that merely end in a short digit run never mis-split.
  assert.equal(impl.parse("W3C url-1").toHuman(), "W3C url-1");
});

test("w3c rejects non-identifiers", () => {
  const impl = grammarImplementation("w3c")!;
  assert.throws(() => impl.parse("W3C"));
  assert.throws(() => impl.parse("W3C "));
  assert.throws(() => impl.parse("ISO REC-CSS1"));
});
