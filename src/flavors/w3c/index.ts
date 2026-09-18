import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/w3c/ on the unified model. "W3C [TYPE-]slug[-date]";
 * the grammar splits only the maturity token, the builder applies the
 * fixed-width trailing-date split (8/6/4 digits — slugs like "url-1" or
 * "DSIG-label-971024.html" never mis-split). Eleven kinds, one per W3C
 * maturity level; `date` is a plain string in Ruby (never a PubidDate).
 */

const W3C_KINDS = [
  "standard",
  "note",
  "draft-note",
  "working-draft",
  "candidate-recommendation",
  "candidate-recommendation-draft",
  "recommendation",
  "proposed-recommendation",
  "proposed-edited-recommendation",
  "superseded-recommendation",
  "obsolete-recommendation",
] as const;

export type W3cKind = (typeof W3C_KINDS)[number];

// Printed token -> kind; DNOTE before NOTE, CRD before CR, PER before PR.
const TOKEN_KINDS: [token: string, kind: W3cKind][] = [
  ["DNOTE", "draft-note"],
  ["NOTE", "note"],
  ["WD", "working-draft"],
  ["CRD", "candidate-recommendation-draft"],
  ["CR", "candidate-recommendation"],
  ["REC", "recommendation"],
  ["PER", "proposed-edited-recommendation"],
  ["PR", "proposed-recommendation"],
  ["SPSD", "superseded-recommendation"],
  ["OBSL", "obsolete-recommendation"],
];

const KIND_TOKENS: Record<W3cKind, string | undefined> = {
  standard: undefined,
  note: "NOTE",
  "draft-note": "DNOTE",
  "working-draft": "WD",
  "candidate-recommendation": "CR",
  "candidate-recommendation-draft": "CRD",
  recommendation: "REC",
  "proposed-recommendation": "PR",
  "proposed-edited-recommendation": "PER",
  "superseded-recommendation": "SPSD",
  "obsolete-recommendation": "OBSL",
};

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const [first, ...others] = TOKEN_KINDS;
  const typeToken = others.reduce<P>((acc, [token]) => acc.or(str(token)), str(first![0]));
  ruleInit(rules, "prefix", () => str("W3C").then(str(" ")));
  // A leading token is only a type when immediately followed by "-".
  ruleInit(rules, "type_part", () => typeToken.as("type").then(str("-")));
  ruleInit(rules, "rest", () => match("[\\s\\S]").repeat(1, Infinity).as("rest"));
  ruleInit(rules, "identifier", () =>
    rules["prefix"]!
      .then(rules["type_part"]!.maybe())
      .then(rules["rest"]!),
  );
  ruleInit(rules, "root", () => rules["identifier"]!);
  return rules;
}

function ruleInit(rules: Record<string, P>, name: string, build: () => P) {
  rules[name] = build();
}

export const w3cGrammar: Grammar = { rules: buildRules(), root: "root" };

const KIND_CLASSES: Record<W3cKind, IdentifierStatic> = {} as Record<W3cKind, IdentifierStatic>;

function w3cClass(kind: W3cKind): IdentifierStatic {
  const token = KIND_TOKENS[kind];
  class W3cKindIdentifier extends BaseIdentifier {
    static polymorphicName = `pubid:w3c:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, {
      number: { type: "string" },
      date: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "date", to: "date" },
    );

    declare readonly number: string;
    declare readonly date: string | undefined;

    render(): string {
      let body = token === undefined ? "" : `${token}-`;
      body += this.number;
      if (this.date !== undefined) body += `-${this.date}`;
      return `W3C ${body}`;
    }
  }
  registerType(W3cKindIdentifier as unknown as IdentifierStatic);
  return W3cKindIdentifier as unknown as IdentifierStatic;
}

for (const kind of W3C_KINDS) {
  KIND_CLASSES[kind] = w3cClass(kind);
}

class W3cUrnGenerator extends BaseUrnGenerator {
  generate(): string {
    const id = this.identifier as unknown as { number: string; date?: string };
    const kind = (this.identifier.constructor.polymorphicName.slice("pubid:w3c:".length)) as W3cKind;
    const parts = ["urn", "w3c"];
    const token = KIND_TOKENS[kind];
    if (token !== undefined) parts.push(token.toLowerCase());
    parts.push(id.number);
    if (id.date !== undefined) parts.push(id.date);
    return parts.join(":");
  }
}
for (const kind of W3C_KINDS) {
  (KIND_CLASSES[kind] as unknown as { urnGenerator?: unknown }).urnGenerator = W3cUrnGenerator;
}

const DATE_RE = /^(.+)-(\d{8}|\d{6}|\d{4})$/;

function kindForToken(token: string | undefined): W3cKind {
  if (token === undefined) return "standard";
  const entry = TOKEN_KINDS.find(([t]) => t === token);
  if (!entry) throw new ParseFailed(`W3C: unknown type token ${token}`, 0);
  return entry[1];
}

class W3cBuilder extends BaseBuilder {
  protected selectClass(data: Record<string, unknown>): IdentifierStatic {
    const type = data["type"];
    return KIND_CLASSES[kindForToken(type === undefined || type === null ? undefined : String(type))];
  }

  protected defaultIdentifierClass(): IdentifierStatic {
    return KIND_CLASSES["standard"];
  }

  protected cast(key: string, value: unknown): unknown {
    if (key !== "rest") return value;
    const rest = String(value);
    const m = DATE_RE.exec(rest);
    return m ? { number: m[1], date: m[2] } : { number: rest };
  }
}

export function w3cGrammarImplementation(): FlavorImplementation {
  const builder = new W3cBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(w3cGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("W3C: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
