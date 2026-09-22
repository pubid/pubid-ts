import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// ieee — the largest ledger flavor. Against the CURRENT Ruby main the
// testsuite's own verify loop documents the residual alias-family
// divergences after the stage-draft wave (tests/ieee/_status.yaml); every
// one of them reproduces here one-for-one (pended in
// conformance/pending.yaml).

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
  // The re-derived rawbib corpus (gem #436): convergent-spelling dedup
  // shrank the ledger from 10,007 to 9,410 cases.
  assert.ok(report.cases > 9300);
  // The 37-row residual the pubid reference itself documents
  // (tests/ieee/_status.yaml, after the stage-draft wave).
  assert.equal(report.pending, 37);
  // A pending case that passes must be unmarked.
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
  // No failures: the port matches the reference on every non-residual row,
  // and the reference's regenerated _negative rows all reject.
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
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

test("ieee joint stage-draft notation (docs/IEEE-DRAFT-STAGES.md)", () => {
  const impl = grammarImplementation("ieee")!;
  // The ordinal-less stage draft: D = the IEC stage it drafts, its date
  // riding inside the designator; the URN carries draft.D=<STAGE> and no
  // type segment (the stage is already the draft clause).
  const stage = impl.parse("IEC/IEEE P63113/D=CDV:2020");
  assert.equal(stage.toHuman(), "IEC/IEEE P63113/D=CDV:2020");
  assert.equal(stage.toUrn(), "urn:ieee:iec-ieee:P63113:draft.D=CDV:2020");
  // The compound both-systems form: IEEE draft ordinal = the ISO/IEC
  // stage, with its iteration. "=DDIS.3" (stage echoed with its own D)
  // is an accepted alias spelling of the canonical "=DIS.3".
  const compound = impl.parse("IEEE P24748-5/D5=DIS.3");
  assert.equal(compound.toHuman(), "IEEE P24748-5/D5=DIS.3");
  assert.equal(compound.toHash().draft, "D5=DIS.3");
  assert.equal(compound.toHash().stage, "DIS");
  assert.equal(compound.toHash().project_marker, true);
  const alias = impl.parse("IEEE P24748-5/D5=DDIS.3");
  assert.equal(alias.toHuman(), "IEEE P24748-5/D5=DIS.3");
  // The joint route echoes the doubled-D spelling as spelled.
  const joint = impl.parse("ISO/IEC/IEEE P26511/D8=DDIS.3");
  assert.equal(joint.toHuman(), "ISO/IEC/IEEE P26511/D8=DDIS.3");
  assert.equal(joint.toHash().ieee_draft, "D8=DDIS.3");
  // P = project (a draft): the marker is identity on an ISO-led
  // publisher, preserved through the hash and re-rendered.
  const led = impl.parse("ISO/IEC/IEEE P24774/DIS, July 2020");
  assert.equal(led.toHuman(), "ISO/IEC/IEEE P24774/DDIS, July 2020");
  assert.equal(led.toHash().project_marker, true);
});

test("ieee double-label and stage-draft rulings (gem #439/#440)", () => {
  const impl = grammarImplementation("ieee")!;
  // The glued-WD drafts are stage drafts: the 201x placeholder year is
  // replaced by the real year, WD is an ISO/IEC stage whose numeral is
  // the iteration.
  const wd = impl.parse("ISO/IEC/IEEE P16326:201x WD5, December 2017");
  assert.equal(wd.toHuman(), "ISO/IEC/IEEE P16326:2017/D=WD.5");
  assert.equal(wd.toHash().ieee_draft, "D=WD.5");
  const wd4a = impl.parse("ISO/IEC/IEEE P16326:201x WD.4a, July 2017");
  assert.equal(wd4a.toHuman(), "ISO/IEC/IEEE P16326:2017/D=WD.4a");
  // The "(E) ANSI/IEEE Std" spelling is a double-labeled standard: the
  // ISO/IEC label and the IEEE label of one document.
  const dual = impl.parse("ISO/IEC13210: 1994 (E) ANSI/IEEE Std 1003.3-1991");
  assert.equal(dual.toHuman(), "ISO/IEC 13210:1994 (E) and ANSI/IEEE 1003.3-1991");
  assert.equal(dual.toHash()._type, "pubid:ieee:dual-published");
  // The edition marker may sit between year and amendment tail.
  const amd = impl.parse("ISO/IEC/IEEE 8802.11:2012 (E)/Amd 1-2014");
  assert.equal(amd.toHuman(), "ISO/IEC/IEEE 8802.11:2012 (E)/Amd 1-2014");
});

test("oiml dual-published identifiers (gem #441)", () => {
  const impl = grammarImplementation("oiml")!;
  const dual = impl.parse("ISO 4064-1:2024|OIML R 49-1:2024");
  assert.equal(dual.toHuman(), "ISO 4064-1:2024|OIML R 49-1:2024");
  assert.equal(dual.toUrn(), "urn:oiml:r:49-1:2024");
  // Either side may print first; the URN is the OIML side's.
  const flipped = impl.parse("OIML R 49-1:2024|ISO 4064-1:2024");
  assert.equal(flipped.toHuman(), "OIML R 49-1:2024|ISO 4064-1:2024");
  assert.equal(flipped.toUrn(), "urn:oiml:r:49-1:2024");
});
