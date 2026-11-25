import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import type { Identifier } from "../src/conformance/implementation.js";

// iala — 880 corpus rows across the S/R/G/M/C/GA/L series plus Annex
// wrappers (the legacy A session rows are GA rows, pubid#734), the
// codeless slug publications (gem #772) and the S-100-family product
// specifications (pubid#777), including the MRN URN aliases.

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
  // The ledger is EMPTY again: the 162 codeless slug-publication rows
  // (testsuite round #122) unmarked once the slug type ported (gem
  // #772, grammar #146) — pending-satisfied verified, then removed.
  assert.equal(report.outcome, "pass");
  assert.equal(report.pending, 0);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 870);
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

// pubid#777 (grammar #146): the IHO-granted S-201..S-299 product
// specifications. The bare dotted edition is canonical ("S-201 2.0.0",
// iala.int's own citation form); the "IALA " prefix, the "Ed" marker
// and the compact ":ed" form are normalizing aliases; the lower-case
// code spelling binds the typed form, never the codeless slug. The
// designation carries no publisher token.
test("iala parses the S-100-family product specifications", () => {
  const impl = grammarImplementation("iala")!;
  assert.equal(impl.parse("S-201 2.0.0").toHuman(), "S-201 2.0.0");
  assert.deepEqual(impl.parse("S-201 2.0.0").toHash(), {
    _type: "pubid:iala:product-specification",
    number: "201",
    edition: "2.0.0",
  });
  assert.equal(impl.parse("S-201").toHuman(), "S-201");
  // The granted range beyond S-201 (the dev-status pages).
  assert.equal(impl.parse("IALA S-230 1.0.0 (E)").toHuman(), "S-230 1.0.0 (E)");
  assert.deepEqual(impl.parse("IALA S-230 1.0.0 (E)").toHash(), {
    _type: "pubid:iala:product-specification",
    number: "230",
    edition: "1.0.0",
    language: "E",
  });
  // The prefixed spellings normalize to the bare face.
  for (const spelling of ["IALA S-201 2.0.0", "IALA S-201 Ed 2.0.0", "IALA S-201:ed2.0.0", "IALA s-201 2.0.0"]) {
    assert.equal(impl.parse(spelling).toHuman(), "S-201 2.0.0", spelling);
  }
  // The MRN URN carries the hyphenated code face and all three
  // edition segments; the URN round-trips and restores the bare face.
  assert.equal(impl.parse("S-201 2.0.0").toUrn(), "urn:mrn:iala:pub:s-201:ed2.0.0");
  assert.equal(impl.parse("S-247 0.2.0 (E)").toUrn(), "urn:mrn:iala:pub:s-247:ed0.2.0:e");
  assert.equal(impl.parse("urn:mrn:iala:pub:s-201:ed2.0.0").toHuman(), "S-201 2.0.0");
  // Polymorphic round-trip through fromHash.
  const id = impl.parse("S-230 1.0.0 (E)");
  const rt = (id.constructor as unknown as { fromHash(h: Record<string, unknown>): Identifier })
    .fromHash(id.toHash());
  assert.equal(rt.toHuman(), "S-230 1.0.0 (E)");
});

// The annex wrapper rides the same class; the letter takes the
// sub-numbered form the S-201 package attests ("Annex B2", "Annex D1"),
// and the annex edition face follows the base's family (bare for
// S-100, "Ed" for the legacy series).
test("iala wraps S-100 annexes with sub-numbered letters", () => {
  const impl = grammarImplementation("iala")!;
  assert.deepEqual(impl.parse("IALA S-201 ANNEX B2").toHash(), {
    _type: "pubid:iala:annex",
    base: { _type: "pubid:iala:product-specification", number: "201" },
    annex_form: "ANNEX",
    letter: "B2",
  });
  assert.equal(impl.parse("IALA S-201 ANNEX B2").toHuman(), "S-201 ANNEX B2");
  assert.equal(impl.parse("IALA S-201 ANNEX B2").toUrn(), "urn:mrn:iala:pub:s-201:annex-b2");
  assert.equal(impl.parse("IALA S-201 Annex A 1.0.0").toHuman(), "S-201 Annex A 1.0.0");
  // The URN parser reads the sub-numbered letter back.
  assert.equal(impl.parse("urn:mrn:iala:pub:s-201:annex-b2").toHuman(), "S-201 ANNEX B2");
  // The legacy annex keeps the "Ed" face, and its letters may now
  // carry a sub-number too.
  assert.equal(impl.parse("IALA G1128 ANNEX D1 Ed 1.6").toHuman(), "IALA G1128 ANNEX D1 Ed 1.6");
});

// gem #772 (relaton#604): the codeless slug publications — the slug is
// `number` (the index key), two or more hyphen-joined [a-z0-9] runs
// whose first run is not code-like; the "IALA " prefix is mandatory;
// the type has no MRN URN.
test("iala parses the codeless slug publications", () => {
  const impl = grammarImplementation("iala")!;
  assert.deepEqual(impl.parse("IALA arctic-seminar-report").toHash(), {
    _type: "pubid:iala:publication",
    number: "arctic-seminar-report",
  });
  assert.equal(impl.parse("IALA arctic-seminar-report (E)").toHuman(), "IALA arctic-seminar-report (E)");
  assert.deepEqual(impl.parse("IALA arctic-seminar-report (E)").toHash(), {
    _type: "pubid:iala:publication",
    number: "arctic-seminar-report",
    language: "E",
  });
  // Edition and language separate from the slug.
  assert.deepEqual(impl.parse("IALA iala-style-guide Ed 1.0 (E)").toHash(), {
    _type: "pubid:iala:publication",
    number: "iala-style-guide",
    edition: "1.0",
    language: "E",
  });
  // An integer edition stays verbatim.
  assert.equal(
    impl.parse("IALA iala-world-wide-radio-navigation-plan Ed 2").toHuman(),
    "IALA iala-world-wide-radio-navigation-plan Ed 2",
  );
  // Digit-leading slugs parse (13th-vts-symposium-report, the corpus's
  // longest slug among them).
  assert.equal(
    impl.parse("IALA 13th-vts-symposium-report (E)").toHuman(),
    "IALA 13th-vts-symposium-report (E)",
  );
  // No official MRN URN (the gem's Publication#to_urn → nil); the
  // pubid-scheme URN still names it.
  const id = impl.parse("IALA arctic-seminar-report");
  assert.equal(id.toUrn(), undefined);
  assert.equal(
    (id as unknown as { toPubidUrn(): string }).toPubidUrn(),
    "urn:pubid:iala:pub:~61rctic-seminar-report",
  );
  // Polymorphic round-trip through fromHash.
  const rt = (id.constructor as unknown as { fromHash(h: Record<string, unknown>): Identifier })
    .fromHash(id.toHash());
  assert.equal(rt.toHuman(), "IALA arctic-seminar-report");
  assert.deepEqual(rt.toHash(), id.toHash());
});

test("iala rejects non-identifiers", () => {
  const impl = grammarImplementation("iala")!;
  assert.throws(() => impl.parse("IALA"));
  assert.throws(() => impl.parse("S"));
  assert.throws(() => impl.parse("B1070"));
  assert.throws(() => impl.parse("S1070 Ed"));
  assert.throws(() => impl.parse("urn:mrn:iala:pub:"));
});

// The grant bounds: outside the granted S-201..S-299 range nothing
// parses — S-200 is excluded ("spans from S-201"), the other hundreds
// digits are the other orgs' grants (WMO's S-4xx, IHO's S-1xx), and
// the shape rejects (the testsuite's negative ledger, #125).
test("iala rejects the grant-bound S-100 shapes", () => {
  const impl = grammarImplementation("iala")!;
  const reject = (input: string) =>
    assert.throws(() => impl.parse(input), (e: Error) => e.name === "ParseFailed", input);
  for (const input of [
    "S-200 1.0.0",
    "S-411 1.2.1",
    "S-101 1.0.0",
    "S-30 2.0",
    "S-2011 2.0.0",
    "S-201 Ed",
    "IALA S-411 1.2.1",
    "IALA S-200 1.0.0",
  ]) {
    reject(input);
  }
});

// The slug is narrow on purpose (the gem's rejection table): the
// "IALA " prefix is mandatory, a slug is lower-case with no spaces and
// two or more runs, and a lower-case or letterless typo of a typed
// code is not a slug.
test("iala rejects the slug-adjacent shapes", () => {
  const impl = grammarImplementation("iala")!;
  const reject = (input: string) =>
    assert.throws(() => impl.parse(input), (e: Error) => e.name === "ParseFailed", input);
  for (const input of [
    "arctic-seminar-report",
    "IALA Arctic-Seminar-Report",
    "IALA arctic seminar report",
    "IALA -arctic-seminar-report",
    "IALA arctic-seminar-report Ed",
    "IALA arctic",
    "IALA arctic-",
    "IALA arctic--report",
    "IALA s1070",
    "IALA g1164 Ed 1.1",
    "IALA c0103-1",
    "IALA ga01-13",
    "IALA 1070 Ed 2.0",
  ]) {
    reject(input);
  }
});
