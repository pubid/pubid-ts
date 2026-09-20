import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { amcaGrammar, preprocessAmca } from "./grammar.js";
import { InterpretationClass, PublicationClass, StandardClass } from "./model.js";
import type { IdentifierStatic } from "../../model/identifier.js";

/**
 * Port of lib/pubid/amca/builder.rb — dispatch plus the flat
 * attribute extraction.
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

function extractAttributes(parsed: Record<string, unknown>): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  if (parsed["copublisher"] !== undefined) {
    attributes["copublisher"] = strv(parsed["copublisher"]);
  }
  if (parsed["code"] !== undefined) {
    attributes["number"] = strv(parsed["code"]);
  }
  if (attributes["year"] === undefined && parsed["year"] !== undefined) {
    attributes["year"] = strv(parsed["year"]);
  }
  if (parsed["suffix"] !== undefined) {
    attributes["suffix"] = strv(parsed["suffix"]);
  }
  if (parsed["reaffirmed"] !== undefined) {
    attributes["reaffirmed"] = strv(parsed["reaffirmed"]);
  }
  return attributes;
}

export function buildAmcaIdentifier(tree: Tree): Identifier {
  const root = flatten(tree) as Record<string, unknown>;

  if (root["publication"] !== undefined || root["publication_keyword"] !== undefined || root["revision"] !== undefined) {
    const parsed = (isObj(root["publication"]) ? root["publication"] : root) as Record<string, unknown>;
    const attributes = extractAttributes(parsed);
    if (parsed["revision"] !== undefined) {
      attributes["revision"] = strv(parsed["revision"]);
    }
    return new (PublicationClass as unknown as Ctor)(attributes);
  }

  if (root["interpretation"] !== undefined || root["interpretation_code"] !== undefined || root["interp_keyword"] !== undefined) {
    const parsed = (isObj(root["interpretation"]) ? root["interpretation"] : root) as Record<string, unknown>;
    const attributes = extractAttributes(parsed);
    if (parsed["interpretation_code"] !== undefined) {
      attributes["interpretation_code"] = strv(parsed["interpretation_code"]);
    }
    if (attributes["year"] === undefined && parsed["interpretation_year"] !== undefined) {
      attributes["year"] = strv(parsed["interpretation_year"]);
    }
    return new (InterpretationClass as unknown as Ctor)(attributes);
  }

  if (root["standard"] !== undefined) {
    return new (StandardClass as unknown as Ctor)(
      extractAttributes(root["standard"] as Record<string, unknown>),
    );
  }

  return new (StandardClass as unknown as Ctor)(extractAttributes(root));
}

export function amcaGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(amcaGrammar, preprocessAmca(input));
      return buildAmcaIdentifier(tree);
    },
  };
}
