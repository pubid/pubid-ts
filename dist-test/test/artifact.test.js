import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBundledCorpus } from "../src/corpus/artifact.js";
import { corpusModeImplementation } from "../src/implementations/corpus-mode.js";
// pubid-ts#1 finding 5: the prebuilt corpus artifact ships inside the
// package, so consumers need neither a pubid-testsuite checkout nor the
// yaml dependency at runtime - no filesystem path, no yaml parse.
test("the bundled corpus loads without a testsuite checkout", () => {
    const corpus = loadBundledCorpus();
    assert.ok(corpus.flavors.size >= 42, `expected 42+ flavors, got ${corpus.flavors.size}`);
    const cases = [...corpus.flavors.values()]
        .reduce((sum, p) => sum + p.cases.length, 0);
    assert.ok(cases > 90_000, `expected 90k+ cases, got ${cases}`);
});
test("corpus mode resolves identifiers from the bundled corpus", () => {
    const corpus = loadBundledCorpus();
    const oiml = corpusModeImplementation(corpus.flavors.get("oiml").cases);
    const id = oiml.parse("OIML R 117-1:2019");
    assert.equal(id.toUrn(), "urn:oiml:r:117-1:2019");
    // The tolerant tiers work identically over the artifact.
    assert.equal(oiml.parse("oiml r 117-1 : 2019").toHuman(), "OIML R 117-1:2019");
});
test("the bundled corpus carries the ledger statuses", () => {
    const corpus = loadBundledCorpus();
    assert.equal(corpus.flavors.get("oiml").status.clean, true);
});
