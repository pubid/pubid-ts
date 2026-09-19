import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// amca — 39 corpus rows, a LEDGER flavor (16 known mismatches in
// _status.yaml; the testsuite verify loop reports 16 failing case
// ids — a heavy ledger). Those are pended one-for-one; everything
// else must pass.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every amca corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("amca")!;
  const impl = grammarImplementation("amca")!;
  assert.ok(impl, "amca is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("amca", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "ledger");
  assert.equal(
    report.cases + report.pending,
    payloads.cases.length - report.errors,
  );
  // The ledger's gem-known mismatches (generated from the testsuite
  // verify loop over the gem, /tmp/verify-amca.rb).
  assert.equal(report.pending, 16);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("amca parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("amca")!;
  assert.equal(impl.parse("ANSI/AMCA 210-16").toHuman(), "ANSI/AMCA Standard 210-16");
  assert.equal(
    impl.parse("ANSI/AMCA 210-16").toUrn(),
    'urn:amca:210:16:copub.ansi/amca:{key: :standard, title: "standard", short: nil}',
  );
  // Publications: the revision tail parses (Rev. 01-23 → revision
  // "01") but the gem's renderer drops it — matched 1:1.
  assert.equal(
    impl.parse("AMCA Publication 211-22 (Rev. 01-23)").toHuman(),
    "AMCA Publication 211 -22",
  );
  // Interpretations render through the en-dash code form; the dash
  // spelling itself does not parse (gem behavior).
  assert.equal(impl.parse("AMCA 204 AW Interp").toHuman(), "AMCA 204 – AW");
  const interp = impl.parse("AMCA 99 JW Interp");
  assert.equal(interp.toHash()["interpretation_code"], "JW");
  // Bare standards default their type title.
  assert.equal(impl.parse("AMCA 511").toHuman(), "AMCA Standard 511");
});

test("amca rejects non-identifiers", () => {
  const impl = grammarImplementation("amca")!;
  assert.throws(() => impl.parse("AMCA"));
  assert.throws(() => impl.parse("ISO 1234:2015"));
  assert.throws(() => impl.parse("AMCA 204 – AW Interp"));
});
