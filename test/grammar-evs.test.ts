import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// evs — 10 corpus rows, a CLEAN flavor (0 known mismatches): every case
// must pass with no pends.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every evs corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("evs")!;
  const impl = grammarImplementation("evs")!;
  assert.ok(impl, "evs is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("evs", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length - report.errors);
  assert.equal(report.pending, 0);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("evs parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("evs")!;
  // The adopted part parses through the real CEN grammar: adoptions,
  // joint copublishers, supplement chains.
  assert.equal(impl.parse("EVS-EN ISO 14001:2026").toHuman(), "EVS-EN ISO 14001:2026");
  assert.equal(impl.parse("EVS-EN ISO/IEC 27017:2026").toUrn(), "urn:evs:en:iso-iec:27017:2026");
  assert.equal(
    impl.parse("EVS-EN ISO 9001:2015/A1:2024").toUrn(),
    "urn:evs:en:iso:9001:2015:amd:1:2024",
  );
  // The printed separator round-trips and rides the wire only when it
  // differs from the "-" default.
  const spaced = impl.parse("EVS EN 18216:2026");
  assert.equal(spaced.toHuman(), "EVS EN 18216:2026");
  assert.equal(spaced.toHash()["separator"], " ");
  const dashed = impl.parse("EVS-EN 18216:2026");
  assert.equal(dashed.toHash()["separator"], undefined);
  // A bare "EVS-EN" still parses (empty CEN base).
  assert.equal(impl.parse("EVS-EN").toHuman(), "EVS-EN");
  assert.equal(impl.parse("EVS-EN").toUrn(), "urn:evs:en");
});

test("evs rejects non-identifiers", () => {
  const impl = grammarImplementation("evs")!;
  assert.throws(() => impl.parse("EVS"));
  assert.throws(() => impl.parse("EN 18216:2026"));
  assert.throws(() => impl.parse("EVS-ISO 1234:2015"));
});
