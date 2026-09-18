import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/ansi/. Forms:
 *   ANSI X3.4-1986            (sole publisher, dash segment)
 *   ANSI/IEEE Std 1-1986      (copublishers, optional Std keyword)
 *   ANSI/ISO 9899:1990        (colon date form)
 * The dash segment serializes as `part` (often a year); the ":YYYY" form
 * serializes as `year`. "Std" is consumed and dropped. Copublishers
 * rewrite the URN namespace ("urn:ansi-asme:…"); URN parts carry their
 * own dash ("urn:ansi:802.3:-2012"). Languages render "(en,fr)".
 */

// Copublisher vocabulary, Ruby order: ISO IEC IEEE SAE ASME ASTM.
const ORGANIZATIONS = ["ISO", "IEC", "IEEE", "SAE", "ASME", "ASTM"] as const;

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const spaceQ = space.maybe();
  const digits = match("[0-9]").repeat(1, Infinity);
  const dashDigits = str("-").then(digits).maybe();

  rule("publisher", () => str("ANSI").as("publisher"));
  rule(
    "copublishers",
    () =>
      str("/")
        .then(
          spaceQ,
          ORGANIZATIONS.reduce<P>(
            (acc, org) => acc.or(str(org)),
            str(ORGANIZATIONS[0]),
          ).as("copublisher"),
        )
        .repeat(1, Infinity)
        .as("copublishers"),
  );
  rule("std_keyword", () => str("Std").then(space).maybe());
  rule(
    "number_with_part",
    () =>
      // Letter prefix with up to 3 additional dot-separated parts and an
      // optional letter suffix (C37.06.1, N323A, N42.49A)…
      match("[A-Z]")
        .repeat(1, Infinity)
        .then(
          digits,
          str(".").then(digits).repeat(0, 3),
          match("[A-Z]").maybe(),
          dashDigits,
        )
        // …or bare digits with dots and an optional lowercase letter
        // (9899, 802.3-2012, 802.1b-1995).
        .or(
          digits.then(
            str(".").then(digits, match("[a-z]").maybe()).repeat(0, 2),
            dashDigits,
          ),
        )
        .as("number_with_part"),
  );
  // CommonParseRules year_digits: 19xx/20xx not followed by another digit.
  rule("year_digits", () =>
    str("19").or(str("20")).then(match("\\d").repeat(2, 2), digits.absent()),
  );
  rule("date", () => str(":").then(rules["year_digits"]!.as("date")));
  rule(
    "language",
    () =>
      str("(")
        .then(
          match("[a-z]")
            .repeat(2, Infinity)
            .then(str(",").maybe())
            .repeat(0, Infinity)
            .as("languages"),
          str(")"),
        ),
  );
  rule(
    "identifier_with_copublishers",
    () =>
      rules["publisher"]!
        .then(rules["copublishers"]!, space, rules["std_keyword"]!)
        .then(rules["number_with_part"]!)
        .then(rules["date"]!.maybe())
        .then(rules["language"]!.maybe()),
  );
  rule(
    "identifier_sole",
    () =>
      rules["publisher"]!
        .then(space, rules["std_keyword"]!, rules["number_with_part"]!)
        .then(rules["date"]!.maybe())
        .then(rules["language"]!.maybe()),
  );
  rule(
    "identifier",
    () =>
      rules["identifier_with_copublishers"]!.or(rules["identifier_sole"]!),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ansiGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface AnsiIdentifier {
  kind: "standard";
  number: string;
  part?: string;
  year?: string;
  copublishers?: string[];
  languages?: string[];
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractCopublishers(raw: Tree): string[] {
  if (Array.isArray(raw)) {
    return raw.map((p) => (isObj(p) ? String(p["copublisher"]) : String(p)));
  }
  if (isObj(raw) && raw["copublisher"] !== undefined) {
    return [String(raw["copublisher"])];
  }
  return [];
}

export function buildAnsiIdentifier(tree: Tree): AnsiIdentifier {
  if (!isObj(tree) || tree["publisher"] === undefined || tree["number_with_part"] === undefined) {
    throw new ParseFailed("ANSI: unexpected parse tree", 0);
  }
  // Ruby Builder: split on "-", first segment = number, second = part.
  const segments = String(tree["number_with_part"]).split("-");
  const id: AnsiIdentifier = { kind: "standard", number: segments[0]! };
  if (segments[1] !== undefined) id.part = segments[1];
  if (tree["copublishers"] !== undefined && tree["copublishers"] !== null) {
    id.copublishers = extractCopublishers(tree["copublishers"]);
  }
  if (tree["date"] !== undefined && tree["date"] !== null) {
    id.year = String(tree["date"]);
  }
  if (tree["languages"] !== undefined && tree["languages"] !== null) {
    id.languages = String(tree["languages"])
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l !== "");
  }
  return id;
}

export function toHash(id: AnsiIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = {
    _type: "pubid:ansi:standard",
    number: id.number,
  };
  if (id.part !== undefined) hash["part"] = id.part;
  if (id.year !== undefined) hash["year"] = id.year;
  hash["publisher"] = { body: "ANSI" };
  if (id.copublishers !== undefined && id.copublishers.length > 0) {
    hash["copublishers"] = id.copublishers.map((c) => ({ body: c }));
  }
  if (id.languages !== undefined && id.languages.length > 0) {
    hash["languages"] = id.languages.map((code) => ({ code }));
  }
  return hash;
}

export function fromHash(hash: Record<string, unknown>): AnsiIdentifier {
  if (hash["_type"] !== "pubid:ansi:standard") {
    throw new ParseFailed(`ANSI: unknown _type ${String(hash["_type"])}`, 0);
  }
  const id: AnsiIdentifier = { kind: "standard", number: String(hash["number"]) };
  if (hash["part"] !== undefined && hash["part"] !== null) {
    id.part = String(hash["part"]);
  }
  if (hash["year"] !== undefined && hash["year"] !== null) {
    id.year = String(hash["year"]);
  }
  const copubs = hash["copublishers"];
  if (Array.isArray(copubs)) {
    id.copublishers = copubs.map((c) =>
      String((c as TreeObject)["body"]),
    );
  }
  const langs = hash["languages"];
  if (Array.isArray(langs)) {
    id.languages = langs.map((l) => String((l as TreeObject)["code"]));
  }
  return id;
}

export function toHuman(id: AnsiIdentifier): string {
  const publisherPortion =
    id.copublishers && id.copublishers.length > 0
      ? ["ANSI", ...id.copublishers].join("/")
      : "ANSI";
  let numberPortion = id.number;
  if (id.part !== undefined) numberPortion += `-${id.part}`;
  if (id.year !== undefined) numberPortion += `:${id.year}`;
  let result = `${publisherPortion} ${numberPortion}`;
  if (id.languages && id.languages.length > 0) {
    result += `(${id.languages.join(",")})`;
  }
  return result;
}

export function toUrn(id: AnsiIdentifier): string {
  const parts = ["urn", "ansi", id.number];
  if (id.part !== undefined) parts.push(`-${id.part}`);
  if (id.year !== undefined) parts.push(id.year);
  if (id.copublishers && id.copublishers.length > 0) {
    parts[1] = ["ansi", ...id.copublishers.map((c) => c.toLowerCase())].join("-");
  }
  if (id.languages && id.languages.length > 0) {
    parts.push(id.languages.join(","));
  }
  return parts.join(":");
}

class AnsiIdentifierImpl implements Identifier {
  constructor(private readonly id: AnsiIdentifier) {}
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
    return new AnsiIdentifierImpl(fromHash(hash));
  }
}

export function ansiGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new AnsiIdentifierImpl(buildAnsiIdentifier(parseGrammar(ansiGrammar, input)));
    },
  };
}
