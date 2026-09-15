import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runCorpus } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
const TESTSUITE_DIR = process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";
test("the corpus loads every flavor with a status ledger", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    assert.ok(corpus.flavors.size >= 41, `expected >= 41 flavors, got ${corpus.flavors.size}`);
    for (const [flavor, payloads] of corpus.flavors) {
        assert.equal(typeof payloads.status.clean, "boolean", `${flavor} status.clean`);
    }
});
test("case counts match the published totals", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const totalCases = [...corpus.flavors.values()]
        .map((p) => p.cases.length)
        .reduce((a, b) => a + b, 0);
    // README marker: <!-- counts:cases=N -->. Bootstrap pins the current
    // published count; the CI pin bump keeps this honest.
    assert.ok(totalCases > 90_000, `expected >90k cases, got ${totalCases}`);
});
test("the runner reports unimplemented flavors and never gates them", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const report = runCorpus(corpus, new Map(), new PendingRegistry());
    const unimplemented = report.flavors.filter((f) => f.outcome === "unimplemented");
    assert.equal(unimplemented.length, corpus.flavors.size);
    assert.equal(report.gate, "pass");
});
test("an absent corpus is refused, never a vacuous pass", () => {
    assert.throws(() => loadCorpus("/nonexistent/corpus"));
});
