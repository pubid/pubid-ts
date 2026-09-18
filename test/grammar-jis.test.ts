import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// jis — 10,555 corpus rows, the second-largest flavor, on the unified model.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every jis corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("jis")!;
  const impl = grammarImplementation("jis")!;
  assert.ok(impl, "jis is grammar-backed");
  const report = runFlavor("jis", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 10000);
});

test("jis parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("jis")!;
  // Prefix-less and slash-separated spellings.
  assert.equal(impl.parse("Z 8301:2019").toHuman(), "JIS Z 8301:2019");
  assert.equal(impl.parse("JIS/Z 8301:2019").toHuman(), "JIS Z 8301:2019");
  // Full-width separators normalize to ASCII.
  assert.equal(impl.parse("JIS B 0600ｰ1：2001").toHuman(), "JIS B 0600-1:2001");
  // Bare SYMBOL keyword round-trips.
  assert.equal(impl.parse("JIS Z 8210 SYMBOL").toHuman(), "JIS Z 8210 SYMBOL");
  // Multi-level parts.
  assert.deepEqual(impl.parse("JIS B 0600-3-2-1:2001").toHash(), {
    _type: "pubid:jis:japanese-industrial-standard",
    series: "B",
    number: "0600",
    parts: ["3", "2", "1"],
    year: 2001,
  });
});

test("jis rejects non-identifiers", () => {
  const impl = grammarImplementation("jis")!;
  assert.throws(() => impl.parse("JIS"));
  assert.throws(() => impl.parse("JIS A"));
  assert.throws(() => impl.parse("JIS a 123:1999"));
});
