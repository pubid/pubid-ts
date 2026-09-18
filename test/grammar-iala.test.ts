import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// iala — 702 corpus rows across 11 types, including the MRN URN aliases.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every iala corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("iala")!;
  const impl = grammarImplementation("iala")!;
  assert.ok(impl, "iala is grammar-backed");
  const report = runFlavor("iala", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 690);
});

test("iala parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("iala")!;
  // Unpadded numbers re-pad to the class's canonical cover-page width.
  assert.deepEqual(impl.parse("GA1.1").toHash(), {
    _type: "pubid:iala:general-assembly",
    number: "01.01",
  });
  assert.equal(impl.parse("IALA M1").toHuman(), "IALA M0001");
  // The compact ":ed2.0" edition and glued "(F)" language.
  assert.deepEqual(impl.parse("R1016:ed2.0(F)").toHash(), {
    _type: "pubid:iala:recommendation",
    number: "1016",
    edition: "2.0",
    language: "F",
  });
  // Dotted letters keep their sub-part suffix verbatim.
  assert.equal(impl.parse("L2.7.1-2").toUrn(), "urn:mrn:iala:pub:l2.7.1-2");
  // Multi-segment subparts join with dashes.
  assert.equal(impl.parse("R0124-9-10").toHuman(), "IALA R0124-9-10");
  // A bare Annex keeps the casing it was given.
  assert.deepEqual(impl.parse("G1045 Annex").toHash(), {
    _type: "pubid:iala:annex",
    base: { _type: "pubid:iala:guideline", number: "1045" },
    annex_form: "Annex",
  });
  // URN round trip: lettered annexes and the "ed.1.0" edition spelling.
  assert.equal(
    impl.parse("urn:mrn:iala:pub:g1128:annex-a:ed1.6").toUrn(),
    "urn:mrn:iala:pub:g1128:annex-a:ed1.6",
  );
  assert.equal(
    impl.parse("urn:mrn:iala:pub:r1026:ed.1.0").toHuman(),
    "IALA R1026 Ed 1.0",
  );
});

test("iala rejects non-identifiers", () => {
  const impl = grammarImplementation("iala")!;
  assert.throws(() => impl.parse("IALA"));
  assert.throws(() => impl.parse("S"));
  assert.throws(() => impl.parse("B1070"));
  assert.throws(() => impl.parse("S1070 Ed"));
  assert.throws(() => impl.parse("urn:mrn:iala:pub:"));
});
