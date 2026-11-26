/**
 * The parse surface (pubid/pubid-ts#226): one entry point per parse
 * concern, exported from the package root so consumers — relaton-api-js
 * first (their #176/#182/#165) — can drop their internal derivation:
 *
 * - {@link parse} — the structured components per parse (every facet,
 *   typed, per the wire shape) plus the canonical render and the lane
 *   keys, in one result;
 * - {@link render} — the canonical human form;
 * - {@link laneKeys} — the `dated` / `undated` / `all_parts` normalized
 *   keys mirroring the corpus lanes, with the `norm` /
 *   `undatedNorm` / `allPartsNorm` derivation helpers;
 * - {@link parseOk} — the boolean verdict helper, with {@link ParseError}
 *   surfaced as the failure class.
 *
 * Parity law: every derivation mirrors the Ruby reference exactly. The
 * lane semantics are the ones the corpus lanes pin (the same the Ruby
 * key generator applies): `norm` uppercases the canonical render and
 * deletes spaces; `undated` strips every colon-year not followed by a
 * dash; `all_parts` additionally strips the parsed part — structurally,
 * never by guessing (a trailing "-05" that pubid did not parse as a
 * part is a date day, not a part, and stays).
 */
import type { FlavorImplementation } from "./conformance/implementation.js";
import { grammarImplementation } from "./flavors/index.js";
import { corpusModeImplementation } from "./implementations/corpus-mode.js";
import { loadBundledCorpus } from "./corpus/artifact.js";

/** The failure class of the parse surface: every rejected input and
 * unknown flavor raises this (wrapped engine errors ride as `cause`). */
export class ParseError extends Error {
  /** The rejected input. */
  readonly input: string;
  /** The flavor the parse ran under, when one was named. */
  readonly flavor: string | undefined;

  constructor(message: string, opts: { input: string; flavor?: string; cause?: unknown }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ParseError";
    this.input = opts.input;
    this.flavor = opts.flavor;
  }
}

/** The lane keys of one identifier: the lookup lanes the corpus and the
 * consumers index by. */
export interface LaneKeys {
  /** The dated lane: the normalized canonical (uppercased, de-spaced). */
  dated: string;
  /** The undated lane: every colon-year not followed by a dash is gone
   * (base and supplement alike — one rule, no per-flavor casing). */
  undated: string;
  /** The all-parts lane: the parsed part stripped from the undated lane.
   * Structural only — an unparsed trailing "-N" is never a part. */
  all_parts: string;
}

/** One successful parse: the structured components, the canonical render
 * and the lane keys, per the export contract of pubid-ts#226. */
export interface ParseResult {
  /** The flavor the parse ran under. */
  flavor: string;
  /** The input as given. */
  input: string;
  /** The canonical human spelling (the normalized render). */
  canonical: string;
  /** The URN; undefined when the flavor emits none. */
  urn?: string;
  /** The structured components — the reference's own canonical toHash
   * record (the wire shape), every facet typed per the corpus schema. */
  components: Record<string, unknown>;
  /** The year facet, string-normalized; undefined when undated. */
  year?: string;
  /** The structural part: the identifier's own part facet, else the
   * base identifier's (amendments and corrigenda inherit it). */
  part?: string;
  /** The dated / undated / all_parts lane keys. */
  keys: LaneKeys;
}

/** Memoized corpus-mode implementations for the flavors whose grammar is
 * not ported yet (currently adobe and sae): they parse over the bundled
 * corpus, loaded lazily — the grammar flavors never touch it. */
let bundledCorpusImplementations: Map<string, FlavorImplementation> | undefined;

function corpusImplementation(flavor: string): FlavorImplementation | undefined {
  if (bundledCorpusImplementations === undefined) {
    const corpus = loadBundledCorpus();
    bundledCorpusImplementations = new Map(
      [...corpus.flavors].map(([name, payloads]) => [
        name,
        corpusModeImplementation(payloads.cases),
      ]),
    );
  }
  return bundledCorpusImplementations.get(flavor);
}

function implementationFor(flavor: string): FlavorImplementation {
  const grammar = grammarImplementation(flavor);
  if (grammar !== undefined) return grammar;
  const corpus = corpusImplementation(flavor);
  if (corpus !== undefined) return corpus;
  throw new ParseError(`unknown flavor: ${flavor}`, { input: "", flavor });
}

/** Ruby Regexp.escape, for the all-parts strip of an arbitrary part. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The dated lane: the canonical render uppercased and de-spaced. Ruby's
 * `canonical.upcase.delete(" ")` — exactly the space character is
 * deleted, not every whitespace run.
 */
export function norm(canonical: string): string {
  return canonical.toUpperCase().replaceAll(" ", "");
}

/**
 * The undated lane from a norm key: every `:?`-year not followed by a
 * dash is stripped — globally, base and supplement years alike. Ruby's
 * `gsub(/:?(?:19|20)\d{2}(?=[^-]*$)/, "")` verbatim.
 */
export function undatedNorm(normKey: string): string {
  return normKey.replace(/:?(?:19|20)\d{2}(?=[^-]*$)/g, "");
}

/**
 * The all-parts lane from an undated key: the FIRST `-<part>` not
 * followed by a dash is stripped. Ruby's
 * `sub(/-#{Regexp.escape(part)}(?=[^-]*$)/, "")` — only a structurally
 * parsed part is ever stripped; a blank part strips nothing.
 */
export function allPartsNorm(undated: string, part?: string): string {
  if (part === undefined || part === "") return undated;
  return undated.replace(new RegExp(`-${escapeRegExp(part)}(?=[^-]*$)`), "");
}

/**
 * The structural part of a canonical component record: the identifier's
 * own `part` facet, else the base's (Ruby's `id.part || id.base&.part`).
 * A part facet is either a string or a typed record carrying `value`
 * (the NIST lettered parts); anything else is no part.
 */
function structuralPart(components: Record<string, unknown>): string | undefined {
  const base = components["base"];
  const raw =
    components["part"] !== undefined && components["part"] !== null
      ? components["part"]
      : base !== undefined && base !== null && typeof base === "object"
        ? (base as Record<string, unknown>)["part"]
        : undefined;
  if (typeof raw === "string") return raw;
  if (raw !== undefined && raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)["value"];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/** The lane keys for an already-canonical record: norm from the render,
 * undated from the norm, all_parts from the parsed part — the corpus
 * lane derivations, nothing guessed. */
function laneKeysFrom(
  canonical: string,
  components: Record<string, unknown>,
): LaneKeys {
  const dated = norm(canonical);
  const undated = undatedNorm(dated);
  return {
    dated,
    undated,
    all_parts: allPartsNorm(undated, structuralPart(components)),
  };
}

/** The year facet of a component record, string-normalized. */
function structuralYear(components: Record<string, unknown>): string | undefined {
  const year = components["year"];
  if (typeof year === "string") return year;
  if (typeof year === "number") return String(year);
  return undefined;
}

/**
 * Parse one identifier: the structured components per parse, the
 * canonical render, the URN and the lane keys in one result. Rejections
 * raise {@link ParseError} — the surfaced failure class the verdict
 * helper {@link parseOk} folds to `false`.
 *
 * The flavor must be named: grammar-ported flavors parse open-endedly;
 * the rest resolve over the bundled corpus (the same coverage the
 * conformance surface offers). URN spellings parse where the reference
 * implements a URN parser.
 */
export function parse(input: string, flavor: string): ParseResult {
  let identifier;
  try {
    identifier = implementationFor(flavor).parse(input);
  } catch (cause) {
    // Unknown-flavor ParseErrors carry no input (implementationFor sees
    // only the flavor) - rebuild with the input, preserving the cause.
    if (cause instanceof ParseError) {
      throw new ParseError(cause.message, { input, flavor, cause });
    }
    throw new ParseError(`cannot parse ${JSON.stringify(input)} as ${flavor}`, {
      input,
      flavor,
      cause,
    });
  }
  const canonical = identifier.toHuman();
  const urn = identifier.toUrn();
  const components = identifier.toHash();
  const year = structuralYear(components);
  const part = structuralPart(components);
  return {
    flavor,
    input,
    canonical,
    ...(urn !== undefined ? { urn } : {}),
    components,
    ...(year !== undefined ? { year } : {}),
    ...(part !== undefined ? { part } : {}),
    keys: laneKeysFrom(canonical, components),
  };
}

/**
 * The verdict helper: true when the input parses under the flavor, false
 * when it is rejected (the citation-validation primitive — never an
 * exception path).
 */
export function parseOk(input: string, flavor: string): boolean {
  try {
    parse(input, flavor);
    return true;
  } catch {
    return false;
  }
}

/**
 * The canonical render: the normalized human form of one identifier.
 * Rejections raise {@link ParseError}.
 */
export function render(input: string, flavor: string): string {
  return parse(input, flavor).canonical;
}

/**
 * The lane keys of one identifier: `dated` / `undated` / `all_parts`,
 * derived through the full parse — the corpus lane semantics (see
 * {@link norm}, {@link undatedNorm}, {@link allPartsNorm}). Rejections
 * raise {@link ParseError}.
 */
export function laneKeys(input: string, flavor: string): LaneKeys {
  return parse(input, flavor).keys;
}
