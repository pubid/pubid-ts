import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { apiGrammar, preprocessApi } from "./grammar.js";
import { TypelessStandardClass, TYPE_CLASS_MAP } from "./model.js";
import type { IdentifierStatic } from "../../model/identifier.js";

/**
 * Port of lib/pubid/api/builder.rb — type dispatch plus the shared
 * base-builder assignment loop (chapter routes into `number`; :type is
 * dispatch-only and dropped).
 */

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const strv = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    const joined = v.flat(10).map(String).join("");
    return joined.length > 0 ? joined : undefined;
  }
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
};

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

type Ctor = new (attrs?: Record<string, unknown>) => Identifier;

function castValue(key: string, value: unknown): string | undefined {
  if (key === "reaffirmation") {
    return isObj(value) ? strv((value as Record<string, unknown>)["year"]) : strv(value);
  }
  return strv(value);
}

function assignAttributes(identifier: Identifier, data: Record<string, unknown>): void {
  const self = identifier as unknown as Record<string, unknown>;
  const known = new Set([
    "publisher", "number", "part", "subpart", "year", "reaffirmation",
    "section", "subsection",
  ]);
  for (const [key, value] of Object.entries(data)) {
    if (key === "type") continue;
    if (key === "chapter") {
      const chapter = strv(value);
      if (chapter !== undefined) self["number"] = chapter;
      continue;
    }
    // :part_number is a parse-tree key the gem's base builder silently
    // drops (not an attribute) — matched 1:1.
    if (!known.has(key)) continue;
    const realized = castValue(key, value);
    if (realized !== undefined) self[key] = realized;
  }
}

// The bound grammar wraps the combined form's first/second identifiers
// under "first"/"second"; the reference folds both wrappers into one
// hash in parse order, so the second side's number/part/year overwrite
// the first's — and select_class saw no top-level :type, so a combined
// form always built the typeless class. Reproduce both.
const SECOND_KEYS = ["second_number", "second_part", "second_year", "second_type"];
const SECOND_OVERWRITES: Record<string, string> = {
  second_number: "number",
  second_part: "part",
  second_year: "year",
};

function unflattenCombined(data: Record<string, unknown>): Record<string, unknown> {
  if (!SECOND_KEYS.some((k) => k in data)) return data;
  const out = { ...data };
  delete out["type"];
  for (const [source, target] of Object.entries(SECOND_OVERWRITES)) {
    if (source in out) out[target] = out[source];
  }
  return out;
}

export function buildApiIdentifier(tree: Tree): Identifier {
  const data = flatten(tree) as Record<string, unknown>;
  const first = isObj(data["first"]) ? (data["first"] as Record<string, unknown>) : undefined;
  const second = isObj(data["second"]) ? (data["second"] as Record<string, unknown>) : undefined;
  // Parse-order fold: the first side's captures, then the second's.
  const combined = { ...data, ...(first ?? {}), ...(second ?? {}) };
  delete combined["first"];
  delete combined["second"];
  const unflattened = unflattenCombined(combined);
  const typeStr = strv(unflattened["type"]);
  const klass = (typeStr !== undefined ? TYPE_CLASS_MAP[typeStr] : undefined)
    ?? TypelessStandardClass;
  const identifier = new (klass as unknown as Ctor)();
  assignAttributes(identifier, unflattened);
  return identifier;
}

export function apiGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(apiGrammar, preprocessApi(input));
      return buildApiIdentifier(tree);
    },
  };
}
