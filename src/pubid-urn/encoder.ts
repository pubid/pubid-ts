/**
 * Writes the pubid-scheme URN of an identifier hash — the TS mirror of
 * Pubid::PubidUrn::Encoder (lib/pubid/pubid_urn/encoder.rb).
 *
 *   urn:pubid:<flavor>:<node>[:<node>…][:f:<facet>…]
 *   <node> = <type>[:<core>…][:<prefix>-<value>…]
 *
 * The nodes go root first, along `base`: "ISO 9001:2015/Amd 1:2016" is
 * "is:9001:year-2015:amd:1:year-2016", so every supplement of a document
 * shares its slug prefix. A core value is positional; an absent one in
 * the middle is "~", and absent ones at the end are dropped. An optional
 * value is a prefixed atom, so it leaves no segment when it is absent.
 */

import { typeSchemaOrThrow, structural } from "./index.js";
import { InvalidInputError } from "./errors.js";
import { decode as escapeDecode, encode as escapeEncode, force } from "./escape.js";
import { blank, deepDup, isNil, take } from "./paths.js";
import { Encoder as _Encoder } from "./encoder.js";
import type { Atom, Facet, TypeSchema } from "./schema.js";

/** ruby's PubidUrn::NULL: the absent-slot marker. */
const NULL = "~";

export class Encoder {
  constructor(private readonly hash: Record<string, unknown>) {}

  /** The body after "urn:pubid:". */
  body(): string {
    const flavor = flavorSegmentOf(this.hash["_type"]);
    return `${flavor}:${this.encodeIdentifier(this.hash, flavor)}`;
  }

  private encodeIdentifier(hash: Record<string, unknown>, flavor: string | undefined): string {
    const segments: string[] = [];
    const facets: string[] = [];
    this.chain(hash).forEach((node, index) => {
      const schema = typeSchemaOrThrow(node["_type"]);
      const copy = deepDup(node) as Record<string, unknown>;
      delete copy["_type"];
      segments.push(this.token(schema, flavor));
      segments.push(...this.coreSegments(copy, schema));
      segments.push(...this.atomSegments(copy, schema));
      facets.push(...this.facetSegments(copy, schema, index));
      checkPlaced(copy, schema);
    });
    if (facets.length > 0) segments.push("f", ...facets);
    return segments.join(":");
  }

  /** The nodes from the root document to `hash` itself. */
  private chain(hash: Record<string, unknown>): Record<string, unknown>[] {
    const nodes: Record<string, unknown>[] = [];
    let node: unknown = hash;
    while (node !== undefined && node !== null) {
      if (
        typeof node !== "object" ||
        Array.isArray(node) ||
        typeof (node as Record<string, unknown>)["_type"] !== "string"
      ) {
        throw new InvalidInputError(
          `a pubid URN base must be an identifier hash, got ${inspect(node)}`,
        );
      }
      const copy: Record<string, unknown> = { ...(node as Record<string, unknown>) };
      delete copy["base"];
      nodes.unshift(copy);
      node = (node as Record<string, unknown>)["base"];
    }
    return nodes;
  }

  private token(schema: TypeSchema, flavor: string | undefined): string {
    return schema.flavor === flavor ? schema.token : `${schema.flavor}.${schema.token}`;
  }

  private coreSegments(node: Record<string, unknown>, schema: TypeSchema): string[] {
    const values = schema.core.map((parts) => take(node, parts as string[]));
    while (values.length > 0 && isNil(values[values.length - 1])) values.pop();
    return values.map((value, i) => {
      if (isNil(value)) return NULL;
      if (schema.coreKinds[i] === "int") return coreInteger(value, schema, i);
      return coreValue(value, schema);
    });
  }

  private atomSegments(node: Record<string, unknown>, schema: TypeSchema): string[] {
    const segments: string[] = [];
    for (const atom of schema.atoms) {
      const value = take(node, atom.parts as string[]);
      if (isNil(value)) continue;
      segments.push(`${atom.prefix}-${this.atomValue(value, atom, schema)}`);
    }
    return segments;
  }

  private atomValue(value: unknown, atom: Atom, schema: TypeSchema): string {
    if (atom.kind === "int") return String(typed(value, "number", atom, schema));
    if (atom.kind === "id") {
      return nested(typed(value, "hash", atom, schema) as Record<string, unknown>);
    }
    if (atom.kind === "ids") {
      return (typed(value, "array", atom, schema) as unknown[])
        .map((hash) => nested(hash as Record<string, unknown>))
        .join(",");
    }
    return this.slotValue(value, atom, schema);
  }

  /** The value of a :string, :bool or list atom, or of a facet. */
  private slotValue(value: unknown, slot: Atom | Facet, schema: TypeSchema): string {
    if (!slot.list) return this.scalar(value, slot, schema);
    return (typed(value, "array", slot, schema) as unknown[])
      .map((item) => (isNil(item) ? NULL : this.scalar(item, slot, schema)))
      .join(",");
  }

  private scalar(value: unknown, slot: Atom | Facet, schema: TypeSchema): string {
    if (slot.element === "bool") {
      if (value !== true && value !== false) {
        throw typeError(value, slot, schema);
      }
      return String(value);
    }
    return escapeEncode(typed(value, "string", slot, schema) as string);
  }

  private facetSegments(node: Record<string, unknown>, schema: TypeSchema, index: number): string[] {
    const segments: string[] = [];
    for (const facet of schema.facets) {
      const value = take(node, facet.parts as string[]);
      if (isNil(value)) continue;
      segments.push(`${index}.${facet.name}-${this.slotValue(value, facet, schema)}`);
    }
    return segments;
  }
}

function nested(hash: Record<string, unknown>): string {
  return `(${new _Encoder(hash).body()})`;
}

/** A decimal never has the shape of structure, so it needs no escape. */
function coreInteger(value: unknown, schema: TypeSchema, index: number): string {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  throw new InvalidInputError(
    `${schema.type} ${schema.core[index]?.join(".")}: ${inspect(value)} is not int`,
  );
}

/** A core value that has the shape of structure gets its first character
 *  escaped. */
function coreValue(value: unknown, schema: TypeSchema): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidInputError(
      `core value of ${schema.type} must be a non-empty String, got ${inspect(value)}`,
    );
  }
  const encoded = escapeEncode(value);
  if (!structural(encoded)) return encoded;
  const chars = Array.from(value);
  return force(chars[0] as string) + escapeEncode(chars.slice(1).join(""));
}

function typed(value: unknown, expected: "number" | "string" | "hash" | "array", slot: Atom | Facet, schema: TypeSchema): unknown {
  let ok: boolean;
  switch (expected) {
    case "number":
      ok = typeof value === "number" && Number.isInteger(value);
      break;
    case "string":
      ok = typeof value === "string";
      break;
    case "hash":
      ok = value !== null && typeof value === "object" && !Array.isArray(value);
      break;
    case "array":
      ok = Array.isArray(value);
      break;
  }
  if (ok) return value;
  throw typeError(value, slot, schema);
}

function typeError(value: unknown, slot: Atom | Facet, schema: TypeSchema): InvalidInputError {
  return new InvalidInputError(
    `${schema.type} ${slot.path}: ${inspect(value)} is not ${slot.kind}`,
  );
}

function checkPlaced(node: Record<string, unknown>, schema: TypeSchema): void {
  const left: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!blank(value)) left[key] = value;
  }
  if (Object.keys(left).length > 0) {
    throw new InvalidInputError(
      `the pubid URN schema of ${schema.type} does not place ${inspect(left)}`,
    );
  }
}

function inspect(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function flavorSegmentOf(type: unknown): string | undefined {
  return typeof type === "string" ? type.split(":")[1] : undefined;
}
