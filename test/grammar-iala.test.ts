import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import type { Identifier } from "../src/conformance/implementation.js";

// iala — 702 corpus rows across the S/R/G/M/C/GA/L series plus Annex
// wrappers (the legacy A session rows are GA rows, pubid#734),
// including the MRN URN aliases.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every iala corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("iala")!;
  const impl = grammarImplementation("iala")!;
  assert.ok(impl, "iala is grammar-backed");
  const report = runFlavor(
    "iala",
    payloads,
    impl,
    PendingRegistry.load(
      process.env["PENDING_PATH"] ?? "conformance/pending.yaml",
    ),
  );
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  // The 162 codeless slug-publication rows (testsuite round #122) ride the
  // slug-port wave: the artifact parses them, no builder binds the type yet,
  // so they ledger-pend with reason + ref; the flavor stays clean, so the
  // outcome is pass with the pending count carried on the report.
  assert.equal(report.outcome, "pass");
  assert.equal(report.pending, 162);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
  assert.equal(report.cases, payloads.cases.length - 162);
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

// pubid#734: the legacy A session letter is GeneralAssembly's form, not
// Advice — the A letter routes to the GA class, and the letter form is
// derived from the number shape (dashed A-session numbers vs dotted GA
// numbers), so no extra attribute is stored and the canonical hash is
// the GA one. The input letter round-trips verbatim through toHuman and
// the MRN URN; the pubid-scheme URN carries the type token "ga" for
// both letter forms.
test("iala routes the legacy A session letter to GeneralAssembly", () => {
  const impl = grammarImplementation("iala")!;
  // The 11 legacy corpus rows: dashed A-session numbers are GA rows.
  assert.deepEqual(impl.parse("IALA A12-01").toHash(), {
    _type: "pubid:iala:general-assembly",
    number: "12-01",
  });
  assert.equal(impl.parse("IALA A12-01").toHuman(), "IALA A12-01");
  assert.equal(impl.parse("IALA A12-01").toUrn(), "urn:mrn:iala:pub:a12-01");
  assert.equal(impl.parse("IALA A13-04 (E)").toHuman(), "IALA A13-04 (E)");
  assert.deepEqual(impl.parse("IALA A13-04 (E)").toHash(), {
    _type: "pubid:iala:general-assembly",
    number: "13-04",
    language: "E",
  });
  assert.equal(impl.parse("IALA A13-04 (E)").toUrn(), "urn:mrn:iala:pub:a13-04:e");
  // The A letter inside an Annex wrapper routes its base to GA too.
  assert.equal(impl.parse("IALA A12-01 Annex").toUrn(), "urn:mrn:iala:pub:a12-01:annex");
  // The MRN URN round-trips back through the same A form.
  assert.equal(impl.parse("urn:mrn:iala:pub:a12-01").toHuman(), "IALA A12-01");
  // Dotted numbers carry the canonical GA letter — unchanged behavior.
  assert.equal(impl.parse("IALA GA01.01").toHuman(), "IALA GA01.01");
  assert.deepEqual(impl.parse("IALA GA01.01").toHash(), {
    _type: "pubid:iala:general-assembly",
    number: "01.01",
  });
  // The pubid-scheme URN keeps the type token "ga" for both letter
  // forms (the schema has no letter_form placement; the retired
  // pubid:iala:advice type no longer resolves).
  assert.equal(
    (impl.parse("IALA A12-01") as unknown as { toPubidUrn(): string }).toPubidUrn(),
    "urn:pubid:iala:ga:12-01",
  );
  assert.equal(
    (impl.parse("IALA GA01.01") as unknown as { toPubidUrn(): string }).toPubidUrn(),
    "urn:pubid:iala:ga:01.01",
  );
  // Polymorphic round-trip: the A form survives fromHash (derived from
  // the dashed number, and an e82b5a9-shaped letter_form key is
  // ignored — the wire form carries no letter_form).
  const id = impl.parse("IALA A12-01");
  const rt = (id.constructor as unknown as { fromHash(h: Record<string, unknown>): Identifier })
    .fromHash(id.toHash());
  assert.equal(rt.toHuman(), "IALA A12-01");
  assert.deepEqual(rt.toHash(), id.toHash());
  const keyed = (id.constructor as unknown as { fromHash(h: Record<string, unknown>): Identifier })
    .fromHash({ _type: "pubid:iala:general-assembly", number: "12-01", letter_form: "A" });
  assert.deepEqual(keyed.toHash(), id.toHash());
  assert.equal(keyed.toHuman(), "IALA A12-01");
});

test("iala rejects non-identifiers", () => {
  const impl = grammarImplementation("iala")!;
  assert.throws(() => impl.parse("IALA"));
  assert.throws(() => impl.parse("S"));
  assert.throws(() => impl.parse("B1070"));
  assert.throws(() => impl.parse("S1070 Ed"));
  assert.throws(() => impl.parse("urn:mrn:iala:pub:"));
});
