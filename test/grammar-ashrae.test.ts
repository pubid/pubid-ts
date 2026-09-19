import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// ashrae — 1,967 corpus rows, a LEDGER flavor (77 known mismatches in
// _status.yaml; the testsuite verify loop reports 236 failing case
// ids). Those are pended one-for-one; everything else must pass.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every ashrae corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("ashrae")!;
  const impl = grammarImplementation("ashrae")!;
  assert.ok(impl, "ashrae is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("ashrae", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "ledger");
  assert.equal(
    report.cases + report.pending,
    payloads.cases.length - report.errors,
  );
  // The ledger's gem-known mismatches (generated from the testsuite
  // verify loop over the gem, /tmp/verify-ashrae.rb).
  assert.equal(report.pending, 236);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("ashrae parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("ashrae")!;
  assert.equal(impl.parse("ASHRAE Standard 90.1-2022").toHuman(), "ASHRAE Standard 90.1-2022");
  assert.equal(impl.parse("ASHRAE Guideline 0-2019").toUrn(), "urn:ashrae:0:2019:guideline");
  // Copublished forms keep the ANSI prefix only through the copublisher.
  const copub = impl.parse("ANSI/ASHRAE 34-2024");
  assert.equal(copub.toHuman(), "ASHRAE Standard 34-2024");
  assert.equal(copub.toUrn(), "urn:ashrae:34:2024:standard:copub.ansi/ashrae");
  // Reaffirmation round-trips in both printed spellings.
  assert.equal(impl.parse("ASHRAE Guideline 2-2010(RA2014)").toHuman(), "ASHRAE Guideline 2-2010 (RA2014)");
  // The revision suffix stays glued to the year.
  assert.equal(impl.parse("ASHRAE Guideline 27-2019R").toUrn(), "urn:ashrae:27:2019:guideline:r");
  // Addenda: single, combined (with "and" preprocessed away), packages.
  assert.equal(
    impl.parse("ASHRAE Addendum a to Guideline 1.4-2019").toHuman(),
    "ASHRAE Addendum a to Guideline 1.4-2019",
  );
  assert.equal(
    impl.parse("ASHRAE Addenda c and d to Standard 15-1994").toHuman(),
    "ASHRAE Addenda c, d to Standard 15-1994",
  );
  assert.equal(
    impl.parse("ASHRAE Standard 140-2007: Addenda Supplement").toUrn(),
    "urn:ashrae:140",
  );
  // Errata dates normalize to the long printed form.
  assert.equal(
    impl.parse("ASHRAE Guideline 0-2005 Errata (September 28, 2011)").toHuman(),
    "ASHRAE Guideline 0-2005 Errata (September 28, 2011)",
  );
  // The parenthesized additional copublisher is consumed, not rendered.
  assert.equal(
    impl.parse("ASHRAE Standard 68-1997 (ANSI/AMCA 330-97)").toHuman(),
    "ASHRAE Standard 68-1997",
  );
  // A bare "Standard 15-2024" parses through the standalone-copublisher
  // branch (gem behavior) and defaults the type.
  assert.equal(impl.parse("Standard 15-2024").toHuman(), "ASHRAE Standard 15-2024");
});

test("ashrae rejects non-identifiers", () => {
  const impl = grammarImplementation("ashrae")!;
  assert.throws(() => impl.parse("ASHRAE"));
  assert.throws(() => impl.parse("ASHRAE Standard"));
  assert.throws(() => impl.parse("Guideline 0"));
  assert.throws(() => impl.parse("ISO 1234:2015"));
});
