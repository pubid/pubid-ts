import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// asme — 621 corpus rows, a LEDGER flavor (13 known mismatches in
// _status.yaml; the testsuite verify loop reports 13 failing case
// ids). Those are pended one-for-one; everything else must pass.

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
  assert.equal(report.outcome, "ledger");
  assert.equal(
    report.cases + report.pending,
    payloads.cases.length - report.errors,
  );
  // The ledger's gem-known mismatches (generated from the testsuite
  // verify loop over the gem, /tmp/verify-asme.rb).
  assert.equal(report.pending, 13);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("asme parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("asme")!;
  assert.equal(impl.parse("ASME B16.5-2020").toHuman(), "ASME B16.5-2020");
  assert.equal(impl.parse("ASME B16.5-2020").toUrn(), "urn:asme:asme:B16.5:2020");
  // BPVC subdivisions assemble through the designator tree (a year
  // suffix after a dotted subdivision is consumed by the number rule —
  // gem behavior).
  assert.equal(impl.parse("ASME BPVC.III.1.NB-2023").toHuman(), "ASME BPVC.III.1.NB");
  assert.equal(impl.parse("ASME BPVC-CC-BPV-2023").toUrn(), "urn:asme:asme:BPVC-CC-BPV");
  assert.equal(impl.parse("ASME BPVC COMPLETE CODE BIND").toHuman(), "ASME BPVC COMPLETE CODE BIND");
  // PTC keeps the space-separated number concatenated into the code.
  assert.equal(impl.parse("ASME PTC 4-2013").toHuman(), "ASME PTC4-2013");
  // Joint publications.
  assert.equal(impl.parse("ISO/ASME 14414-2015").toUrn(), "urn:asme:iso/asme:14414:2015:joint.iso/asme");
  const csaJoint = impl.parse("CSA B44.10/ASME A17.10");
  assert.equal(csaJoint.toHash()["publisher"], "CSA/ASME");
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
