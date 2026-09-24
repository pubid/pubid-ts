import type { Representations } from "../corpus/types.js";

/**
 * A flavor port's contract with the conformance runner - the same
 * surface the Ruby reference exposes (parse, toHash, toHuman, toUrn,
 * fromHash). Implementations land wave by wave; the runner reports
 * unimplemented flavors instead of gating them.
 */
export interface FlavorImplementation {
  /** Parse a canonical human form; must throw on a bad input. */
  parse(input: string): Identifier;
  /** Inverse of toUrn for flavors whose reference implements a URN
   *  parser; when absent, "urn:" inputs throw a not-supported error. */
  parseUrn?(urn: string): Identifier;
}

export interface Identifier {
  /** The canonical serialized form - compared byte-exactly against the corpus identifier record. */
  toHash(): Record<string, unknown>;
  /** The canonical human spelling. */
  toHuman(): string;
  /** The URN; undefined when the flavor emits none. */
  toUrn(): string | undefined;
  /** Deserialize the canonical hash; the idempotency gate relies on it. */
  fromHash(hash: Record<string, unknown>): Identifier;
}

export type ImplementationRegistry = Map<string, FlavorImplementation>;
