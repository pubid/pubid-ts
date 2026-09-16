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
 * overrides an exact hit.
 */
function collapseWs(spelling: string): string {
  return spelling.trim().replace(/\s+/g, " ");
}

function foldKey(spelling: string): string {
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
export function corpusModeImplementation(cases: CorpusCase[]): FlavorImplementation {
  const bySpelling = new Map<string, CorpusRow>();
  const byFoldedSpelling = new Map<string, CorpusRow>();
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
    if (row.urn !== undefined) indexSpelling(row.urn, row, true);
    for (const alias of testCase.nonNormalizedAliases ?? []) {
      indexSpelling(alias.spelling, row, true);
    }
  }
  return {
    parse(input: string): Identifier {
      const row =
        bySpelling.get(collapseWs(input)) ??
        byFoldedSpelling.get(foldKey(input));
      if (row === undefined) {
        throw new Error(`no such identifier in the published corpus: ${input}`);
      }
      return new CorpusBackedIdentifier(row, resolveHash);
    },
  };
}
