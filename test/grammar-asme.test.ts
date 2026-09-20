import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// asme — 773 corpus rows, clean: the grammar mirrors the gem's
// trailing-year guard, the BPVC code assembly (SSC sections under
// `ssc_code`, the double-dot case sub-code) and the catalogue
// alternate spellings (glued PTC/TR, space-form joint includes,
// numberless ISO/ASME).

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every asme corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("asme")!;
  const impl = grammarImplementation("asme")!;
  assert.ok(impl, "asme is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("asme", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length - report.errors);
  assert.equal(report.pending, 0);
  // A pending case that passes must be unmarked.
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("asme parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("asme")!;
  assert.equal(impl.parse("ASME B16.5-2020").toHuman(), "ASME B16.5-2020");
  assert.equal(impl.parse("ASME B16.5-2020").toUrn(), "urn:asme:asme:B16.5:2020");
  // A designator with no number keeps its year (the trailing-year
  // guard stops number_part reading "-2023" as a dashed number).
  assert.equal(impl.parse("ASME BPVC.III.1.NB-2023").toHuman(), "ASME BPVC.III.1.NB-2023");
  assert.equal(impl.parse("ASME BPE-2012").toHash()["year"], "2012");
  assert.equal(impl.parse("ASME BPVC-CC-BPV-2023").toUrn(), "urn:asme:asme:BPVC-CC-BPV:2023");
  assert.equal(impl.parse("ASME BPVC COMPLETE CODE BIND-2019").toHuman(), "ASME BPVC COMPLETE CODE BIND-2019");
  // The SSC sections sit under ssc_code; the bare series identity and
  // the double-dot case sub-code are catalogue spellings.
  assert.equal(impl.parse("ASME BPVC.SSC.XI.II.V.IX-2021").toHash()["number"], "BPVC.SSC.XI.II.V.IX");
  assert.equal(impl.parse("ASME BPVC.SSC.").toHuman(), "ASME BPVC.SSC.");
  assert.equal(impl.parse("ASME BPVC.CC.BPV..I").toHuman(), "ASME BPVC.CC.BPV.I");
  // PTC and TR render glued to their number, and both spellings parse.
  assert.equal(impl.parse("ASME PTC 4-2013").toHuman(), "ASME PTC4-2013");
  assert.equal(impl.parse("ASME PTC19.3 TW-2010").toHuman(), "ASME PTC19.3 TW-2010");
  assert.equal(impl.parse("ASME TRA17.1-8.4-2013").toHuman(), "ASME TRA17.1-8.4-2013");
  // Joint publications: numbered adoptions, the numberless ISO/ASME
  // series identity, and the space form before "/ASME".
  assert.equal(impl.parse("ISO/ASME 14414-2015").toUrn(), "urn:asme:iso/asme:14414:2015:joint.iso/asme");
  assert.equal(impl.parse("ISO/ASME-2015").toHuman(), "ISO/ASME-2015");
  assert.equal(impl.parse("API 579-2 /ASME PTB-14-2009").toHash()["number"], "PTB-14");
  const csaJoint = impl.parse("CSA B44.10/ASME A17.10");
  assert.equal(csaJoint.toHash()["publisher"], "CSA/ASME");
  assert.equal(impl.parse("CSA B44.10 /ASME A17.10-2024").toHuman(), "CSA B44.10 /ASME A17.10-2024");
  // CSA dual numbers and handbooks mark the URN's special slot.
  assert.equal(
    impl.parse("ASME A17.1/CSA B44 Handbook-2010").toUrn(),
    "urn:asme:handbook:asme:A17.1:2010:csa.B44",
  );
  // Draft years, languages, and reaffirmations.
  const draft = impl.parse("ASME B31.8 (SPANISH)-2016 (R2020)");
  assert.equal(draft.toHash()["language"], "SPANISH");
  assert.equal(draft.toHash()["reaffirmation"], "R2020");
  assert.equal(draft.toUrn(), "urn:asme:asme:B31.8:2016:spanish:reaff.R2020");
});
