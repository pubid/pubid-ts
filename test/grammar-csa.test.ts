import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// csa — 830 corpus rows, clean: the reaffirmation spacing follows the
// PRINTED year and the bare "CSA IWA …" / "CAN/CSA-IWA …" adoption
// spellings resolve to the same ISO IWA base. The unparsed
// ground-truth fixture debt rows are reference defects tracked in
// tests/csa/_debt.yaml, not pends.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every csa corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("csa")!;
  const impl = grammarImplementation("csa")!;
  assert.ok(impl, "csa is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("csa", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length - report.errors);
  assert.equal(report.pending, 0);
  // A pending case that passes must be unmarked.
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("csa parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("csa")!;
  assert.equal(impl.parse("CSA B149.1:20").toHuman(), "CSA B149.1:20");
  assert.equal(impl.parse("CSA B149.1:20").toUrn(), "urn:csa:csa:B149.1:20");
  // The CAN/ and CAN3- wrappers preserve their printed prefixes.
  assert.equal(impl.parse("CAN/CSA-C22.2 NO. 60601-1-9:15").toHuman(), "CAN/CSA-C22.2 NO. 60601-1-9:15");
  // The single-document CEC URN carries the derived number and NO. slot.
  assert.equal(impl.parse("CSA C22.2 NO. 0:20").toUrn(), "urn:csa:csa:C22.2-0:no.0:20");
  // 2-digit years expand for storage and render back shortened.
  assert.equal(impl.parse("CAN/CSA-Z245.20:18").toHuman(), "CAN/CSA-Z245.20:18");
  // CSA adoptions of international standards nest the foreign id.
  const adopted = impl.parse("CSA ISO/IEC TR 12785-3:15");
  assert.equal(adopted.toHuman(), "CSA ISO/IEC TR 12785-3:15");
  const adoptedWire = adopted.toHash()["base"] as Record<string, unknown>;
  assert.equal(adoptedWire["_type"], "pubid:iso:technical-report");
  // Bundled (+) and combined (/) documents.
  assert.equal(
    impl.parse("CAN/CSA C22.2 NO. 60601-1-6:11 + A1:15 + A2:21 (R2021)").toHuman(),
    "CAN/CSA-C22.2-60601-1-6:11 + A1:15 + A2:21 (R2021)",
  );
  // Series and reaffirmations round-trip with their printed widths.
  assert.equal(impl.parse("CAN/CSA-Z240 MH SERIES:16").toHuman(), "CAN/CSA-Z240 MH SERIES:16");
  assert.equal(impl.parse("CAN/CSA-A123.2-03 (R2023)").toHuman(), "CAN/CSA-A123.2-03 (R2023)");
  // A CEC year prints 2-digit, so its reaffirmation takes the space
  // even when the input spelled the year 4-digit; a base identifier
  // printing a 4-digit year keeps it glued.
  assert.equal(
    impl.parse("CSA C22.2 NO. 125-M1984 (R2004)").toHuman(),
    "CSA C22.2 NO. 125-M84 (R2004)",
  );
  assert.equal(impl.parse("CSA C108.1.2-M1981(R2013)").toHuman(), "CSA C108.1.2-M1981(R2013)");
  // The bare IWA adoption spelling resolves to the same ISO IWA base.
  const iwa = impl.parse("CAN/CSA-IWA 18:17 (R2022)");
  assert.equal(iwa.toHuman(), "CAN/CSA-IWA 18:17 (R2022)");
  const iwaWire = iwa.toHash()["base"] as Record<string, unknown>;
  const iwaBase = iwaWire["base"] as Record<string, unknown>;
  assert.equal(iwaBase["_type"], "pubid:iso:international-workshop-agreement");
  // Packages carry their materials.
  assert.equal(
    impl.parse("CSA Z662:23 PACKAGE INCLUDES: +1 (PDF & ESA)").toHuman(),
    "CSA Z662:23 PACKAGE INCLUDES: +1 (PDF & ESA)",
  );
});

test("csa rejects non-identifiers", () => {
  const impl = grammarImplementation("csa")!;
  assert.throws(() => impl.parse("CSA"));
  assert.throws(() => impl.parse("ISO 1234:2015"));
  assert.throws(() => impl.parse("CSA Communities"));
  assert.throws(() => impl.parse("# comment"));
});
