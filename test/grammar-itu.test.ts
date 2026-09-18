import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// itu — 2,745 corpus rows (13 types), the grammar fully mirroring
// lib/pubid/itu/parser.rb including the marker-capture spellings.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every itu corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("itu")!;
  const impl = grammarImplementation("itu")!;
  assert.ok(impl, "itu is grammar-backed");
  const report = runFlavor("itu", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 2700);
});

test("itu parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("itu")!;
  // The long-form prefix drops on render.
  assert.equal(impl.parse("Recommendation ITU-T G.711").toHuman(), "ITU-T G.711");
  // Doubled whitespace collapses (ITU's own listings carry it).
  assert.equal(impl.parse("ITU-T D.271  (10/2016)").toHuman(), "ITU-T D.271 (10/2016)");
  // Contributions (pubid#340) and series-code documents.
  assert.deepEqual(impl.parse("ITU-T SG17-C1000").toHash(), {
    _type: "pubid:itu:contribution",
    sector: "T",
    series: "SG17",
    number: "1000",
  });
  assert.equal(impl.parse("ITU-T SEC-QKD").toUrn(), "urn:itu:t:SEC-QKD");
  // Implementers' Guide codes.
  assert.equal(impl.parse("ITU-T X.ImpOSI").toHuman(), "ITU-T X.ImpOSI");
  // The bare version spellings normalise to "(V##)".
  assert.equal(impl.parse("ITU-T H.264 v.1 (08/2021)").toHuman(), "ITU-T H.264 (V1) (08/2021)");
  // The legacy Operational Bulletin long form.
  assert.equal(impl.parse("ITU-T Operational Bulletin No. 1096").toHuman(), "ITU OB No. 1096");
  // Bracketed letter-series questions keep every marker.
  assert.deepEqual(impl.parse("ITU-R S.[4/BL/2]:").toHash(), {
    _type: "pubid:itu:question",
    sector: "R",
    series: "S",
    number: "4",
    study_group: "2",
    has_bl: true,
    bracketed: true,
    has_colon: true,
  });
  // Supplement-of-supplement chains nest base inside base.
  assert.deepEqual(impl.parse("ITU-T G.9701 (2014) Amd. 3 Err. 1 (12/2017)").toHash(), {
    _type: "pubid:itu:errata",
    number: "1",
    year: "2017",
    month: "12",
    base: {
      _type: "pubid:itu:amendment",
      number: "3",
      base: {
        _type: "pubid:itu:recommendation",
        sector: "T",
        series: "G",
        number: "9701",
        year: "2014",
      },
    },
  });
});

test("itu rejects non-identifiers", () => {
  const impl = grammarImplementation("itu")!;
  // Bad sector.
  assert.throws(() => impl.parse("ITU-X G.1"));
  // OB + dash is a clean parse failure by design (OB is never dashed).
  assert.throws(() => impl.parse("ITU OB-1"));
  assert.throws(() => impl.parse("ITU-T OB-1"));
  // A Report cannot be an Operational Bulletin.
  assert.throws(() => impl.parse("Report ITU-T OB.1"));
  // A supplement type without its ordinal.
  assert.throws(() => impl.parse("ITU-T A.1 Amd"));
  // Trailing junk.
  assert.throws(() => impl.parse("ITU-T G.711 extra"));
});
