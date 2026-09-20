import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// amca — 41 corpus rows, clean: the renderer and URN mirror pubid
// main (the type segment is the bare type key; interpretations render
// "CODE Interp"; publications print "(Rev. …)" and "(R…)"). The 18
// unparsed ground-truth fixture debt rows are reference defects
// tracked in tests/amca/_debt.yaml, not pends.

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
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length - report.errors);
  assert.equal(report.pending, 0);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("amca parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("amca")!;
  assert.equal(impl.parse("ANSI/AMCA 210-16").toHuman(), "ANSI/AMCA Standard 210-16");
  assert.equal(impl.parse("ANSI/AMCA 210-16").toUrn(), "urn:amca:210:16:copub.ansi/amca:standard");
  // Publications print the revision and the R-prefixed reaffirmation.
  assert.equal(
    impl.parse("AMCA Publication 211-22 (Rev. 01-23)").toHuman(),
    "AMCA Publication 211-22 (Rev. 01-23)",
  );
  assert.equal(
    impl.parse("AMCA Publication 1011-03 (R2010)").toHuman(),
    "AMCA Publication 1011-03 (R2010)",
  );
  // Interpretations: the code prints before the Interp keyword; the
  // en-dash form is the year spelling.
  assert.equal(impl.parse("AMCA 204 AW Interp").toHuman(), "AMCA 204 AW Interp");
  assert.equal(impl.parse("AMCA 204 AW Interp").toUrn(), "urn:amca:204:interp.aw:copub.amca:interpretation");
  const interp = impl.parse("AMCA 99 JW Interp");
  assert.equal(interp.toHash()["interpretation_code"], "JW");
  // Bare standards default their type title.
  assert.equal(impl.parse("AMCA 511").toHuman(), "AMCA Standard 511");
  assert.equal(impl.parse("AMCA 511").toUrn(), "urn:amca:511:copub.amca:standard");
});

test("amca rejects non-identifiers", () => {
  const impl = grammarImplementation("amca")!;
  assert.throws(() => impl.parse("AMCA"));
  assert.throws(() => impl.parse("ISO 1234:2015"));
  assert.throws(() => impl.parse("AMCA 204 – AW Interp"));
});
