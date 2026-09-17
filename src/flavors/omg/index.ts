import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/omg/. "OMG {ACRONYM}[ {VERSION}[ {/ | }PART]]".
 * ACRONYM is the URL segment of omg.org/spec/<ACRONYM>/ kept verbatim
 * ("EDMC-FIBO/BE", "VSIPL++", "smartant"). A bare "beta2" after the
 * version is a PART, not the beta label (the beta word boundary forces
 * the split); the URN is the base-generator shape: part becomes the
 * "-<part>" segment, everything else is dropped ("urn:omg" alone for a
 * part-less spec).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const acronymChar = match("[A-Za-z0-9+]");
  const wordBoundary = match("[A-Za-z0-9]").absent();
  // Digits with optional dots, optionally followed by " beta" and an
  // optional beta number. Both halves of the label end at a word boundary
  // so the version never eats the front of a document part.
  const beta = str(" beta").then(
    wordBoundary,
    space.then(match("[0-9]").repeat(1, Infinity), wordBoundary).maybe(),
  );
  const partSeparator = space.or(str("/"));

  rule("space", () => space);
  rule("acronym_char", () => acronymChar);
  rule(
    "acronym",
    () =>
      match("[A-Za-z]")
        .then(
          acronymChar.repeat(0, Infinity),
          match("[-/]")
            .then(acronymChar.repeat(1, Infinity))
            .repeat(0, Infinity),
        )
        .as("acronym"),
  );
  rule(
    "version",
    () =>
      match("[0-9]")
        .repeat(1, Infinity)
        .then(
          str(".").then(match("[0-9]").repeat(1, Infinity)).repeat(0, Infinity),
          beta.maybe(),
        )
        .as("version"),
  );
  rule("part", () => match("[A-Za-z0-9]").repeat(1, Infinity).as("part"));
  rule("identifier", () =>
    str("OMG").then(
      space,
      rules["acronym"]!,
      space
        .then(rules["version"]!, partSeparator.then(rules["part"]!).maybe())
        .or(space.then(rules["part"]!))
        .maybe(),
    ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const omgGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface OmgIdentifier {
  kind: "specification";
  acronym: string;
  version?: string;
  part?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildOmgIdentifier(tree: Tree): OmgIdentifier {
  if (!isObj(tree) || tree["acronym"] === undefined || tree["acronym"] === null) {
    throw new ParseFailed("OMG: unexpected parse tree", 0);
  }
  const id: OmgIdentifier = { kind: "specification", acronym: String(tree["acronym"]) };
  if (tree["version"] !== undefined && tree["version"] !== null) {
    id.version = String(tree["version"]);
  }
  if (tree["part"] !== undefined && tree["part"] !== null) {
    id.part = String(tree["part"]);
  }
  return id;
}

export function toHash(id: OmgIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = { _type: "pubid:omg:specification", acronym: id.acronym };
  if (id.version !== undefined) hash["version"] = id.version;
  if (id.part !== undefined) hash["part"] = id.part;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): OmgIdentifier {
  if (hash["_type"] !== "pubid:omg:specification") {
    throw new ParseFailed(`OMG: unknown _type ${String(hash["_type"])}`, 0);
  }
  const id: OmgIdentifier = { kind: "specification", acronym: String(hash["acronym"]) };
  if (hash["version"] !== undefined && hash["version"] !== null) {
    id.version = String(hash["version"]);
  }
  if (hash["part"] !== undefined && hash["part"] !== null) {
    id.part = String(hash["part"]);
  }
  return id;
}

export function toHuman(id: OmgIdentifier): string {
  let result = `OMG ${id.acronym}`;
  if (id.version !== undefined) result += ` ${id.version}`;
  if (id.part !== undefined) result += ` ${id.part}`;
  return result;
}

// The Ruby flavor has no urn_generator, so the base generator runs: only
// `part` maps onto a template slot (the "-<part>" part segment), yielding
// "urn:omg:-PDF" for a spec with a part and bare "urn:omg" without one.
export function toUrn(id: OmgIdentifier): string {
  return id.part === undefined ? "urn:omg" : `urn:omg:-${id.part}`;
}

class OmgIdentifierImpl implements Identifier {
  constructor(private readonly id: OmgIdentifier) {}
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
    return new OmgIdentifierImpl(fromHash(hash));
  }
}

export function omgGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new OmgIdentifierImpl(buildOmgIdentifier(parseGrammar(omgGrammar, input)));
    },
  };
}
