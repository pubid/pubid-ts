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
test("URNs resolve, so parse(toUrn()) round-trips (issue #1 finding 2)", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const oiml = corpusModeImplementation(corpus.flavors.get("oiml").cases);
    // Some corpus rows legitimately share a URN with a sibling (the
    // amendment family); pick a row whose URN uniquely keys it.
    const rows = corpus.flavors.get("oiml").cases
        .filter((c) => c.identifier !== undefined && c.representations.urn !== undefined);
    const urnCounts = new Map();
    for (const c of rows) {
        const urn = c.representations.urn;
        urnCounts.set(urn, (urnCounts.get(urn) ?? 0) + 1);
    }
    const row = rows.find((c) => urnCounts.get(c.representations.urn) === 1);
    const byHuman = oiml.parse(row.representations.human);
    const byUrn = oiml.parse(row.representations.urn);
    assert.equal(byUrn.toHuman(), byHuman.toHuman());
    assert.deepEqual(byUrn.toHash(), byHuman.toHash());
});
test("the hash index is per-implementation, not cross-flavor (issue #1 finding 3)", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const iso = corpusModeImplementation(corpus.flavors.get("iso").cases);
    const oiml = corpusModeImplementation(corpus.flavors.get("oiml").cases);
    const isoHash = iso.parse("ISO/IEC 17025:2017").toHash();
    const oimlId = oiml.parse("OIML R 117-1:2019");
    // An OIML identifier must not resolve an ISO row — and the reverse.
    assert.throws(() => oimlId.fromHash(isoHash));
    const oimlHash = oimlId.toHash();
    assert.throws(() => iso.parse("ISO/IEC 17025:2017").fromHash(oimlHash));
});
test("case and whitespace variants resolve (issue #1 finding 6)", () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const oiml = corpusModeImplementation(corpus.flavors.get("oiml").cases);
    const canonical = oiml.parse("OIML R 117-1:2019").toHuman();
    for (const variant of [
        "oiml r 117-1:2019",
        "OIML R  117-1:2019",
        " oiml  R 117-1:2019 ",
    ]) {
        assert.equal(oiml.parse(variant).toHuman(), canonical);
    }
});
test("case-significant subfields keep their exact rows", () => {
    // IECEx TRF suffixes are case-significant ("60079-0v7B_DS"); the folded
    // fallback must never override an exact hit for such corpora.
    const corpus = loadCorpus(TESTSUITE_DIR);
    const iec = corpusModeImplementation(corpus.flavors.get("iec").cases);
    const row = corpus.flavors.get("iec").cases
        .find((c) => c.representations.human === "IECEx TRF 60079-0v7B_DS:2018");
    assert.ok(row, "corpus carries the case-significant row");
    assert.deepEqual(iec.parse("IECEx TRF 60079-0v7B_DS:2018").toHash(), row.identifier);
});
