/**
 * Declarative attributes and wire mappings — the TS mirror of pubid's
 * `attribute` DSL + lutaml key_value mappings. Semantics pinned in
 * TODO.unified/01-study-pubid-core.md §1-3.
 *
 * A flavor DECLARES its shape; BaseIdentifier derives serialization.
 * The only imperative wire code allowed is a converter pair
 * (`toWire`/`fromWire`), mirroring Ruby's `map "x", with: {to:, from:}`.
 */

import type { Component } from "./component.js";
import { PubidDate, Publisher, Language, Edition, Iteration } from "./component.js";

export type ScalarType = "string" | "integer" | "boolean";

export type ComponentCtor = new (attrs: Record<string, unknown>) => Component;

export type AttributeType = ScalarType | ComponentCtor;

export interface AttributeSpec {
  type: AttributeType;
  /** Value or thunk; a value equal to the default is dropped from the canonical hash. */
  default?: unknown;
  collection?: boolean;
  /** Materialize [] when the input hash omits the key (tgpp parts). */
  initializeEmpty?: boolean;
}

export type AttributeTable = Record<string, AttributeSpec>;

/**
 * Ruby snapshots the parent attribute table into each subclass at
 * class-definition time; TS composes the same way — a subclass's table
 * is the parent's plus its overrides.
 */
export function extendAttributes(
  parent: { attributes: AttributeTable },
  defs: AttributeTable,
): AttributeTable {
  return { ...parent.attributes, ...defs };
}

/**
 * The base table mirrors Pubid::Identifier (identifier.rb:503-525),
 * minus the slots no ported flavor populates yet (type, stage, locality,
 * typed_stage — they join when a flavor needs them).
 */
export const BASE_ATTRIBUTES: AttributeTable = {
  number: { type: "string" },
  part: { type: "string" },
  subpart: { type: "string" },
  stage_iteration: { type: Iteration },
  date: { type: PubidDate },
  edition: { type: Edition },
  languages: { type: Language, collection: true },
  publisher: { type: Publisher },
  copublishers: { type: Publisher, collection: true },
  all_parts: { type: "boolean", default: false },
};

export interface FieldMapping {
  /** Wire key. */
  wire: string;
  /** Attribute name. */
  to: string;
  /** Custom wire converter (Ruby `map ... with: {to:}`). */
  toWire?: (model: Record<string, unknown>) => unknown;
  /** Custom reader (Ruby `map ... with: {from:}`). */
  fromWire?: (hash: Record<string, unknown>) => unknown;
}

export function keyValue(...fields: FieldMapping[]): FieldMapping[] {
  return fields;
}

/**
 * The flat-scalar tables (identifier.rb:24-36): attribute name → the wire
 * key its degenerate scalar is emitted under (note `date` RENAMES to
 * `year`), and the single field each component degenerates to.
 */
export const FLAT_SCALAR_COMPONENTS: Record<string, string> = {
  edition: "edition",
  date: "year",
  stage_iteration: "stage_iteration",
};

export const FLAT_SCALAR_FIELDS: Record<string, string> = {
  edition: "number",
  date: "year",
  stage_iteration: "string",
};
