import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/xsf/ — the whole flavor in one file. XSF has a
 * single concrete type ("XEP 0001" and the two named documents), so the
 * model is a scalar `number` and every surface is a direct port:
 * parser.rb -> grammar, builder.rb -> build, renderer.rb -> toHuman,
 * urn_generator.rb -> toUrn, identifier.rb's key_value map -> toHash.
 */

// SPECIAL_NUMBERS: the editor README and the xep-xxxx template reach
// pubid as real primary docids ("XEP README", "XEP xxxx").
const SPECIAL_NUMBERS = ["README", "xxxx"];

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const specialNumber = SPECIAL_NUMBERS.map((name) => str(name)).reduce((a, b) => a.or(b));
  rule("special_number", () => specialNumber);
  // Ruby used match["0-9"] (bracket form = character class). The engine's
  // match(x) is parslet's paren form (a full regex), so wrap explicitly.
  const digits = match("[0-9]").repeat(1);
  rule("digits", () => digits);
  rule("identifier", () =>
    str("XEP").then(str(" "), digits.or(specialNumber).as("number")),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const xsfGrammar: Grammar = {
  rules: buildRules(),
  root: "root",
};

export interface XsfIdentifier {
  kind: "xep";
  number: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildXsfIdentifier(tree: Tree): XsfIdentifier {
  if (!isObj(tree) || tree["number"] === undefined || tree["number"] === null) {
    throw new ParseFailed("XSF: unexpected parse tree", 0);
  }
  return { kind: "xep", number: String(tree["number"]) };
}

export function toHash(id: XsfIdentifier): Record<string, unknown> {
  return { _type: "pubid:xsf:xep", number: id.number };
}

export function fromHash(hash: Record<string, unknown>): XsfIdentifier {
  return { kind: "xep", number: String(hash["number"]) };
}

export function toHuman(id: XsfIdentifier): string {
  return `XEP ${id.number}`;
}

export function toUrn(id: XsfIdentifier): string {
  return ["urn", "xsf", "xep", id.number].join(":");
}

class XsfIdentifierImpl implements Identifier {
  constructor(private readonly id: XsfIdentifier) {}
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
    return new XsfIdentifierImpl(fromHash(hash));
  }
}

export function xsfGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new XsfIdentifierImpl(buildXsfIdentifier(parseGrammar(xsfGrammar, input)));
    },
  };
}
