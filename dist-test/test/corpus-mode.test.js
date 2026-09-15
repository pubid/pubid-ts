import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { corpusModeImplementation } from "../src/implementations/corpus-mode.js";
const TESTSUITE_DIR = process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";
test("corpus mode resolves and normalizes published identifiers", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const payloads = corpus.flavors.get("oiml");
    const row = payloads.cases.find((c) => c.identifier !== undefined && c.representations.urn !== undefined);
    const oiml = corpusModeImplementation(payloads.cases);
    const id = oiml.parse(row.representations.human);
    assert.equal(id.toHuman(), row.representations.human);
    assert.equal(id.toUrn(), row.representations.urn);
    assert.equal(id.toHash()["_type"], row.identifier?.["_type"]);
});
test("non-normalized aliases resolve to the canonical row", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    // iso carries the Cyrillic spellings as aliases; they must normalize.
    const iso = corpusModeImplementation(corpus.flavors.get("iso").cases);
    const rows = corpus.flavors.get("iso").cases
        .filter((c) => (c.nonNormalizedAliases?.length ?? 0) > 0);
    const withAlias = rows[0];
    const alias = withAlias.nonNormalizedAliases[0].spelling;
    assert.equal(iso.parse(alias).toHuman(), withAlias.representations.human);
});
test("unpublished spellings are rejected (negatives gate)", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const amca = corpusModeImplementation(corpus.flavors.get("amca").cases);
    assert.throws(() => amca.parse("definitely not a published identifier"));
});
test("deserialize is idempotent through the hash index", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const ieee = corpusModeImplementation(corpus.flavors.get("ieee").cases);
    const row = corpus.flavors.get("ieee").cases
        .find((c) => c.identifier !== undefined);
    const id = ieee.parse(row.representations.human);
    const hash = id.toHash();
    assert.deepEqual(id.fromHash(hash).toHash(), hash);
});
