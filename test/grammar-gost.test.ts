import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// gost — 199 corpus rows, a CLEAN flavor (0 known mismatches): every case
// must pass with no pends.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every gost corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("gost")!;
  const impl = grammarImplementation("gost")!;
  assert.ok(impl, "gost is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("gost", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length - report.errors);
  assert.equal(report.pending, 0);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("gost parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("gost")!;
  // Interstate and national standards, dotted numbers, two-digit years.
  assert.equal(impl.parse("GOST 14946-82").toHuman(), "GOST 14946-82");
  assert.equal(impl.parse("ГОСТ 2.312").toHuman(), "GOST 2.312");
  assert.equal(impl.parse("ГОСТ Р 71039— 2023").toHuman(), "GOST R 71039-2023");
  // Cyrillic copublisher/subtype normalization (compound forms, longest
  // keys first).
  assert.equal(impl.parse("ГОСТ Р ИСО/МЭК МФС 10609-9-95").toHuman(), "GOST R ISO/IEC ISP 10609-9-95");
  assert.equal(impl.parse("ГОСТ МЭК 60794-1-23-2017").toHuman(), "GOST IEC 60794-1-23-2017");
  // Latin-script copublisher and the Guide subtype pass through.
  assert.equal(impl.parse("GOST ISO Guide 30-2019").toHuman(), "GOST ISO Guide 30-2019");
  // Identical adoptions carry the base and the adopted foreign id.
  assert.equal(impl.parse("GOST R 57415-2017/EN 1548:2007").toHuman(), "GOST R 57415-2017/EN 1548:2007");
  // Harmonized lists parse each foreign id (or keep the raw form).
  const joint = impl.parse("GOST 35260-2025 (ISO/IEC 17360:2023)").toHash();
  assert.equal(
    (joint["adopted_identifiers"] as Record<string, unknown>[])[0]!["_type"],
    "pubid:iso:international-standard",
  );
  const foreign = impl.parse("GOST 32786-2014 (UNECE STANDARD FFV-19:2010)").toHash();
  assert.equal(
    (foreign["adopted_identifiers"] as Record<string, unknown>[])[0]!["_type"],
    "pubid:gost:foreign-reference",
  );
  // Multi-adoption harmonization splits on commas.
  assert.equal(
    impl.parse("GOST 6032-2017 (ИСО 3651-1:1998, ИСО 3651-2:1998)").toHuman(),
    "GOST 6032-2017 (ISO 3651-1:1998, ISO 3651-2:1998)",
  );
  // URNs: std for interstate, std:r for national, adoption wrappers
  // delegate to the base.
  assert.equal(impl.parse("GOST 12.1.004").toUrn(), "urn:gost:std:12.1.004");
  assert.equal(impl.parse("ГОСТ Р 34.10-2001").toUrn(), "urn:gost:std:r:34.10:2001");
  assert.equal(impl.parse("GOST R 57415-2017/EN 1548:2007").toUrn(), "urn:gost:std:r:57415:2017");
  assert.equal(impl.parse("GOST 35260-2025 (ISO/IEC 17360:2023)").toUrn(), "urn:gost:std:35260:2025");
});

test("gost rejects non-identifiers", () => {
  const impl = grammarImplementation("gost")!;
  assert.throws(() => impl.parse("GOST"));
  assert.throws(() => impl.parse("ISO 1234"));
  assert.throws(() => impl.parse("GOST R"));
  assert.throws(() => impl.parse("ГОСТ Р"));
  assert.throws(() => impl.parse("GOST ABC"));
});
