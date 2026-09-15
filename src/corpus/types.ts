/**
 * The pubid-testsuite wire contract (schema/test.schema.yaml is the
 * authority; these types mirror it exactly). Every field is optional at
 * the schema level except id - the loader normalises to explicit
 * optionals rather than lying about shapes.
 */

export interface Representations {
  /** The canonical spelling AND the canonical parse input. */
  human: string;
  /** Emitted URN, absent when the reference emits none. */
  urn?: string;
}

export interface Spelling {
  spelling: string;
  style?: string;
}

export interface ErrorExpectation {
  /** Neutral rejection code - never an implementation class. */
  code: string;
}

export interface Expectation {
  error?: ErrorExpectation;
}

/**
 * One corpus case. `identifier` is the reference implementation's own
 * canonical toHash carried as DATA to compare against - an opaque record,
 * never interpreted structurally by the port.
 */
export interface CorpusCase {
  id: string;
  style?: string;
  identifier?: Record<string, unknown>;
  representations: Representations;
  nonNormalizedAliases?: Spelling[];
  /** Present only on exception (a documented round-trip failure). */
  roundtrip?: boolean;
  expect?: Expectation;
  /** Debt/negative rows carry the raw input instead of representations. */
  input?: string;
  notes?: string;
  /** Contract-linked expectation flag (tests/_contracts.yaml); never gated. */
  review?: string;
}

export interface FlavorStatus {
  clean: boolean;
  knownMismatches: number;
  knownSchemaErrors: number;
  notes?: string;
}

export function isErrorCase(testCase: CorpusCase): boolean {
  return testCase.expect?.error !== undefined;
}

/** Reference-bug debt: nothing to gate on. */
export function isQuarantined(testCase: CorpusCase): boolean {
  return testCase.identifier === undefined && !isErrorCase(testCase);
}

export function isReview(testCase: CorpusCase): boolean {
  return (testCase.review ?? "") !== "";
}
