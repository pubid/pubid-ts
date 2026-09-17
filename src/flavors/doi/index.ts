import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/doi/ — DOIs per ISO 26324. Accepts
 * [doi:|DOI:]10.xxxx/suffix and the https://doi.org/ resolver form; the
 * canonical human form is "doi:PREFIX/SUFFIX". The URN is the bare
 * namespace (the Ruby flavor has no urn_generator, so the base emits
 * "urn:doi" for every DOI).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const slash = str("/");
  rule("url_prefix", () =>
    str("https://").or(str("http://")).maybe().then(str("doi.org").maybe()),
  );
  rule("scheme_prefix", () =>
    str("doi:").or(str("DOI:")).or(str("Doi:")).maybe(),
  );
  const dot = str(".");
  rule("prefix", () => str("10").then(dot, match("[0-9]").repeat(2, Infinity).as("prefix")));
  rule("suffix", () =>
    match("[A-Za-z0-9._\\-/()]").repeat(1, Infinity).as("suffix"),
  );
  rule("identifier", () =>
    rules["url_prefix"]!
      .maybe()
      .then(
        rules["scheme_prefix"]!.maybe(),
        slash.maybe(),
        rules["prefix"]!,
        slash,
        rules["suffix"]!,
      ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const doiGrammar: Grammar = {
  rules: buildRules(),
  root: "root",
};

export interface DoiIdentifier {
  kind: "resource";
  prefix: string; // "10." + registrar code
  suffix: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildDoiIdentifier(tree: Tree): DoiIdentifier {
  if (!isObj(tree) || tree["prefix"] === undefined || tree["suffix"] === undefined) {
    throw new ParseFailed("DOI: unexpected parse tree", 0);
  }
  return {
    kind: "resource",
    prefix: `10.${String(tree["prefix"])}`,
    suffix: String(tree["suffix"]),
  };
}

export function toHash(id: DoiIdentifier): Record<string, unknown> {
  return { _type: "pubid:doi:resource", prefix: id.prefix, suffix: id.suffix };
}

export function fromHash(hash: Record<string, unknown>): DoiIdentifier {
  return {
    kind: "resource",
    prefix: String(hash["prefix"]),
    suffix: String(hash["suffix"]),
  };
}

export function toHuman(id: DoiIdentifier): string {
  return `doi:${id.prefix}/${id.suffix}`;
}

export function toUrn(_id: DoiIdentifier): string {
  return "urn:doi";
}

class DoiIdentifierImpl implements Identifier {
  constructor(private readonly id: DoiIdentifier) {}
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
    return new DoiIdentifierImpl(fromHash(hash));
  }
}

export function doiGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new DoiIdentifierImpl(buildDoiIdentifier(parseGrammar(doiGrammar, input)));
    },
  };
}
