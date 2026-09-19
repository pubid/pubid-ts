import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// astm — 248 corpus rows, a ledger flavor with 3 known mismatches (the
// glued-S data-series spellings "DS55S-S1-EB" the grammar rejects; Ruby
// main rejects them too).

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every astm corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("astm")!;
  const impl = grammarImplementation("astm")!;
  assert.ok(impl, "astm is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("astm", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "ledger");
  assert.equal(report.cases + report.pending, payloads.cases.length - report.errors);
  assert.equal(report.pending, 3);
  // A pending case that passes must be unmarked.
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("astm parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("astm")!;
  // Standards: letter codes, dual units, 2-digit years with sub-year,
  // reapprovals and editions.
  assert.equal(impl.parse("ASTM A240/A240M").toHuman(), "ASTM A240/A240M");
  assert.equal(impl.parse("ASTM A29-13").toHuman(), "ASTM A29-13");
  assert.equal(impl.parse("ASTM C33-03(2020)").toHuman(), "ASTM C33-03(2020)");
  // "ASTM A327-2a" (sub-year without a year) rejects on Ruby too.
  assert.throws(() => impl.parse("ASTM A327-2a"));
  // The digit-only 5xxxx family is ISO-dual-published.
  assert.equal(
    impl.parse("ASTM 52303-24e1").toHash()["_type"],
    "pubid:astm:iso-dual-published",
  );
  assert.equal(
    impl.parse("ASTM 51261-13(2020)e1").toUrn(),
    "urn:astm:std:51261:13:reapp.2020:e1",
  );
  // Typed documents.
  assert.equal(impl.parse("ASTM RR:A01-1001").toHuman(), "ASTM RR:A01-1001");
  assert.equal(impl.parse("ASTM MNL1-9TH-EB").toHuman(), "ASTM MNL1-9TH-EB");
  assert.equal(impl.parse("ASTM MONO1-EB").toHuman(), "ASTM MONO1-EB");
  assert.equal(impl.parse("ASTM DS11-S1-EB").toHuman(), "ASTM DS11-S1-EB");
  assert.equal(impl.parse("ASTM WK91249").toHuman(), "ASTM WK91249");
  assert.equal(impl.parse("ADJF3504-EA").toHuman(), "ADJF3504-EA");
  // The ISO/ASTM technical report keeps its joint publisher in the URN
  // namespace slot.
  assert.equal(
    impl.parse("ISO/ASTMTR52905-EB").toUrn(),
    "urn:iso/astm:std:52905",
  );
});

test("astm rejects non-identifiers", () => {
  const impl = grammarImplementation("astm")!;
  assert.throws(() => impl.parse("ASTM"));
  assert.throws(() => impl.parse("DS55S-S1-EB"));
  assert.throws(() => impl.parse("NIST SP 800-53"));
});
