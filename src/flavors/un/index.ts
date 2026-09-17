import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/un/ — UN document symbols ("A/RES/78/1"). Slash-
 * separated tokens; the LAST is the number, a 4-digit token in the path
 * is the date year. The URN falls through to the base generator shape:
 * urn:un:<number>[:<year>].
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const slash = str("/");
  const token = match("[A-Z0-9.]").repeat(1, Infinity);
  rule("slash", () => slash);
  rule("token", () => token);
  rule("un_prefix", () => str("UN").then(str(" ")).maybe());
  rule("identifier", () =>
    rules["un_prefix"]!
      .then(
        token.as("token"),
        slash.then(token.as("token")).repeat(1, Infinity),
      ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const unGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface UnIdentifier {
  kind: "document";
  path: string[];
  number: string;
  year?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractTokens(tree: TreeObject): string[] {
  const raw = tree["token"];
  if (Array.isArray(raw)) {
    return raw.map((t) => (isObj(t) && t["token"] !== undefined ? String(t["token"]) : String(t)));
  }
  if (raw !== undefined && raw !== null) return [String(raw)];
  return [];
}

export function buildUnIdentifier(tree: Tree): UnIdentifier {
  // Ruby's tree is an ARRAY (sequence of captures + repeat-of-captures
  // combine into one array) — extract_tokens handles both shapes.
  const tokens = Array.isArray(tree)
    ? tree.map((t) => (isObj(t) && t["token"] !== undefined ? String(t["token"]) : String(t)))
    : isObj(tree)
      ? extractTokens(tree)
      : [];
  if (tokens.length === 0) throw new ParseFailed("UN identifier has no tokens", 0);

  const number = tokens[tokens.length - 1]!;
  const path = tokens.slice(0, -1);
  const id: UnIdentifier = { kind: "document", path, number };
  const yearToken = [...path].reverse().find((t) => /^\d{4}$/.test(t));
  if (yearToken) id.year = yearToken;
  return id;
}

export function toHash(id: UnIdentifier): Record<string, unknown> {
  // The Ruby key_value maps only _type/path/number — the date built from
  // the year token is runtime-only (never serialized); the URN reads it.
  return {
    _type: "pubid:un:document",
    path: id.path,
    number: id.number,
  };
}

export function fromHash(hash: Record<string, unknown>): UnIdentifier {
  const path = (hash["path"] as string[]) ?? [];
  const id: UnIdentifier = {
    kind: "document",
    path,
    number: String(hash["number"]),
  };
  const yearToken = [...path].reverse().find((t) => /^\d{4}$/.test(t));
  if (yearToken) id.year = yearToken;
  return id;
}

export function toHuman(id: UnIdentifier): string {
  return [...id.path, id.number].join("/");
}

export function toUrn(id: UnIdentifier): string {
  const parts = ["urn", "un", id.number];
  if (id.year) parts.push(id.year);
  return parts.join(":");
}

class UnIdentifierImpl implements Identifier {
  constructor(private readonly id: UnIdentifier) {}
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
    return new UnIdentifierImpl(fromHash(hash));
  }
}

export function unGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new UnIdentifierImpl(buildUnIdentifier(parseGrammar(unGrammar, input)));
    },
  };
}
