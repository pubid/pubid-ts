import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import type { BaseIdentifier } from "../src/model/identifier.js";

// itu — 2,756 corpus rows (14 types, the Resolution joining with the
// testsuite#117 round), the grammar fully mirroring
// lib/pubid/itu/parser.rb including the marker-capture spellings.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every itu corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("itu")!;
  const impl = grammarImplementation("itu")!;
  assert.ok(impl, "itu is grammar-backed");
  const report = runFlavor("itu", payloads, impl, PendingRegistry.load("conformance/pending.yaml"));
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length - report.pending);
  assert.equal(report.pending, 0);
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
  // The Operational Bulletin long forms: the sector is kept and rendered
  // (gem#460 — the TSB spelling names the bulletin it cites); the
  // sector-less spelling keeps the classic "ITU OB No. X" form.
  assert.equal(impl.parse("ITU-T Operational Bulletin No. 1096").toHuman(), "ITU-T OB.1096");
  assert.equal(impl.parse("ITU Operational Bulletin No. 1096").toHuman(), "ITU OB No. 1096");
  // The Radio Regulations and the publication id (gem#460).
  assert.equal(impl.parse("ITU-R RR-2020").toHuman(), "ITU-R RR (2020)");
  assert.equal(impl.parse("T-REC-T.4-200307-I").toHuman(), "ITU-T T.4 (07/2003)");
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

// relaton#402 (testsuite#117): the ITU-R Resolution rows — a number and
// its revision (code.parts), never a series, with the optional year.
test("itu parses the R-Resolution forms", () => {
  const impl = grammarImplementation("itu")!;
  assert.deepEqual(impl.parse("Resolution ITU-R 1").toHash(), {
    _type: "pubid:itu:resolution",
    sector: "R",
    number: "1",
  });
  assert.equal(impl.parse("Resolution ITU-R 1").toUrn(), "urn:itu:r:resolution:1");
  // The revision rides code.parts; the year is the parenthesised date.
  assert.deepEqual(impl.parse("Resolution ITU-R 1-9 (2023)").toHash(), {
    _type: "pubid:itu:resolution",
    sector: "R",
    number: "1",
    parts: ["9"],
    year: "2023",
  });
  assert.equal(
    impl.parse("Resolution ITU-R 1-9 (2023)").toUrn(),
    "urn:itu:r:resolution:1-9:2023",
  );
  // The infix and abbreviated spellings render ITU's leading form.
  assert.equal(impl.parse("ITU-R Resolution 2-8 (2019)").toHuman(), "Resolution ITU-R 2-8 (2019)");
  assert.equal(impl.parse("Res. ITU-R 1").toHuman(), "Resolution ITU-R 1");
  assert.equal(impl.parse("ITU-R Res. 10-1").toHuman(), "Resolution ITU-R 10-1");
  // Resolutions number independently of Recommendations, so the class
  // and the marker split the same number pair in both directions.
  const resolution = impl.parse("Resolution ITU-R 1-9") as BaseIdentifier;
  const recommendation = impl.parse("ITU-R 1-9") as BaseIdentifier;
  assert.equal(recommendation.toHash()._type, "pubid:itu:recommendation");
  assert.equal(resolution.equals(recommendation), false);
  assert.equal(recommendation.equals(resolution), false);
  // The legacy relaton-data-itu spelling carries no marker: it stays a
  // Recommendation of series R (the resolution rule must not steal it).
  assert.equal(impl.parse("ITU-R R.1-9").toHash()._type, "pubid:itu:recommendation");
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
