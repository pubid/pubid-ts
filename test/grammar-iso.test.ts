import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// iso — 7,630 corpus rows, the largest single flavor. Clean: the
// subgroup scalar and the supplement context propagation mirror the
// gem, and the remaining unparsed-fixture debt rows (CEN/TS 15370-1,
// EN 12643, ISO/IEC Directives JTC 1 Supplement) are reference defects
// tracked in tests/iso/_debt.yaml, not pends.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every iso corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("iso")!;
  const impl = grammarImplementation("iso")!;
  assert.ok(impl, "iso is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("iso", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length - report.errors);
  assert.ok(report.cases > 7500);
  assert.equal(report.pending, 0);
  // A pending case that passes must be unmarked.
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("iso parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("iso")!;
  // The update-codes normalizations: dotted supplement spellings and
  // long-form draft stages.
  assert.equal(impl.parse("ISO 10993-4:2002/Amd.1:2006").toHuman(), "ISO 10993-4:2002/Amd 1:2006");
  assert.equal(impl.parse("ISO/DIS TR 12181").toHuman(), "ISO/DTR 12181");
  assert.equal(impl.parse("ISO 1234/DIS Amd 1").toHuman(), "ISO 1234/DAM 1");
  // The DAD-pattern manual parse (the grammar treats "/" as a
  // copublisher separator).
  assert.deepEqual(impl.parse("ISO 2631/DAD 1:1987").toHash(), {
    _type: "pubid:iso:addendum",
    number: "1",
    year: "1987",
    stage: "dad",
    base: { _type: "pubid:iso:international-standard", number: "2631" },
  });
  // Cyrillic (Russian) identifiers normalize to Latin.
  assert.equal(impl.parse("ИСО/ТО 10303-11:1994").toHuman(), "ISO/TR 10303-11:1994");
  // Legacy ISO/R Recommendations.
  assert.equal(impl.parse("ISO/R 947:1969").toUrn(), "urn:iso:std:iso:r:947");
  // NSB stage prefixes.
  assert.equal(impl.parse("FprISO/IEC 17029").toHuman(), "ISO/IEC PRF 17029");
  // The undated-reference form drops the URN year slot.
  assert.equal(impl.parse("ISO 16634:--").toUrn(), "urn:iso:std:iso:16634");
  // Legacy 4-digit-year parts become dates.
  assert.deepEqual(impl.parse("ISO 4037-1979").toHash(), {
    _type: "pubid:iso:international-standard",
    number: "4037",
    year: "1979",
  });
  // Legacy slash parts normalize to dashes.
  assert.equal(impl.parse("ISO 5843/6").toHuman(), "ISO 5843-6");
  // The supplement renderer propagates its stage format to the base:
  // a nested amendment renders the short "AMD" under a staged "CD Cor"
  // top, the long "Amd" under an unstaged "Cor" top (mirrors Ruby).
  assert.equal(
    impl.parse("ISO/IEC 15938-7:2003/Amd 5:2010/CD Cor 1").toHuman(),
    "ISO/IEC 15938-7:2003/AMD 5:2010/CD Cor 1",
  );
  assert.equal(
    impl.parse("ISO/IEC 13818-1:2015/Amd 3:2016/Cor 1:2017").toHuman(),
    "ISO/IEC 13818-1:2015/Amd 3:2016/Cor 1:2017",
  );
});

test("iso rejects non-identifiers", () => {
  const impl = grammarImplementation("iso")!;
  assert.throws(() => impl.parse("ISO"));
  assert.throws(() => impl.parse("ISO/IEC"));
  assert.throws(() => impl.parse("DIN 1234"));
  // The bare prefix + DAM shape rejects on Ruby too.
  assert.throws(() => impl.parse("ISO/DIS Amd 1"));
  assert.throws(() => impl.parse("ISO 8601:2019 extra"));
  // The known reference defect — Ruby rejects it too.
  assert.throws(() => impl.parse("ISO/IEC DIR 1 + IEC SUP:2016-05-05-05"));
});
