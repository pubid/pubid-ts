import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// cen_cenelec — 187 corpus rows, CLEAN since pubid#416 taught the
// reference (and this port) the compact fragment spelling
// "EN 60038/A1 FRAG2".

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every cen_cenelec corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("cen_cenelec")!;
  const impl = grammarImplementation("cen_cenelec")!;
  assert.ok(impl, "cen_cenelec is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("cen_cenelec", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  // Clean since the compact fragment spelling landed (pubid#416).
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases + report.pending, payloads.cases.length - report.errors);
  assert.equal(report.pending, 0);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("cen_cenelec parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("cen_cenelec")!;
  // Plain documents across the type family.
  assert.equal(impl.parse("EN 10160:1999").toHuman(), "EN 10160:1999");
  assert.equal(impl.parse("CWA 14050-21:2000").toHuman(), "CWA 14050-21:2000");
  assert.equal(impl.parse("HD 1215-2:1988").toHuman(), "HD 1215-2:1988");
  assert.equal(impl.parse("ENV 1613:1995").toHuman(), "ENV 1613:1995");
  // Copublished TR/TS keep the slash-joined publisher and type.
  assert.equal(impl.parse("CEN/CLC/TR 17602-80-12:2021").toHuman(), "CEN/CLC/TR 17602-80-12:2021");
  // Draft stages serialize as one code.
  assert.deepEqual(impl.parse("prEN 1234:2020").toHash(), {
    _type: "pubid:cencenelec:european-norm",
    number: "1234",
    year: "2020",
    stage: "pren",
  });
  // Supplements: slash standalone, plus consolidated.
  assert.equal(impl.parse("EN 13250:2000/A1:2005").toHuman(), "EN 13250:2000/A1:2005");
  assert.equal(impl.parse("EN 13254:2000/AC:2016-11").toHuman(), "EN 13254:2000/AC:2016-11");
  assert.equal(impl.parse("EN 285:2015+A1:2021").toHuman(), "EN 285:2015+A1:2021");
  // Adoptions carry the adopted iso/iec document; the implicit IEC
  // adoption maps the 60000-79999 number range.
  assert.equal(impl.parse("CEN ISO/TS 21003-7:2008").toHuman(), "CEN ISO/TS 21003-7:2008");
  assert.equal(impl.parse("EN IEC 62115:2020").toHuman(), "EN IEC 62115:2020");
  const implicitHash = impl.parse("EN 60038").toHash() as { adopted?: { _type?: string } };
  assert.equal(implicitHash["adopted"]?.["_type"], "pubid:iec:international-standard");
  // URNs: supplement markers, plus markers, adoption bodies.
  assert.equal(
    impl.parse("EN 13250:2000/A1:2005").toUrn(),
    "urn:cen:en:13250:2000:amd:1:2005",
  );
  assert.equal(
    impl.parse("EN 285:2015+A1:2021").toUrn(),
    "urn:cen:en:285:2015:plus:amd:1:2021",
  );
  assert.equal(
    impl.parse("CEN ISO/TS 21003-7:2008").toUrn(),
    "urn:cen:cen:iso:ts:21003-7:2008",
  );
});

test("cen_cenelec rejects non-identifiers", () => {
  const impl = grammarImplementation("cen_cenelec")!;
  // "EN" alone parses (a publisher-only id, like Ruby); a foreign
  // publisher or junk rejects.
  assert.doesNotThrow(() => impl.parse("EN"));
  assert.throws(() => impl.parse("ISO 1234"));
  assert.throws(() => impl.parse("NONSENSE 123"));
});
