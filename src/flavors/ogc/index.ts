import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/ogc/. OGC document numbers "<yy>-<nnn>[<revision>]"
 * ("24-032r1", "04-095c1"). The printed form carries no publisher token;
 * an optional leading "OGC " is accepted leniently and dropped. Everything
 * is kept as a string to preserve zero-padding; the revision suffix is
 * normalized to lower case ("R1" -> "r1").
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = match("[\\s]").repeat(1, Infinity);
  const digits = match("[0-9]").repeat(1, Infinity);
  // The numeric part greedily consumes all digits, so a revision suffix
  // always begins with its separator letter.
  const revision = match("[A-Za-z0-9]").repeat(1, Infinity).as("revision");

  rule("space", () => space);
  rule("digits", () => digits);
  rule("publisher", () => str("OGC").then(space).maybe());
  rule("revision", () => revision);
  rule("identifier", () =>
    rules["publisher"]!
      .then(digits.as("year"), str("-"), digits.as("number"))
      .then(revision.maybe())
      .then(space.maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ogcGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface OgcIdentifier {
  kind: "document";
  year: string;
  number: string;
  revision?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildOgcIdentifier(tree: Tree): OgcIdentifier {
  if (
    !isObj(tree) ||
    tree["year"] === undefined ||
    tree["year"] === null ||
    tree["number"] === undefined ||
    tree["number"] === null
  ) {
    throw new ParseFailed("OGC: unexpected parse tree", 0);
  }
  const id: OgcIdentifier = {
    kind: "document",
    year: String(tree["year"]),
    number: String(tree["number"]),
  };
  const revision = tree["revision"];
  if (revision !== undefined && revision !== null) {
    const normalized = String(revision).trim().toLowerCase();
    if (normalized !== "") id.revision = normalized;
  }
  return id;
}

export function toHash(id: OgcIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = {
    _type: "pubid:ogc:document",
    year: id.year,
    number: id.number,
  };
  if (id.revision !== undefined) hash["revision"] = id.revision;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): OgcIdentifier {
  if (hash["_type"] !== "pubid:ogc:document") {
    throw new ParseFailed(`OGC: unknown _type ${String(hash["_type"])}`, 0);
  }
  const id: OgcIdentifier = {
    kind: "document",
    year: String(hash["year"]),
    number: String(hash["number"]),
  };
  if (hash["revision"] !== undefined && hash["revision"] !== null) {
    id.revision = String(hash["revision"]);
  }
  return id;
}

export function toHuman(id: OgcIdentifier): string {
  let result = `${id.year}-${id.number}`;
  if (id.revision !== undefined) result += id.revision;
  return result;
}

export function toUrn(id: OgcIdentifier): string {
  const parts = ["urn", "ogc", id.year, id.number];
  if (id.revision !== undefined) parts.push(id.revision);
  return parts.join(":");
}

class OgcIdentifierImpl implements Identifier {
  constructor(private readonly id: OgcIdentifier) {}
  toHash(): Record<string, unknown> {
    return toHash(this.id);
  }
  toHuman(): string {
    return toHuman(this.id);
  }
  toUrn(): string | undefined {
    return toUrn(this.id);
  }
  fromHash(hash: Record<string, unknown>): Identifier {
    return new OgcIdentifierImpl(fromHash(hash));
  }
}

export function ogcGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new OgcIdentifierImpl(buildOgcIdentifier(parseGrammar(ogcGrammar, input)));
    },
  };
}
