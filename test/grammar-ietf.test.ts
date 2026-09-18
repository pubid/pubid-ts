import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// ietf — 2,526 corpus rows: RFC, BCP/STD/FYI sub-series, Internet-Drafts.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every ietf corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("ietf")!;
  const impl = grammarImplementation("ietf")!;
  assert.ok(impl, "ietf is grammar-backed");
  const report = runFlavor("ietf", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 2500);
});

test("ietf parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("ietf")!;
  // The padded, space-less rfc-index.xml spellings unpad on build.
  assert.equal(impl.parse("RFC0001").toHuman(), "RFC 1");
  assert.equal(impl.parse("STD0066").toUrn(), "urn:ietf:std:66");
  // An all-zero number keeps its last digit.
  assert.equal(impl.parse("RFC 000").toHuman(), "RFC 0");
  // Historical slug shapes: dotted topics, uppercase, empty segment.
  assert.deepEqual(impl.parse("draft-ietf-pilc-2.5g3g-12").toHash(), {
    _type: "pubid:ietf:internet-draft",
    number: "draft-ietf-pilc-2.5g3g",
    version: "12",
  });
  assert.deepEqual(impl.parse("draft-chapin-clnp-ISO8473-00").toHash(), {
    _type: "pubid:ietf:internet-draft",
    number: "draft-chapin-clnp-ISO8473",
    version: "00",
  });
  // A three-digit tail is a topic, not a version.
  assert.deepEqual(impl.parse("draft-ietf-some-256").toHash(), {
    _type: "pubid:ietf:internet-draft",
    number: "draft-ietf-some-256",
  });
  // The unversioned "latest" sibling drops the version key entirely.
  assert.deepEqual(impl.parse("draft-giuliano-treedn").toHash(), {
    _type: "pubid:ietf:internet-draft",
    number: "draft-giuliano-treedn",
  });
});

test("ietf rejects non-identifiers", () => {
  const impl = grammarImplementation("ietf")!;
  assert.throws(() => impl.parse("RFC"));
  assert.throws(() => impl.parse("draft-"));
  assert.throws(() => impl.parse("rfc 2119"));
  assert.throws(() => impl.parse("RFC 21x19"));
  assert.throws(() => impl.parse("XEP 1"));
});
