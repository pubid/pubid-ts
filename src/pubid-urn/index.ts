/**
 * The pubid-scheme URN (pubid#656) — the TS mirror of
 * Pubid::PubidUrn (lib/pubid/pubid_urn.rb). Pubid's own URN namespace,
 * which carries the full typed model and always round-trips —
 * `parsePubidUrn(generate(id.toHash())).toHash == id.toHash`.
 *
 * It is a different thing from the official URN (`toUrn()`, e.g.
 * "urn:iso:std:…"), which follows the registered grammar of the
 * organization and may be lossy. relaton uses the pubid-scheme URN as
 * its HTTP path slug (relaton/relaton#441), so the form is also
 * path-safe: no "/", "%", "?", "#" and no empty segment.
 *
 *   urn:pubid:iso:is:9001:year-2015:amd:1:year-2016
 *
 * The shape of each identifier type is declared in its flavor's schema
 * (src/pubid-urn/schemas/<flavor>.ts), through {@linkcode define}. A
 * flavor with no schema cannot emit one yet.
 */

import { FlavorSchema, type TypeSchema } from "./schema.js";
import { InvalidInputError, UrnParseError } from "./errors.js";
import { Encoder } from "./encoder.js";
import { Decoder } from "./decoder.js";
import { exactMatch } from "./escape.js";
import { PUBID_URN_SCHEMAS } from "./schemas/index.js";
import { resolveType } from "../model/identifier.js";
import type { BaseIdentifier } from "../model/identifier.js";
import { toSlug, fromSlug } from "./slug.js";

export { toSlug, fromSlug };
export { Atom, Facet, FlavorSchema, TypeSchema } from "./schema.js";
export type { AtomKind, FacetKind, CoreKind, CoreSpec, AtomSpec, FacetSpec, TypeDeclaration } from "./schema.js";
export { Encoder } from "./encoder.js";
export { Decoder } from "./decoder.js";
export { UrnParseError, InvalidInputError } from "./errors.js";
export { encode, force, decode } from "./escape.js";
export { take, put, blank } from "./paths.js";

export const PREFIX = "urn:pubid:";
/** An absent core value in the middle of the core, or an absent element
 *  of a list. Distinct from an escape, which always has two hex digits. */
export const NULL = "~";
/** Pubid::MAX_INPUT_LENGTH (1000) — the printed-identifier guard. */
export const MAX_INPUT_LENGTH = 1000;
export const MAX_LENGTH = 16 * MAX_INPUT_LENGTH;

const INPUT_NOT_A_STRING_MESSAGE = "input is not a String";

/**
 * A raw segment that reads as structure and not as a core value: a type
 * token or the facet marker ("amd", "f"), an atom ("year-2015"), or a
 * token of another flavor ("iec.is", "3gpp.ts").
 *
 * The rule depends on the SHAPE of the segment only, never on which
 * schemas exist. So a published URN keeps its meaning when a flavor, a
 * type token or an atom is added later. Type tokens, atom prefixes and
 * facet names therefore start with a lower-case letter
 * (FlavorSchema.NAME). Digit-led numbers ("9001", "802.11", "800-53")
 * and upper-case ones ("G.711") never match; a core value that does
 * match gets its first character escaped ("iec.is" -> "~69ec.is").
 */
const STRUCTURE_HEAD = /^[a-z][a-z0-9]*/;
const STRUCTURE_FLAVOR_TOKEN = /^[a-z0-9]*[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/;

/** The schema registry: flavor segment => its FlavorSchema. Built lazily
 *  from the declarative tables in ./schemas/ (no import side effects). */
let registry: Map<string, FlavorSchema> | undefined;
function schemas(): Map<string, FlavorSchema> {
  if (registry === undefined) {
    registry = new Map(PUBID_URN_SCHEMAS.map((schema) => [schema.flavor, schema]));
  }
  return registry;
}

/** Declare the schema of a flavor. `flavor` is the flavor segment of its
 *  `_type` ("iso", "cencenelec", "3gpp"). The callback plays ruby's
 *  instance_eval: it receives the schema and declares atoms/facets/types. */
export function define(flavor: string, body: (schema: FlavorSchema) => void): FlavorSchema {
  const schema = new FlavorSchema(flavor);
  body(schema);
  return schema;
}

/** The pubid-scheme URN of an identifier hash (ruby generate(identifier):
 *  the hash is Identifier#to_hash's output). */
export function generate(hash: Record<string, unknown>): string {
  const urn = PREFIX + new Encoder(hash).body();
  if (urn.length > MAX_LENGTH) {
    throw new InvalidInputError(`pubid URN exceeds ${MAX_LENGTH} characters`);
  }
  return urn;
}

/** Parse a pubid-scheme URN back into an identifier, through the
 *  canonical gate: the decoded identifier must re-encode to exactly the
 *  input, so one identifier has exactly one URN. */
export function parse(urn: string): BaseIdentifier {
  checkInput(urn);
  const identifier = build(urn.slice(PREFIX.length));
  checkCanonical(identifier, urn);
  return identifier;
}

/** True for "urn:pubid:…" (the NID is case-insensitive, RFC 8141). */
export function isPubidUrn(urn: string): boolean {
  return urn.slice(0, PREFIX.length).toLowerCase() === PREFIX;
}

/** "iso" in "pubid:iso:technical-report". */
export function flavorSegment(type: unknown): string | undefined {
  return typeof type === "string" ? type.split(":")[1] : undefined;
}

export function flavorSchema(flavor: string): FlavorSchema | undefined {
  return schemas().get(flavor);
}

/** @raise InvalidInputError when no schema places `type`. */
export function typeSchemaOrThrow(type: unknown): TypeSchema {
  const flavor = flavorSegment(type);
  const schema = flavor !== undefined ? flavorSchema(flavor)?.forType(type as string) : undefined;
  if (schema !== undefined) return schema;
  throw new InvalidInputError(`no pubid URN schema for ${JSON.stringify(type)}`);
}

/** Does `token` (a raw, still escaped segment) read as structure? */
export function structural(token: string): boolean {
  const head = STRUCTURE_HEAD.exec(token);
  if (head !== null) {
    const len = head[0].length;
    if (len === token.length || token[len] === "-") return true;
  }
  const flavorToken = STRUCTURE_FLAVOR_TOKEN.exec(token);
  return flavorToken !== null && flavorToken[0].length === token.length;
}

/** A type token is "<token>" of the URN's own flavor, or
 *  "<flavor>.<token>" for a node of another flavor. */
export function splitToken(token: string, flavor: string): [string, string] {
  return token.includes(".") ? (token.split(".", 2) as [string, string]) : [flavor, token];
}

/** Split `body` at `separator` outside brackets. `allowEmpty` is true for
 *  the items of a list, where an empty item is an empty String; a ":"
 *  segment is never empty. */
export function splitTop(body: string, separator: string, allowEmpty = false): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth < 0) unbalanced(body);
    }
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (depth !== 0) unbalanced(body);

  parts.push(current);
  if (!allowEmpty && parts.some((part) => part === "")) {
    throw new UrnParseError(`empty segment in ${JSON.stringify(body)}`);
  }
  return parts;
}

function unbalanced(body: string): never {
  throw new UrnParseError(`unbalanced bracket in ${JSON.stringify(body)}`);
}

function checkInput(urn: string): void {
  if (typeof urn !== "string") {
    throw new InvalidInputError(INPUT_NOT_A_STRING_MESSAGE);
  }
  if (urn.length > MAX_LENGTH) {
    throw new InvalidInputError(`input exceeds ${MAX_LENGTH} characters`);
  }
  // ruby also rejects a String with invalid byte encoding; a JS string is
  // always valid UTF-16, so that half of the check has no counterpart.
  if (!isPubidUrn(urn)) {
    throw new UrnParseError(`not a pubid-scheme URN: ${JSON.stringify(urn)}`);
  }
}

/** The URN is untrusted input: a value that decodes but cannot be cast
 *  into its attribute (a bad boolean, a String where a component goes)
 *  is a bad URN, so every failure here is reported as UrnParseError,
 *  with the original error as its cause. */
function build(body: string): BaseIdentifier {
  let hash: Record<string, unknown>;
  let built: BaseIdentifier;
  try {
    hash = new Decoder(body).toIdentifierHash();
    const klass = resolveType(hash["_type"] as string);
    if (klass === undefined) {
      throw new InvalidInputError(
        `unknown identifier type ${JSON.stringify(hash["_type"])}`,
      );
    }
    built = klass.fromHash(hash);
  } catch (e) {
    if (e instanceof UrnParseError) throw e;
    throw new UrnParseError(
      `pubid URN ${JSON.stringify(body)} does not build: ${errorMessage(e)}`,
    );
  }
  return built;
}

function checkCanonical(identifier: BaseIdentifier, urn: string): void {
  let canonical: string;
  try {
    canonical = generate(identifier.toHash());
  } catch (e) {
    if (e instanceof InvalidInputError) {
      throw new UrnParseError(`${JSON.stringify(urn)} does not re-encode: ${errorMessage(e)}`);
    }
    throw e;
  }
  if (canonical.slice(PREFIX.length) !== urn.slice(PREFIX.length)) {
    throw new UrnParseError(
      `${JSON.stringify(urn)} is not canonical; the canonical form is ${JSON.stringify(canonical)}`,
    );
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// exactMatch is re-exported for the schemas' own probes; the module
// surface mirrors lib/pubid/pubid_urn.rb's helpers.
export { exactMatch };
