import type { CorpusCase } from "../corpus/types.js";
import type { FlavorImplementation, Identifier } from "../conformance/implementation.js";
import { canonicalKey } from "../internal/compare.js";

interface CorpusRow {
  hash: Record<string, unknown>;
  human: string;
  urn?: string | undefined;
}

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
function collapseWs(spelling: string): string {
  return spelling.trim().replace(/\s+/g, " ");
}

function foldKey(spelling: string): string {
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
function latestEditionRow(rows: CorpusRow[]): CorpusRow {
  return [...rows].sort((a, b) => rowYear(a) - rowYear(b)).at(-1)!;
}

function rowYear(row: CorpusRow): number {
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
export class CorpusBackedIdentifier implements Identifier {
  constructor(
    private readonly row: CorpusRow,
    private readonly resolveHash: (hash: Record<string, unknown>) => CorpusRow,
  ) {}

  toHash(): Record<string, unknown> {
    return structuredClone(this.row.hash);
  }

  toHuman(): string {
    return this.row.human;
  }

  toUrn(): string | undefined {
    return this.row.urn;
  }

  fromHash(hash: Record<string, unknown>): Identifier {
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
export function corpusModeImplementation(
  cases: CorpusCase[],
): FlavorImplementation & { parseUrnCandidates(input: string): Identifier[] } {
  const bySpelling = new Map<string, CorpusRow>();
  const byFoldedSpelling = new Map<string, CorpusRow>();
  // A URN keys EVERY row it was serialized from — ISO-style URN schemes
  // are edition-less, so one URN can carry up to five editions. Singular
  // storage silently resolved the ambiguity (a different edition than the
  // one serialized, with no signal) — pubid-ts issue #4.
  const byUrn = new Map<string, CorpusRow[]>();
  const hashIndex = new Map<string, CorpusRow>();

  const resolveHash = (hash: Record<string, unknown>): CorpusRow => {
    const found = hashIndex.get(canonicalKey(hash));
    if (found === undefined) {
      throw new Error("unknown canonical hash for corpus-mode deserialization");
    }
    return found;
  };

  const indexSpelling = (spelling: string, row: CorpusRow, keepFirst: boolean) => {
    const exact = collapseWs(spelling);
    if (!keepFirst || !bySpelling.has(exact)) bySpelling.set(exact, row);
    const folded = foldKey(spelling);
    if (!byFoldedSpelling.has(folded)) byFoldedSpelling.set(folded, row);
  };

  for (const testCase of cases) {
    if (testCase.identifier === undefined) continue; // quarantined row
    const row: CorpusRow = {
      hash: testCase.identifier,
      human: testCase.representations.human,
      urn: testCase.representations.urn,
    };
    hashIndex.set(canonicalKey(row.hash), row);
    indexSpelling(row.human, row, false);
    if (row.urn !== undefined) {
      const key = foldKey(row.urn);
      const bucket = byUrn.get(key);
      if (bucket) bucket.push(row);
      else byUrn.set(key, [row]);
    }
    for (const alias of testCase.nonNormalizedAliases ?? []) {
      indexSpelling(alias.spelling, row, true);
    }
  }

  const urnRows = (input: string): CorpusRow[] | undefined =>
    /^urn:/i.test(input.trim()) ? byUrn.get(foldKey(input)) : undefined;

  const urnCandidates = (input: string): CorpusRow[] =>
    urnRows(input) ?? [];

  const parseInput = (input: string): CorpusRow | undefined => {
    const rows = urnRows(input);
    if (rows) return latestEditionRow(rows);
    return bySpelling.get(collapseWs(input)) ??
      byFoldedSpelling.get(foldKey(input));
  };

  const implementation: FlavorImplementation = {
    parse(input: string): Identifier {
      const row = parseInput(input);
      if (row === undefined) {
        throw new Error(`no such identifier in the published corpus: ${input}`);
      }
      return new CorpusBackedIdentifier(row, resolveHash);
    },
  };
  return Object.assign(implementation, {
    parseUrnCandidates: (input: string): Identifier[] =>
      urnCandidates(input).map((row) => new CorpusBackedIdentifier(row, resolveHash)),
  });
}
