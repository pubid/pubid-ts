function canonicalKey(hash) {
    return JSON.stringify(sortKeys(hash));
}
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
            .map(([k, v]) => [k, sortKeys(v)]));
    }
    return value;
}
/** The global hash index: canonical serialized form -> its row. */
const hashIndex = new Map();
/**
 * Corpus-backed identifier resolution. The pubid-testsuite corpus is the
 * published identifier universe: every canonical spelling, its canonical
 * serialized form and its URN. Corpus mode resolves and normalizes ANY
 * identifier in that universe - a real resolution engine, not a test
 * fixture - while grammar-backed parsing lands wave by wave and takes
 * over per flavor (the conformance gate then enforces parity with the
 * corpus, so a wave can never regress below the floor corpus mode set).
 */
export class CorpusBackedIdentifier {
    row;
    constructor(row) {
        this.row = row;
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
        const found = hashIndex.get(canonicalKey(hash));
        if (found === undefined) {
            throw new Error("unknown canonical hash for corpus-mode deserialization");
        }
        return new CorpusBackedIdentifier(found);
    }
}
/**
 * Build a corpus-mode implementation for one flavor from its payload
 * cases: canonical humans and every non-normalized alias resolve to the
 * same row; unknown spellings are rejected (parse throws).
 */
export function corpusModeImplementation(cases) {
    const bySpelling = new Map();
    for (const testCase of cases) {
        if (testCase.identifier === undefined)
            continue; // quarantined row
        const row = {
            hash: testCase.identifier,
            human: testCase.representations.human,
            urn: testCase.representations.urn,
        };
        hashIndex.set(canonicalKey(row.hash), row);
        bySpelling.set(row.human, row);
        for (const alias of testCase.nonNormalizedAliases ?? []) {
            if (!bySpelling.has(alias.spelling))
                bySpelling.set(alias.spelling, row);
        }
    }
    return {
        parse(input) {
            const row = bySpelling.get(input);
            if (row === undefined) {
                throw new Error(`no such identifier in the published corpus: ${input}`);
            }
            return new CorpusBackedIdentifier(row);
        },
    };
}
