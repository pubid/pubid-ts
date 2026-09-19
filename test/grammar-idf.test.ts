import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// idf — 65 corpus rows, a CLEAN flavor (0 known mismatches): every case
// must pass with no pends.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every idf corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("idf")!;
  const impl = grammarImplementation("idf")!;
  assert.ok(impl, "idf is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("idf", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length - report.errors);
  assert.equal(report.pending, 0);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("idf parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("idf")!;
  // Plain standards with parts and dates.
  assert.equal(impl.parse("IDF 117:2016").toHuman(), "IDF 117:2016");
  assert.equal(impl.parse("IDF 124-2:2005").toHuman(), "IDF 124-2:2005");
  // Staged standards and reviewed methods.
  assert.equal(impl.parse("IDF/CD 190:2023").toHuman(), "IDF/CD 190:2023");
  assert.equal(impl.parse("IDF/RM 233-1:2017").toHuman(), "IDF/RM 233-1:2017");
  assert.equal(impl.parse("IDF/DRM 155:2023").toHuman(), "IDF/DRM 155:2023");
  // Languages map single letters (E, F) to codes.
  assert.equal(impl.parse("IDF 60E:2010(E)").toHuman(), "IDF 60E:2010(en)");
  // Supplements carry their base.
  assert.equal(impl.parse("IDF 140-1:2007/AMD 1:2012").toHuman(), "IDF 140-1:2007/AMD 1:2012");
  assert.equal(impl.parse("IDF 148-1:2008/COR 1:2009").toHuman(), "IDF 148-1:2008/COR 1:2009");
  // The URN keeps part dashes and the typed-stage tail (an empty type
  // segment for a published IS).
  assert.equal(impl.parse("IDF 117:2016").toUrn(), "urn:idf:117:2016:");
  assert.equal(impl.parse("IDF 124-2:2005").toUrn(), "urn:idf:124:-2:2005:");
  assert.equal(impl.parse("IDF/RM 233-1:2017").toUrn(), "urn:idf:233:-1:2017:rm");
  assert.equal(
    impl.parse("IDF 140-1:2007/AMD 1:2012").toUrn(),
    "urn:idf:1:2012:amd:amd:1",
  );
});

test("idf rejects non-identifiers", () => {
  const impl = grammarImplementation("idf")!;
  assert.throws(() => impl.parse("IDF"));
  assert.throws(() => impl.parse("ISO 1234"));
  assert.throws(() => impl.parse("IDF/XXX 1"));
});
