import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// bipm — 90 corpus rows across six families, plus 5 negatives
// (JCGM identifiers belong to the jcgm flavor and must be rejected here).

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every bipm corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("bipm")!;
  const impl = grammarImplementation("bipm")!;
  assert.ok(impl, "bipm is grammar-backed");
  const report = runFlavor("bipm", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 80);
});

test("bipm parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("bipm")!;
  // The update-codes normalization of the MRA interpretation docnumber.
  assert.equal(impl.parse("CIPM/2005-06(REV)").toHuman(), "CIPM 2005-06");
  // Historic group names and two-letter language codes normalize away.
  assert.deepEqual(impl.parse("CCDS REC 2").toHash(), {
    _type: "pubid:bipm:committee-document",
    group: "CCTF",
    type_code: "REC",
    number: "2",
  });
  assert.equal(impl.parse("CCTF REC 2 (2012, EN)").toHuman(), "CCTF REC 2 (2012, E)");
  // The bare MRA form has no type code — empty URN segment, double colon.
  assert.equal(impl.parse("CIPM 2005-06").toUrn(), "urn:bipm:cipm::2005-06");
  // Loose French meeting spellings normalize to the canonical sup form.
  assert.equal(
    impl.parse("CCAUV 10e réunion (2015)").toHuman(),
    "CCAUV 10<sup>e</sup> réunion (2015)",
  );
  // Range meetings keep the first component's naive ordinal.
  assert.equal(impl.parse("CIPM 100-1th Meeting").toHuman(), "CIPM 100-1th Meeting");
  // Bare and sectioned brochure references wildcard every edition.
  assert.deepEqual(impl.parse("SI Brochure Part 1").toHash(), {
    _type: "pubid:bipm:si-brochure",
    part: "1",
  });
  assert.equal(impl.parse("SI Brochure").toUrn(), "urn:bipm:si-brochure::::");
  // MEPs and guides raise on toUrn (the Ruby generator does too).
  assert.throws(() => impl.parse("Rapport BIPM-2019/05").toUrn());
  assert.throws(() => impl.parse("CCDS-GD-MeP-1").toUrn());
});

test("bipm rejects non-identifiers", () => {
  const impl = grammarImplementation("bipm")!;
  // JCGM identifiers belong to the jcgm flavor.
  assert.throws(() => impl.parse("JCGM 100:2008"));
  assert.throws(() => impl.parse("JCGM 24th Meeting (2021)"));
  assert.throws(() => impl.parse("XXXX REC 1 (2020)"));
  assert.throws(() => impl.parse("not an identifier"));
});
