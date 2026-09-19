import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// nist — 19,849 corpus rows, the largest flavor. The corpus is a LEDGER
// flavor (23 known reference defects on Ruby main); all 23 reproduce
// here one-for-one and are pended in conformance/pending.yaml.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every nist corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("nist")!;
  const impl = grammarImplementation("nist")!;
  assert.ok(impl, "nist is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("nist", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "ledger");
  assert.equal(report.cases + report.pending, payloads.cases.length - report.errors);
  assert.ok(report.cases > 19500);
  assert.equal(report.pending, 22);
  // A pending case that passes must be unmarked.
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("nist parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("nist")!;
  // Compound numbers across series.
  assert.equal(impl.parse("NIST SP 800-53").toHuman(), "NIST SP 800-53");
  assert.equal(impl.parse("NIST FIPS 173-1").toHuman(), "NIST FIPS 173-1");
  // Edition revisions and update components.
  assert.equal(impl.parse("NBS CIRC 100e2").toHuman(), "NBS CIRC 100e2");
  assert.equal(impl.parse("NIST SP 800-53r4").toHuman(), "NIST SP 800-53r4");
  assert.equal(
    impl.parse("NIST SP 800-53/Upd3-2015").toHuman(),
    "NIST SP 800-53/Upd3-2015",
  );
  // Ruby's TechnicalNote default: bare "-upd" becomes the Feb-2021 update.
  assert.equal(
    impl.parse("NIST.TN.2150-upd").toHuman(),
    "NIST.TN.2150-upd1-202102",
  );
  // Classes whose Ruby to_s defaults to the short style render short
  // even for mr-parsed input.
  assert.equal(impl.parse("NIST.MONO.1-1b").toHuman(), "NIST MONO 1-1B");
  assert.equal(impl.parse("NIST MP 275").toHuman(), "NBS MP 275");
  assert.equal(impl.parse("NBS.CRPL.c4-4").toHuman(), "NBS CRPL 4-4");
  assert.equal(
    impl.parse("NIST.IR.8115r1-upd").toHuman(),
    "NIST IR 8115r1-upd1",
  );
  // LCIRC supplement spellings render through the wrapper seam.
  assert.equal(
    impl.parse("NBS LCIRC 118supp3/1926").toHuman(),
    "NBS LC 118sup/Upd1-192603",
  );
  // The spurious v2-migration "U" is stripped and the letter upcased.
  assert.equal(impl.parse("NIST NCSTAR 1-1Ui").toHuman(), "NIST NCSTAR 1-1I");
  // The Ruby YAML float quirk survives in the wire hash.
  assert.equal(impl.parse("NBS CS 102E-42").toHash()["number"], 1.02e-40);
  // The nil-supplement URN quirk.
  assert.equal(impl.parse("NIST TN 2150").toUrn(), "urn:nist:tn:2150.supp");
});

test("nist rejects non-identifiers", () => {
  const impl = grammarImplementation("nist")!;
  // The known reference defects — Ruby rejects these too.
  assert.throws(() => impl.parse("NBS.CIRC"));
  assert.throws(() => impl.parse("NBS.CIRCe2"));
  assert.throws(() => impl.parse("NIST.SP.955-S..uppl"));
  assert.throws(() => impl.parse("NBS.TN.467pt1.Add."));
  assert.throws(() => impl.parse("NIST"));
  assert.throws(() => impl.parse("NIST SP"));
});
