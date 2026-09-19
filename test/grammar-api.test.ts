import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// api — 193 corpus rows. The _status.yaml still says clean:false (162
// recorded known mismatches) so the runner reports "ledger", but the
// testsuite verify loop over the CURRENT gem reports zero failing
// ids — every case passes with no pends.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every api corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("api")!;
  const impl = grammarImplementation("api")!;
  assert.ok(impl, "api is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("api", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.cases, payloads.cases.length - report.errors);
  assert.equal(report.pending, 0);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("api parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("api")!;
  assert.equal(impl.parse("API STD 650").toHuman(), "API STD 650");
  assert.equal(impl.parse("API STD 650").toUrn(), "urn:api:std:650");
  // The eight typed leaves dispatch through the type token.
  assert.equal(
    impl.parse("API RP 100-3").toHash()["_type"],
    "pubid:api:recommended-practice",
  );
  assert.equal(impl.parse("API RP 100-3").toUrn(), "urn:api:std:100:-3");
  assert.equal(impl.parse("API COS 1-08").toHuman(), "API COS 1-08");
  // MPMS chapters, sections, and subsections.
  assert.equal(impl.parse("API MPMS CH 10.10").toHuman(), "API MPMS CH 10.10");
  const mpms = impl.parse("API MPMS CH 14.6.4A");
  assert.equal(mpms.toHash()["section"], "6");
  assert.equal(mpms.toHash()["subsection"], "4A");
  assert.equal(impl.parse("API MPMS CH 10.10").toUrn(), "urn:api:std:10");
  // The MPMP typo normalizes to MPMS.
  assert.equal(impl.parse("API MPMP CH 10.10").toHash()["_type"], "pubid:api:mpms");
  // Typeless identifiers carry no type token.
  assert.equal(impl.parse("API 5L-2018").toHuman(), "API 5L-2018");
  // ", Part N" parses but the gem's builder drops it — matched 1:1.
  assert.equal(impl.parse("API RP 554, Part 2").toHuman(), "API RP 554");
});

test("api rejects non-identifiers", () => {
  const impl = grammarImplementation("api")!;
  assert.throws(() => impl.parse("API"));
  assert.throws(() => impl.parse("ISO 1234:2015"));
  // Mixed-case type tokens do not parse (the gem matches uppercase only).
  assert.throws(() => impl.parse("API Std 650"));
});
