import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// bsi — 939 corpus rows, a LEDGER flavor (22 known mismatches in
// _status.yaml; the testsuite verify loop reports 108 failing case
// ids). Those are pended one-for-one; everything else must pass.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every bsi corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("bsi")!;
  const impl = grammarImplementation("bsi")!;
  assert.ok(impl, "bsi is grammar-backed");
  const pending = PendingRegistry.load("conformance/pending.yaml");
  const report = runFlavor("bsi", payloads, impl, pending);
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "ledger");
  assert.equal(
    report.cases + report.pending,
    payloads.cases.length - report.errors,
  );
  // The ledger's gem-known mismatches (generated from the testsuite
  // verify loop over the gem, /tmp/verify-bsi.rb).
  assert.equal(report.pending, 108);
  assert.equal(report.pendingSatisfied.length, 0, report.pendingSatisfied.join("; "));
});

test("bsi parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("bsi")!;
  assert.equal(impl.parse("BS 4592-0:2006+A1:2012").toHuman(), "BS 4592-0:2006+A1:2012");
  assert.equal(impl.parse("BS 1000[9]:Supplement No. 1:1972").toHuman(), "BS 1000[9]:Supplement No. 1:1972");
  // Aerospace prefixes with glued letter editions.
  assert.equal(impl.parse("BS AU 145e:2018").toUrn(), "urn:bsi:bs:au:145:2018:ve");
  assert.equal(impl.parse("BS 2G 124-1:1966").toUrn(), "urn:bsi:bs:2g:124:-1:1966");
  // Flex editions carry the month.
  assert.equal(impl.parse("BSI Flex 1886 v2.0:2024-09").toHuman(), "BSI Flex 1886 v2.0:2024-09");
  // Bundled lists abbreviate after the first item unless the item
  // repeats its publisher/prefix explicitly.
  assert.equal(impl.parse("BS 2521 and 2523:1966").toHuman(), "BS 2521 and 2523:1966");
  // Adopted norms nest the foreign identifier.
  const adopted = impl.parse("BS EN ISO 8601:2019");
  assert.equal(adopted.toHuman(), "BS EN ISO 8601:2019");
  const adoptedWire = adopted.toHash()["base"] as Record<string, unknown>;
  assert.equal(adoptedWire["_type"], "pubid:cencenelec:adopted-european-norm");
  // Expert commentary wraps with its printed form.
  assert.equal(
    impl.parse("BS EN 1548:2007 Expert Commentary").toHuman(),
    "BS EN 1548:2007 Expert Commentary",
  );
  // Section/method/test-method suffixes round-trip.
  assert.equal(impl.parse("DD 51:Section 0:1977").toHuman(), "DD 51:Section 0:1977");
  assert.equal(impl.parse("BS 2782-1:Method 131B:1983").toHuman(), "BS 2782-1:Method 131B:1983");
  assert.equal(impl.parse("BS 1006:B01C:LFS1:1982").toHuman(), "BS 1006:B01C:LFS1:1982");
});

test("bsi rejects non-identifiers", () => {
  const impl = grammarImplementation("bsi")!;
  assert.throws(() => impl.parse("AMD"));
  // The adopted routing raises through when the foreign parse fails
  // (mirrors the gem).
  assert.throws(() => impl.parse("BS HD 629.1 S3:2019"));
  assert.throws(() => impl.parse("BS EN 2591-B2:1994"));
});
