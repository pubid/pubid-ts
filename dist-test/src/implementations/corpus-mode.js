import { canonicalKey } from "../internal/compare.js";
/**
 * The lookup tiers. Whitespace runs collapse in the EXACT tier already —
 * no identifier semantics live in whitespace. Case is different: some
 * corpora carry identifiers whose subfields are case-significant (IECEx
 * "60079-0v7B_DS" vs "60079-0v7b_DS" are distinct documents), so casefold
 * is a FALLBACK tier, consulted only when no exact row matches. The
 * fallback is first-wins in corpus order: deterministic, and it never
 * overrides an exact hit. Spaces adjacent to a COLON collapse in the
 * fallback tier too ("R 117-1 : 2019" -> "R 117-1:2019") — the colon is
 * always a date separator in these identifiers, so the squeeze cannot
 * merge two distinct rows, while "…: 2004" spellings are established
 * real-world variance (the testsuite's own _normalization.yaml carries
 * them). Only the colon: spaces around dashes or dots DO distinguish
 * rows in some corpora, and are left alone.
 */
function collapseWs(spelling) {
    return spelling.trim().replace(/\s+/g, " ");
}
function foldKey(spelling) {
    return collapseWs(spelling).replace(/\s*:\s*/g, ":").toLowerCase();
}
/**
 * Some URN schemes are edition-less (ISO: "ISO/IEC 17025:1999", ":2005"
 * and ":2017" all serialize to urn:iso:std:iso-iec:17025), so a URN can
 * key several corpus rows — 40% of iso's. Resolve such a URN to the
 * LATEST edition (the greatest `year` in the row's hash; rows without a
 * year rank lowest), which keeps parse(toUrn()) deterministic AND
 * sensible, and expose the whole candidate set through
 * parseUrnCandidates for consumers that need it.
 */
function latestEditionRow(rows) {
    return [...rows].sort((a, b) => rowYear(a) - rowYear(b)).at(-1);
}
function rowYear(row) {
    const year = row.hash["year"];
    const parsed = typeof year === "string" || typeof year === "number"
        ? Number(year)
        : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
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
    // A URN keys EVERY row it was serialized from — ISO-style URN schemes
    // are edition-less, so one URN can carry up to five editions. Singular
    // storage silently resolved the ambiguity (a different edition than the
    // one serialized, with no signal) — pubid-ts issue #4.
    const byUrn = new Map();
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
        if (row.urn !== undefined) {
            const key = foldKey(row.urn);
            const bucket = byUrn.get(key);
            if (bucket)
                bucket.push(row);
            else
                byUrn.set(key, [row]);
        }
        for (const alias of testCase.nonNormalizedAliases ?? []) {
            indexSpelling(alias.spelling, row, true);
        }
    }
    const urnRows = (input) => /^urn:/i.test(input.trim()) ? byUrn.get(foldKey(input)) : undefined;
    const urnCandidates = (input) => urnRows(input) ?? [];
    const parseInput = (input) => {
        const rows = urnRows(input);
        if (rows)
            return latestEditionRow(rows);
        return bySpelling.get(collapseWs(input)) ??
            byFoldedSpelling.get(foldKey(input));
    };
    const implementation = {
        parse(input) {
            const row = parseInput(input);
            if (row === undefined) {
                throw new Error(`no such identifier in the published corpus: ${input}`);
            }
            return new CorpusBackedIdentifier(row, resolveHash);
        },
    };
    return Object.assign(implementation, {
        parseUrnCandidates: (input) => urnCandidates(input).map((row) => new CorpusBackedIdentifier(row, resolveHash)),
    });
}
