import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// Grammar wave 9: gb — clean flavors ported onto the unified model,
// gated through the same conformance checks as every wave.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

const WAVE = ["gb"] as const;

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

test("gb parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("gb")!;
  // Em-dash year separator (Chinese typography) renders as a hyphen.
  assert.equal(impl.parse("GB/T 5606.2—2004").toHuman(), "GB/T 5606.2-2004");
  // Social-group form with the inline mandate.
  assert.deepEqual(impl.parse("T/ABC 12-2020").toHash(), {
    _type: "pubid:gb:standard",
    publisher: "T/ABC",
    number: "12",
    year: "2020",
  });
  // Confidential national series keeps its lowercase "n".
  assert.equal(impl.parse("GBn/T 5-1988").toUrn(), "urn:gb:gbn:5:1988");
  // Partial reference: no year.
  assert.deepEqual(impl.parse("GB/T 9999").toHash(), {
    _type: "pubid:gb:standard",
    publisher: "GB",
    mandate: "T",
    number: "9999",
  });
});

test("gb rejects non-identifiers", () => {
  const impl = grammarImplementation("gb")!;
  assert.throws(() => impl.parse("GB"));
  assert.throws(() => impl.parse("GB 12-20"));
  assert.throws(() => impl.parse("gb/T 12-2010"));
});
