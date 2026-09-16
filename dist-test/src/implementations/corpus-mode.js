import { canonicalKey } from "../internal/compare.js";
/**
 * The lookup tiers. Whitespace runs collapse in the EXACT tier already —
 * no identifier semantics live in whitespace. Case is different: some
 * corpora carry identifiers whose subfields are case-significant (IECEx
 * "60079-0v7B_DS" vs "60079-0v7b_DS" are distinct documents), so casefold
 * is a FALLBACK tier, consulted only when no exact row matches. The
 * fallback is first-wins in corpus order: deterministic, and it never
 * overrides an exact hit.
 */
function collapseWs(spelling) {
    return spelling.trim().replace(/\s+/g, " ");
}
function foldKey(spelling) {
    return collapseWs(spelling).toLowerCase();
}
/**
 * Corpus-backed identifier resolution over the pubid-testsuite corpus:
 * every canonical spelling, its URN, its aliases and its canonical
 * serialized form. Corpus mode resolves any identifier IN that universe
 * and nothing outside it — it is a conformance surface and a fixture for
 * the grammar waves (which take over a flavor open-endedly as they land),
 * NOT an open-universe runtime parser: a real-world identifier missing
 * from the corpus is rejected by design.
 */
export class CorpusBackedIdentifier {
    row;
    resolveHash;
    constructor(row, resolveHash) {
        this.row = row;
        this.resolveHash = resolveHash;
    }
    toHash() {
        return structuredClone(this.row.hash);
    }
    toHuman() {
        return this.row.human;
    }
    toUrn() {
        return this.row.urn;
    }
    fromHash(hash) {
        return new CorpusBackedIdentifier(this.resolveHash(hash), this.resolveHash);
    }
}
/**
 * Build a corpus-mode implementation for one flavor from its payload
 * cases. Indexes are per-implementation: a module-global hash index
 * accumulated rows from every flavor, so an identifier from one flavor
 * could deserialize another flavor's row — exactly the multi-SDO consumer
 * this library exists for. Humans, URNs and non-normalized aliases all
 * resolve (case- and whitespace-insensitively) to the same row; unknown
 * spellings are rejected (parse throws).
 */
export function corpusModeImplementation(cases) {
    const bySpelling = new Map();
    const byFoldedSpelling = new Map();
    const hashIndex = new Map();
    const resolveHash = (hash) => {
        const found = hashIndex.get(canonicalKey(hash));
        if (found === undefined) {
            throw new Error("unknown canonical hash for corpus-mode deserialization");
        }
        return found;
    };
    const indexSpelling = (spelling, row, keepFirst) => {
        const exact = collapseWs(spelling);
        if (!keepFirst || !bySpelling.has(exact))
            bySpelling.set(exact, row);
        const folded = foldKey(spelling);
        if (!byFoldedSpelling.has(folded))
            byFoldedSpelling.set(folded, row);
    };
    for (const testCase of cases) {
        if (testCase.identifier === undefined)
            continue; // quarantined row
        const row = {
            hash: testCase.identifier,
            human: testCase.representations.human,
            urn: testCase.representations.urn,
        };
        hashIndex.set(canonicalKey(row.hash), row);
        indexSpelling(row.human, row, false);
        if (row.urn !== undefined)
            indexSpelling(row.urn, row, true);
        for (const alias of testCase.nonNormalizedAliases ?? []) {
            indexSpelling(alias.spelling, row, true);
        }
    }
    return {
        parse(input) {
            const row = bySpelling.get(collapseWs(input)) ??
                byFoldedSpelling.get(foldKey(input));
            if (row === undefined) {
                throw new Error(`no such identifier in the published corpus: ${input}`);
            }
            return new CorpusBackedIdentifier(row, resolveHash);
        },
    };
}
