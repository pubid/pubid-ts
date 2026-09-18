import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// cie — 365 corpus rows across 10 types on the unified model, including
// the dual-era date styles (current ":" / legacy "-" / slash "/").

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every cie corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("cie")!;
  const impl = grammarImplementation("cie")!;
  assert.ok(impl, "cie is grammar-backed");
  const report = runFlavor("cie", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 350);
});

test("cie parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("cie")!;
  // The data-quality fixes: missing colon inserted, comments stripped,
  // whitespace collapsed.
  assert.equal(impl.parse("CIE S 014-4/E2007").toHuman(), "CIE S 014-4/E:2007");
  assert.equal(impl.parse("CIE 155:2003 # withdrawn").toHuman(), "CIE 155:2003");
  assert.equal(impl.parse("CIE  S   017:2011").toHuman(), "CIE S 017:2011");
  // A bare partial reference parses with the year left nil.
  assert.deepEqual(impl.parse("CIE 015").toHash(), {
    _type: "pubid:cie:standard",
    number: "015",
  });
  // A draft stage reaches the hash and the URN.
  assert.equal(impl.parse("CIE DS 017").toUrn(), "urn:cie:cie:017:ds");
  // The ISO/CIE joint form (the plain-ISO rule's absent-guard target).
  assert.deepEqual(impl.parse("CIE ISO/CIE TR 21752:2019").toHash(), {
    _type: "pubid:cie:joint-published",
    number: "21752",
    year: "2019",
    copublisher: "ISO/CIE",
    doc_type: "TR",
  });
  // A corrigendum of a supplement nests base inside base.
  assert.deepEqual(impl.parse("CIE 198-SP1.4:2011/Cor1:2013").toHash(), {
    _type: "pubid:cie:corrigendum",
    number: "1",
    year: "2013",
    base: {
      _type: "pubid:cie:supplement",
      number: "1",
      part: "4",
      base: { _type: "pubid:cie:standard", number: "198", year: "2011" },
    },
  });
});

test("cie rejects non-identifiers", () => {
  const impl = grammarImplementation("cie")!;
  assert.throws(() => impl.parse("CIE"));
  assert.throws(() => impl.parse("CIE 015:20"));
  assert.throws(() => impl.parse("CIE x"));
  assert.throws(() => impl.parse("IEC 62471:2006"));
  // A 4-digit "part" is a year, not a part — unparseable as printed.
  assert.throws(() => impl.parse("CIE 015-2018:2006"));
});
