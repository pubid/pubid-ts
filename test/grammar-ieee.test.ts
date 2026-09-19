import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// ieee — 9,358 corpus rows, the largest remaining ledger flavor. The corpus
// carries 985 recorded known mismatches; against the CURRENT Ruby main the
// testsuite's own verify loop fails 625 rows, and every one of those
// reproduces here one-for-one (pended in conformance/pending.yaml). The
// residual failures are stale _negative.yaml rows the current gem also
// parses (the fixtures predate the gem's grammar widenings).

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every ieee corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("ieee")!;
  const impl = grammarImplementation("ieee")!;
  assert.ok(impl, "ieee is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("ieee", payloads, impl, pending);
  assert.equal(report.outcome, "ledger");
  assert.equal(
    report.cases + report.pending + report.review,
    payloads.cases.length - report.errors,
  );
  assert.ok(report.cases > 8700);
  assert.equal(report.pending, 613);
  // A pending case that passes must be unmarked.
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
  // The only residual failures are the stale negative fixtures: the Ruby
  // reference parses every one of them today (verified against pubid main
  // with the testsuite's own verify loop over _negative.yaml).
  const nonNegative = report.failures.filter((f) => !f.includes("unexpectedly parsed"));
  assert.equal(nonNegative.length, 0, nonNegative.slice(0, 10).join("; "));
  assert.equal(report.failures.length, 155);
});

test("ieee parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("ieee")!;
  // Published standards, parts and prefixes.
  assert.equal(impl.parse("IEEE Std 802.3-2018").toHuman(), "IEEE Std 802.3-2018");
  assert.equal(impl.parse("ANSI/IEEE C37.09-1979").toHuman(), "ANSI/IEEE C37.09-1979");
  // Drafts with dates, revisions and update-code normalizations.
  assert.equal(
    impl.parse("IEEE Unapproved Std P1076.1/D3.3, Feb2007").toHuman(),
    "IEEE Unapproved P1076.1/D3.3, Feb 2007",
  );
  // The relationship narrative is runtime-only; to_s renders the bounded id.
  assert.equal(
    impl.parse("IEEE Std C57.12.60-2009 (Revision of IEEE Std C57.12.60-1993)").toHuman(),
    "IEEE Std C57.12.60-2009",
  );
  // Supplements.
  assert.equal(
    impl.parse("IEEE Std 535-2013/Cor. 1-2017").toHuman(),
    "IEEE Std 535-2013/Cor. 1-2017",
  );
  assert.equal(
    impl.parse("IEEE Std 802.3-2018/Amd 4-2020").toHuman(),
    "IEEE Std 802.3-2018/Amd 4-2020",
  );
  // Joint ISO-led and copublished forms.
  assert.equal(impl.parse("ISO/IEC/IEEE FDIS 26511:2018").toHuman(), "ISO/IEC/IEEE FDIS 26511:2018");
  assert.equal(impl.parse("IEC/IEEE 60076-2016").toHuman(), "IEC/IEEE 60076-2016");
  // Historical AIEE/IRE spellings.
  assert.equal(impl.parse("AIEE No 18-1934").toHuman(), "AIEE No 18-1934");
  assert.equal(impl.parse("52 IRE 7.S2").toHuman(), "52 IRE 7.S2");
  // NESC and redlines.
  assert.equal(
    impl.parse("C2-1997 National Electrical Safety Code").toHuman(),
    "C2-1997 National Electrical Safety Code",
  );
  assert.equal(impl.parse("IEEE Std 802.16-2012 Redline").toHuman(), "IEEE Std 802.16-2012 - Redline");
  // The URN relationship narrative and code columns.
  const rel = impl.parse("IEEE Std C57.12.60-2009 (Revision of IEEE Std C57.12.60-1993)");
  assert.equal(
    rel.toUrn(),
    "urn:ieee:ieee:C57.12.60:2009:rel.Revision of IEEE Std C57.12.60-1993",
  );
  // The trademark-less plain render is additive-safe (no ™/® without the flag).
  assert.equal(impl.parse("IEEE Std 802.3-2018").toHuman(), "IEEE Std 802.3-2018");
});

test("ieee rejects non-identifiers", () => {
  const impl = grammarImplementation("ieee")!;
  // The number rule requires a digit: an all-letter copublished placeholder
  // and a bare letter prefix reject (Ruby's tightening).
  assert.throws(() => impl.parse("IEC/IEEE TR"));
  assert.throws(() => impl.parse("IEEE S"));
  assert.throws(() => impl.parse("IEEE Std"));
});
