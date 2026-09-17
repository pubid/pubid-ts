import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// Grammar wave 6: ecma, tgpp — full ports of the Ruby flavors, gated
// through the same conformance checks as corpus mode.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

const WAVE = ["ecma", "tgpp"] as const;

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

test("ecma parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("ecma")!;
  // The space-separated standard form normalizes to the hyphen.
  assert.equal(impl.parse("ECMA 6").toHuman(), "ECMA-6");
  // Suffixes attach to typed identifiers exactly as to standards.
  assert.equal(impl.parse("ECMA TR/98 ed2").toUrn(), "urn:ecma:tr:98:ed-2");
  assert.equal(impl.parse("ECMA MEM/1970 ed2 vol1").toHuman(),
    "ECMA MEM/1970 ed2 vol1");
  assert.equal(impl.parse("ECMA-402 ed5.1").toUrn(), "urn:ecma:402:ed-5.1");
  // A part and suffixes combine.
  assert.equal(impl.parse("ECMA-418-1 ed1").toUrn(),
    "urn:ecma:418:part-1:ed-1");
});

test("ecma rejects non-identifiers", () => {
  const impl = grammarImplementation("ecma")!;
  assert.throws(() => impl.parse("ECMA"));
  assert.throws(() => impl.parse("ECMA-"));
  assert.throws(() => impl.parse("ECMA TR/abc"));
  assert.throws(() => impl.parse("ECMA-411 edx"));
  assert.throws(() => impl.parse("ISO-411"));
});

test("tgpp parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("tgpp")!;
  // Bare partial reference (what relaton searches the index with).
  assert.equal(impl.parse("3GPP TS 23.207").toHuman(), "TS 23.207");
  assert.equal(impl.parse("TS 23.207").toUrn(), "urn:3gpp:ts:23.207");
  // New release spelling absent from the corpus, colon-free by grammar.
  assert.equal(impl.parse("TS 38.331:REL-20/20.0.0").toUrn(),
    "urn:3gpp:ts:38.331:REL-20:20.0.0");
  // Two parts plus suffix, legacy zero padding preserved.
  assert.equal(impl.parse("3GPP TR 29.998-04-2:REL-4/4.0.0").toHuman(),
    "TR 29.998-04-2:REL-4/4.0.0");
  // Release-less form keeps the interior empty URN segment.
  assert.equal(impl.parse("TS 29.215/2.1.0").toUrn(),
    "urn:3gpp:ts:29.215::2.1.0");
});

test("tgpp rejects non-identifiers", () => {
  const impl = grammarImplementation("tgpp")!;
  assert.throws(() => impl.parse("TS"));
  assert.throws(() => impl.parse("TS foo"));
  // Version-shaped segment after ":" = mistyped "/" separator.
  assert.throws(() => impl.parse("TS 23.207:2.0.0"));
  assert.throws(() => impl.parse("3GPP XS 23.207"));
});
