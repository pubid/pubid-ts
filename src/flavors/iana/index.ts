import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/iana/ — registry slugs. The parser accepts the
 * printed "IANA <slug>[/<sub-slug>]" and the bare index-key slug; the
 * renderer always re-emits the prefix. The top-level slug is stored as
 * `number` (the relaton-index key); `sub_registry` is optional.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  // Ruby: match['a-zA-Z0-9._\-'] (bracket form = character class)
  const slug = match("[a-zA-Z0-9._\\-]").repeat(1, Infinity);
  rule("slug", () => slug);
  rule("iana_prefix", () => str("IANA").then(str(" ")).maybe());
  rule("identifier", () =>
    rules["iana_prefix"]!
      .then(slug.as("registry"), str("/").then(slug.as("sub_registry")).maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ianaGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface IanaIdentifier {
  kind: "registry";
  number: string; // top-level slug
  subRegistry?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildIanaIdentifier(tree: Tree): IanaIdentifier {
  if (!isObj(tree) || tree["registry"] === undefined) {
    throw new ParseFailed("IANA: unexpected parse tree", 0);
  }
  const id: IanaIdentifier = {
    kind: "registry",
    number: String(tree["registry"]),
  };
  if (tree["sub_registry"] !== undefined && tree["sub_registry"] !== null) {
    id.subRegistry = String(tree["sub_registry"]);
  }
  return id;
}

export function toHash(id: IanaIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = {
    _type: "pubid:iana:registry",
    number: id.number,
  };
  if (id.subRegistry) hash["sub_registry"] = id.subRegistry;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): IanaIdentifier {
  const id: IanaIdentifier = {
    kind: "registry",
    number: String(hash["number"]),
  };
  if (hash["sub_registry"] !== undefined && hash["sub_registry"] !== null) {
    id.subRegistry = String(hash["sub_registry"]);
  }
  return id;
}

export function toHuman(id: IanaIdentifier): string {
  return id.subRegistry
    ? `IANA ${id.number}/${id.subRegistry}`
    : `IANA ${id.number}`;
}

export function toUrn(id: IanaIdentifier): string {
  const parts = ["urn", "iana", id.number];
  if (id.subRegistry) parts.push(id.subRegistry);
  return parts.join(":");
}

class IanaIdentifierImpl implements Identifier {
  constructor(private readonly id: IanaIdentifier) {}
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
    return new IanaIdentifierImpl(fromHash(hash));
  }
}

export function ianaGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new IanaIdentifierImpl(buildIanaIdentifier(parseGrammar(ianaGrammar, input)));
    },
  };
}
