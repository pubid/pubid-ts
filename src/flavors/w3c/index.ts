import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/w3c/. Flat identifiers: "W3C [TYPE-]slug[-date]".
 * The grammar only splits the leading maturity token; the code/date
 * boundary is resolved in the builder (a PEG `code` rule would greedily
 * eat the trailing date). A trailing "-<digits>" group is the date only
 * when the run is exactly 8/6/4 digits wide — no real W3C slug ends in
 * such a run (e.g. "url-1", "ATAG10" never mis-split).
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

// Printed token -> kind. Order matters for shared prefixes: DNOTE before
// NOTE, CRD before CR, PER before PR (mirrors the Ruby type_token rule).
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
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const [first, ...others] = TOKEN_KINDS;
  const typeToken = others.reduce<P>((acc, [token]) => acc.or(str(token)), str(first![0]));
  rule("prefix", () => str("W3C").then(str(" ")));
  rule("type_token", () => typeToken);
  // A leading token is only a type when immediately followed by "-".
  rule("type_part", () => typeToken.as("type").then(str("-")));
  rule("rest", () => match("[\\s\\S]").repeat(1, Infinity).as("rest"));
  rule("identifier", () =>
    rules["prefix"]!
      .then(rules["type_part"]!.maybe())
      .then(rules["rest"]!),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const w3cGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface W3cIdentifier {
  kind: W3cKind;
  number: string;
  date?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const DATE_RE = /^(.+)-(\d{8}|\d{6}|\d{4})$/;

export function buildW3cIdentifier(tree: Tree): W3cIdentifier {
  if (!isObj(tree) || tree["rest"] === undefined || tree["rest"] === null) {
    throw new ParseFailed("W3C: unexpected parse tree", 0);
  }
  const rest = String(tree["rest"]);
  const dateMatch = DATE_RE.exec(rest);
  const id: W3cIdentifier = {
    kind: kindForToken(tree["type"] === undefined || tree["type"] === null ? undefined : String(tree["type"])),
    number: dateMatch ? dateMatch[1]! : rest,
  };
  if (dateMatch) id.date = dateMatch[2]!;
  return id;
}

function kindForToken(token: string | undefined): W3cKind {
  if (token === undefined) return "standard";
  const entry = TOKEN_KINDS.find(([t]) => t === token);
  if (!entry) throw new ParseFailed(`W3C: unknown type token ${token}`, 0);
  return entry[1];
}

function kindForType(type: string): W3cKind {
  const kind = type.slice("pubid:w3c:".length) as W3cKind;
  if (!(W3C_KINDS as readonly string[]).includes(kind)) {
    throw new ParseFailed(`W3C: unknown _type ${type}`, 0);
  }
  return kind;
}

export function toHash(id: W3cIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = { _type: `pubid:w3c:${id.kind}`, number: id.number };
  if (id.date !== undefined) hash["date"] = id.date;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): W3cIdentifier {
  const id: W3cIdentifier = {
    kind: kindForType(String(hash["_type"])),
    number: String(hash["number"]),
  };
  if (hash["date"] !== undefined && hash["date"] !== null) {
    id.date = String(hash["date"]);
  }
  return id;
}

export function toHuman(id: W3cIdentifier): string {
  const token = KIND_TOKENS[id.kind];
  let body = token ? `${token}-` : "";
  body += id.number;
  if (id.date !== undefined) body += `-${id.date}`;
  return `W3C ${body}`;
}

export function toUrn(id: W3cIdentifier): string {
  const parts = ["urn", "w3c"];
  const token = KIND_TOKENS[id.kind];
  if (token) parts.push(token.toLowerCase());
  parts.push(id.number);
  if (id.date !== undefined) parts.push(id.date);
  return parts.join(":");
}

class W3cIdentifierImpl implements Identifier {
  constructor(private readonly id: W3cIdentifier) {}
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
    return new W3cIdentifierImpl(fromHash(hash));
  }
}

export function w3cGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new W3cIdentifierImpl(buildW3cIdentifier(parseGrammar(w3cGrammar, input)));
    },
  };
}
