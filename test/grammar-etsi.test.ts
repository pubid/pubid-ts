import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// etsi — the largest corpus flavor (24,724 rows), ported onto the
// unified model. Same conformance gate as every wave.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every etsi corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("etsi")!;
  const impl = grammarImplementation("etsi")!;
  assert.ok(impl, "etsi is grammar-backed");
  const report = runFlavor("etsi", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 20000);
});

test("etsi parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("etsi")!;
  // Chained supplements render innermost-first.
  assert.equal(impl.parse("ETSI TS 102 606-1/A1/C2 V1.1.1 (2021-06)").toHuman(),
    "ETSI TS 102 606-1/A1/C2 V1.1.1 (2021-06)");
  // A minor composes after a space; a partial reference parses bare.
  assert.equal(impl.parse("ETSI TS 123 456 2").toHuman(), "ETSI TS 123 456 2");
  assert.deepEqual(impl.parse("ETSI EN 303 111").toHash(), {
    _type: "pubid:etsi:etsi-standard",
    type: "EN",
    number: "303 111",
  });
});

test("etsi rejects non-identifiers", () => {
  const impl = grammarImplementation("etsi")!;
  assert.throws(() => impl.parse("ETSI"));
  assert.throws(() => impl.parse("ETSI XX 123"));
  assert.throws(() => impl.parse("ETSI TS 102 606 V1 (2021)"));
});
