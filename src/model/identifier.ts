/**
 * BaseIdentifier — the TS mirror of Pubid::Identifier's declaration and
 * canonical-serialization core. Semantics pinned in
 * TODO.unified/01-study-pubid-core.md §2-3:
 *
 * toHash: `_type` first, mapped attributes, then canonicalization
 * (drop empty / default-valued attributes, recursively), then
 * degenerate-component flattening (`date: {year: "2024"}` → `year:
 * "2024"`, `edition: {number: "2"}` → `edition: "2"`), then the class's
 * compactHash hook.
 *
 * fromHash: dispatch on `_type` through the registered type map,
 * re-inflate flat scalars into component hashes (unless the flavor has a
 * converter for the key or declares the flat name as its own attribute),
 * construct with type coercion.
 *
 * Flavors NEVER hand-roll a hash here — they declare attributes and
 * mappings; the only imperative wire code is a converter pair.
 */

import type { AttributeTable, FieldMapping, AttributeSpec, ComponentCtor } from "./attribute.js";
import { FLAT_SCALAR_COMPONENTS, FLAT_SCALAR_FIELDS, BASE_ATTRIBUTES } from "./attribute.js";
import { Component } from "./component.js";
import { BaseUrnGenerator } from "./urn-generator.js";

export interface IdentifierStatic {
  new (attrs?: Record<string, unknown>): BaseIdentifier;
  polymorphicName: string;
  attributes: AttributeTable;
  /** Optional mapping overrides; default = every attribute under its own name. */
  mappings?: FieldMapping[];
  /** Per-class shorter-wire hook (Ruby compact_hash); must invert in inflate. */
  compactHash?: (model: BaseIdentifier, hash: Record<string, unknown>) => void;
  /** Additional flat-scalar entries for this class. */
  flatScalarComponents?: Record<string, string>;
  /** The field each additional flat-scalar component degenerates to. */
  flatScalarFields?: Record<string, string>;
  fromHash(hash: Record<string, unknown>): BaseIdentifier;
  /** The flavor's URN generator; undefined = the base template (Ruby resolve_urn_generator fallback). */
  urnGenerator?: UrnGeneratorCtor;
}

export type UrnGeneratorCtor = new (identifier: BaseIdentifier) => { generate(): string };

const TYPE_REGISTRY = new Map<string, IdentifierStatic>();

/** Register a concrete identifier class under its polymorphic _type (the *_TYPE_MAP role). */
export function registerType(klass: IdentifierStatic): void {
  TYPE_REGISTRY.set(klass.polymorphicName, klass);
}

function resolveType(type: string): IdentifierStatic | undefined {
  return TYPE_REGISTRY.get(type);
}

function isScalarType(t: AttributeSpec["type"]): t is "string" | "integer" | "boolean" {
  return typeof t === "string";
}

function coerce(value: unknown, spec: AttributeSpec): unknown {
  if (value === undefined || value === null) return value;
  if (spec.collection) {
    const list = Array.isArray(value) ? value : [value];
    return list.map((v) => coerceOne(v, spec));
  }
  return coerceOne(value, spec);
}

function coerceOne(value: unknown, spec: AttributeSpec): unknown {
  if (isScalarType(spec.type)) {
    if (spec.type === "integer") return Number(value);
    if (spec.type === "boolean") return Boolean(value);
    return typeof value === "object" && value !== null ? value : String(value);
  }
  if (value instanceof spec.type) return value;
  // A cross-flavor identifier instance (e.g. an IEC id nested in an IEEE
  // adoption) is complete already; coercing through the declared flavor's
  // fromHash would rebuild it as the wrong (abstract) class.
  if (value instanceof BaseIdentifier) return value;
  if (typeof value === "object" && value !== null) {
    // Identifier-typed attributes (oiml supplement `base`) dispatch
    // polymorphically through the registered type map.
    if (typeof spec.type === "function" && spec.type.prototype instanceof BaseIdentifier) {
      const idCtor = spec.type as unknown as IdentifierStatic;
      const v = value as Record<string, unknown>;
      return "_type" in v ? idCtor.fromHash(v) : idCtor.fromHash({ ...v, _type: idCtor.polymorphicName });
    }
    return new (spec.type as ComponentCtor)(value as Record<string, unknown>);
  }
  return value;
}

/** Utils.empty?: nil is NOT empty here (nil is dropped earlier); "" and [] are. */
function isEmptyValue(value: unknown): boolean {
  if (value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function resolveDefault(spec: AttributeSpec): unknown {
  return typeof spec.default === "function" ? (spec.default as () => unknown)() : spec.default;
}

export abstract class BaseIdentifier {
  declare static polymorphicName: string;
  /** The human renderer body — the one method every flavor writes. */
  abstract render(): string;
  /** The root table; subclasses compose via extendAttributes(BaseIdentifier, …). */
  static attributes: AttributeTable = BASE_ATTRIBUTES;
  declare static mappings: FieldMapping[] | undefined;
  declare static compactHash: ((model: BaseIdentifier, hash: Record<string, unknown>) => void) | undefined;
  declare static flatScalarComponents: Record<string, string> | undefined;

  declare ["constructor"]: IdentifierStatic;

  constructor(attrs: Record<string, unknown> = {}) {
    for (const [name, spec] of Object.entries(this.classAttributes())) {
      const value = attrs[name];
      if (value !== undefined) {
        (this as Record<string, unknown>)[name] = coerce(value, spec);
      } else if (spec.initializeEmpty && spec.collection) {
        (this as Record<string, unknown>)[name] = [];
      }
    }
  }

  /** The human form (Ruby render(format: :human) → the flavor renderer). */
  toHuman(): string {
    return this.render();
  }

  /** Ruby to_urn: the flavor's UrnGenerator, else the base template. */
  toUrn(): string {
    const Generator = this.constructor.urnGenerator ?? BaseUrnGenerator;
    return new Generator(this).generate();
  }

  fromHash(hash: Record<string, unknown>): BaseIdentifier {
    return this.constructor.fromHash(hash);
  }

  protected classAttributes(): AttributeTable {
    return this.constructor.attributes;
  }

  /** Wire key for an attribute: custom mapping or the attribute name. */
  protected wireKeyFor(name: string): { wire: string; toWire?: FieldMapping["toWire"] } {
    const mappings = this.constructor.mappings;
    const found = mappings?.find((m) => m.to === name);
    return found ?? { wire: name };
  }

  protected attrValue(name: string): unknown {
    return (this as Record<string, unknown>)[name];
  }

  /** Serialize one attribute's value (component → toWire, nested identifier → toHash, scalars as-is). */
  protected serializeValue(value: unknown): unknown {
    if (value instanceof BaseIdentifier) return value.toHash();
    if (value instanceof Component) return value.toWire();
    if (Array.isArray(value)) return value.map((v) => this.serializeValue(v));
    return value;
  }

  toHash(): Record<string, unknown> {
    const hash: Record<string, unknown> = { _type: this.constructor.polymorphicName };
    // A flavor's explicit mapping list is a WHITELIST (lutaml key_value):
    // unmapped attributes never serialize — that is how un keeps its
    // runtime `date` out of the hash while the URN still reads it.
    const mappings = this.constructor.mappings;
    const emitted: [name: string, wire: string, toWire?: FieldMapping["toWire"]][] = mappings
      ? mappings.map((m) => [m.to, m.wire, m.toWire])
      : Object.keys(this.classAttributes()).map((name) => [name, name, undefined]);
    for (const [name, wire, toWire] of emitted) {
      const value = this.attrValue(name);
      // nil never serializes; empty and default-valued attributes are
      // dropped by canonicalization (TODO.unified/01 §2.2).
      if (value === undefined || value === null) continue;
      const spec = this.classAttributes()[name];
      if (spec && isEmptyValue(value)) continue;
      if (spec?.default !== undefined && deepEqual(value, resolveDefault(spec))) continue;
      const serialized = toWire ? toWire(this as unknown as Record<string, unknown>) : this.serializeValue(value);
      if (serialized === undefined || serialized === null) continue;
      hash[wire] = serialized;
    }
    this.flattenScalars(hash);
    this.constructor.compactHash?.(this, hash);
    return hash;
  }

  /**
   * Degenerate single-field components collapse to their scalar
   * (identifier.rb flatten_scalar_components): `date` RENAMES to `year`,
   * `edition` keeps its name; guards: never overwrite an emitted wire
   * key, never rename onto a declared attribute name.
   */
  protected flattenScalars(hash: Record<string, unknown>): void {
    const table = { ...FLAT_SCALAR_COMPONENTS, ...this.constructor.flatScalarComponents };
    for (const [attrName, flatKey] of Object.entries(table)) {
      const key = attrName in hash ? attrName : undefined;
      if (key === undefined) continue;
      const value = hash[key]!;
      const field = FLAT_SCALAR_FIELDS[attrName] ?? this.constructor.flatScalarFields?.[attrName];
      if (field === undefined) continue;
      const model = this.attrValue(attrName);
      if (Array.isArray(value) && Array.isArray(model)) {
        if (model.every((c) => c instanceof Component) && model.length === value.length) {
          const scalars = model.map((c: Component) => c.degenerateScalar(field));
          if (scalars.every((s) => s !== undefined)) hash[key] = scalars;
        }
        continue;
      }
      if (!(model instanceof Component)) continue;
      const scalar = model.degenerateScalar(field);
      if (scalar === undefined) continue;
      if (flatKey !== key) {
        if (flatKey in hash || flatKey in this.classAttributes()) continue;
        delete hash[key];
        hash[flatKey] = scalar;
      } else {
        hash[key] = scalar;
      }
    }
  }

  static fromHash(hash: Record<string, unknown>): BaseIdentifier {
    const klass = typeof hash["_type"] === "string" ? resolveType(hash["_type"]) : undefined;
    if (klass && klass !== (this as unknown as IdentifierStatic)) {
      return klass.fromHash(hash);
    }
    const inflated = this.inflateScalarComponents(hash);
    return new (this as unknown as new (attrs?: Record<string, unknown>) => BaseIdentifier)(
      this.applyMappings(inflated),
    );
  }

  /** Re-nest flat scalars into component hashes (identifier.rb inflate_scalar_components). */
  protected static inflateScalarComponents(data: Record<string, unknown>): Record<string, unknown> {
    const klass = this as unknown as IdentifierStatic;
    if (!klass.attributes) return data;
    const convertedKeys = new Set((klass.mappings ?? []).map((m) => m.wire));
    const out = { ...data };
    for (const [attrName, flatKey] of Object.entries({ ...FLAT_SCALAR_COMPONENTS, ...klass.flatScalarComponents })) {
      const spec = klass.attributes[attrName];
      if (!spec || typeof spec.type === "string") continue; // component attributes only
      if (convertedKeys.has(flatKey)) continue;
      if (flatKey !== attrName && flatKey in klass.attributes) continue;
      const value = out[flatKey];
      if (value === undefined || value === null || typeof value === "object") continue;
      const field = FLAT_SCALAR_FIELDS[attrName]!;
      if (Array.isArray(value)) continue; // scalar-list collections keep their name
      delete out[flatKey];
      out[attrName] = { [field]: String(value) };
    }
    return out;
  }

  /** Apply custom `fromWire` converters to the inflated hash. */
  protected static applyMappings(data: Record<string, unknown>): Record<string, unknown> {
    const klass = this as unknown as IdentifierStatic;
    const mappings = klass.mappings;
    if (!mappings) return data;
    const out = { ...data };
    for (const m of mappings) {
      if (m.fromWire && m.wire in out) {
        const value = m.fromWire(out);
        if (value !== undefined && value !== null) out[m.to] = value;
      } else if (m.wire !== m.to && m.wire in out) {
        out[m.to] = out[m.wire];
        delete out[m.wire];
      }
    }
    return out;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
