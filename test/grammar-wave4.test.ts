import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// Grammar wave 4: omg, ogc — full ports of the Ruby flavors, gated
// through the same conformance checks (positives + must-reject
// negatives) as corpus mode.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

const WAVE = ["omg", "ogc"] as const;

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

test("omg parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("omg")!;
  // Slash-separated part after a version normalizes to the space form.
  assert.equal(impl.parse("OMG DDS 1.4/PDF").toHuman(), "OMG DDS 1.4 PDF");
  assert.equal(impl.parse("OMG DDS 1.4/PDF").toUrn(), "urn:omg:-PDF");
  // Beta label spellings the corpus lacks.
  assert.deepEqual(impl.parse("OMG X 1.0 beta 2").toHash(), {
    _type: "pubid:omg:specification",
    acronym: "X",
    version: "1.0 beta 2",
  });
  assert.deepEqual(impl.parse("OMG X 1.0 betawave").toHash(), {
    _type: "pubid:omg:specification",
    acronym: "X",
    version: "1.0",
    part: "betawave",
  });
  // Part directly after the acronym (no version).
  assert.equal(impl.parse("OMG UML Superstructure").toHuman(),
    "OMG UML Superstructure");
});

test("ogc parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("ogc")!;
  // Lenient publisher token, canonical revision casing.
  assert.deepEqual(impl.parse("OGC 26-001R1").toHash(), {
    _type: "pubid:ogc:document",
    year: "26",
    number: "001",
    revision: "r1",
  });
  assert.equal(impl.parse("26-001R1").toUrn(), "urn:ogc:26:001:r1");
  // Zero padding and multi-letter suffixes preserved.
  assert.equal(impl.parse("26-2r17ab").toHuman(), "26-2r17ab");
});

test("the wave 4 grammars reject non-identifiers", () => {
  assert.throws(() => grammarImplementation("omg")!.parse("OMG 123"));
  assert.throws(() => grammarImplementation("omg")!.parse("UMG UML 2.5"));
  assert.throws(() => grammarImplementation("ogc")!.parse("25-023-1"));
  assert.throws(() => grammarImplementation("ogc")!.parse("25-abc"));
});
