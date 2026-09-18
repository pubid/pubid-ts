import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// calconnect — the first flavor ported FRESH on the unified model
// (src/model/): declarations + grammar + builder, no hand-rolled
// serialization. Same conformance gate as every wave.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every calconnect corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("calconnect")!;
  const impl = grammarImplementation("calconnect")!;
  assert.ok(impl, "calconnect is grammar-backed");
  const report = runFlavor("calconnect", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 0);
});

test("calconnect parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("calconnect")!;
  // Partial reference (relaton's exclusion-match shape).
  assert.deepEqual(impl.parse("CC 22005").toHash(), {
    _type: "pubid:calconnect:standard",
    number: "22005",
  });
  // Series + dotted sub-part + full date combine (a number carries at
  // most ONE sub-part — "0999.2-1" has two and raises, Ruby parity).
  assert.equal(impl.parse("CC/FDS 0999.2:2025-01-05").toHuman(),
    "CC/FDS 0999.2:2025-01-05");
  assert.equal(impl.parse("CC/FDS 0999.2:2025-01-05").toUrn(),
    "urn:calconnect:FDS:0999.2:2025-01-05");
  assert.throws(() => impl.parse("CC/FDS 0999.2-1:2025-01-05"));
});

test("calconnect rejects non-identifiers", () => {
  const impl = grammarImplementation("calconnect")!;
  assert.throws(() => impl.parse("CC"));
  assert.throws(() => impl.parse("CC/ 18011"));
  assert.throws(() => impl.parse("CC/A 0812-1-2:2008"));
});
