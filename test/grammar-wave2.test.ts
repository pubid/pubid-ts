import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// Grammar wave 2: doi, iana, un, xsf — each a full port of its Ruby
// flavor, gated through the same conformance checks as corpus mode.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

const WAVE = ["doi", "iana", "un", "xsf"] as const;

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

test("open-ended parsing beyond the corpus (the point of the waves)", () => {
  assert.equal(grammarImplementation("doi")!.parse("doi:10.9999/nist.SP.260-220").toHuman(),
    "doi:10.9999/nist.SP.260-220");
  assert.equal(grammarImplementation("iana")!.parse("IANA dns-sec-alg-numbers/1").toUrn(),
    "urn:iana:dns-sec-alg-numbers:1");
  assert.equal(grammarImplementation("un")!.parse("S/2023/DOC/9").toHuman(),
    "S/2023/DOC/9");
  assert.equal(grammarImplementation("xsf")!.parse("XEP 9999").toUrn(),
    "urn:xsf:xep:9999");
});

test("the wave grammars reject non-identifiers", () => {
  assert.throws(() => grammarImplementation("doi")!.parse("doi:10.X/abc"));
  assert.throws(() => grammarImplementation("xsf")!.parse("XEP foo"));
  assert.throws(() => grammarImplementation("un")!.parse("UN"));
});
