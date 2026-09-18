import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";
import { Publisher, Language } from "../../model/component.js";

/**
 * 1:1 port of lib/pubid/ansi/ on the unified model. Copublishers
 * (controlled vocabulary) rewrite the URN namespace; the dash segment
 * serializes as `part` (Ruby Builder split-on-dash), the ":YYYY" form as
 * `year`; "Std" is consumed and dropped; languages round-trip.
 */

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

  rule("copublishers", () =>
    str("/")
      .then(
        spaceQ,
        ORGANIZATIONS.reduce<P>((acc, org) => acc.or(str(org)), str(ORGANIZATIONS[0])).as("copublisher"),
      )
      .repeat(1, Infinity)
      .as("copublishers"),
  );
  rule("std_keyword", () => str("Std").then(space).maybe());
  rule(
    "number_with_part",
    () =>
      match("[A-Z]")
        .repeat(1, Infinity)
        .then(digits, str(".").then(digits).repeat(0, 3), match("[A-Z]").maybe(), dashDigits)
        .or(
          digits.then(
            str(".").then(digits, match("[a-z]").maybe()).repeat(0, 2),
            dashDigits,
          ),
        )
        .as("number_with_part"),
  );
  rule("year_digits", () =>
    str("19").or(str("20")).then(match("\\d").repeat(2, 2), digits.absent()),
  );
  rule("date", () => str(":").then(rules["year_digits"]!.as("date")));
  rule("language", () =>
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
      str("ANSI")
        .as("publisher")
        .then(rules["copublishers"]!, space, rules["std_keyword"]!)
        .then(rules["number_with_part"]!)
        .then(rules["date"]!.maybe())
        .then(rules["language"]!.maybe()),
  );
  rule(
    "identifier_sole",
    () =>
      str("ANSI")
        .as("publisher")
        .then(space, rules["std_keyword"]!, rules["number_with_part"]!)
        .then(rules["date"]!.maybe())
        .then(rules["language"]!.maybe()),
  );
  rule("identifier", () =>
    rules["identifier_with_copublishers"]!.or(rules["identifier_sole"]!),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ansiGrammar: Grammar = { rules: buildRules(), root: "root" };

class AnsiUrnGenerator extends BaseUrnGenerator<AnsiIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "ansi", id.number];
    if (id.part !== undefined) parts.push(`-${id.part}`);
    if (id.year !== undefined) parts.push(id.year);
    if (id.copublishers.length > 0) {
      parts[1] = ["ansi", ...id.copublishers.map((c) => c.body.toLowerCase())].join("-");
    }
    if (id.languages.length > 0) {
      parts.push(id.languages.map((l) => l.code).join(","));
    }
    return parts.join(":");
  }
}

export class AnsiIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:ansi:standard";
  static attributes = extendAttributes(BaseIdentifier, {
    number: { type: "string" },
    part: { type: "string" },
    year: { type: "string" },
    copublishers: { type: Publisher, collection: true, initializeEmpty: true },
    languages: { type: Language, collection: true, initializeEmpty: true },
  });
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "part", to: "part" },
    { wire: "year", to: "year" },
    { wire: "publisher", to: "publisher" },
    { wire: "copublishers", to: "copublishers" },
    { wire: "languages", to: "languages" },
  );
  static urnGenerator = AnsiUrnGenerator;

  declare readonly number: string;
  declare readonly part: string | undefined;
  declare readonly year: string | undefined;
  declare readonly publisher: Publisher;
  declare readonly copublishers: Publisher[];
  declare readonly languages: Language[];

  render(): string {
    const publisherPortion =
      this.copublishers.length > 0
        ? [this.publisher.body, ...this.copublishers.map((p) => p.body)].join("/")
        : this.publisher.body;
    let numberPortion = this.number;
    if (this.part !== undefined) numberPortion += `-${this.part}`;
    if (this.year !== undefined) numberPortion += `:${this.year}`;
    let result = `${publisherPortion} ${numberPortion}`;
    if (this.languages.length > 0) result += `(${this.languages.map((l) => l.code).join(",")})`;
    return result;
  }
}
registerType(AnsiIdentifier as unknown as IdentifierStatic);

function extractCopublishers(raw: Tree): Publisher[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((p) => {
    const body = typeof p === "object" && p !== null && "copublisher" in (p as object)
      ? String((p as TreeObject)["copublisher"])
      : String(p);
    return new Publisher({ body });
  });
}

class AnsiBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return AnsiIdentifier as unknown as IdentifierStatic;
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "number_with_part") {
      // Ruby Builder: split on "-", first segment = number, second = part.
      const segments = String(value).split("-");
      return segments[1] === undefined ? { number: segments[0] } : { number: segments[0], part: segments[1] };
    }
    if (key === "publisher") {
      return { publisher: new Publisher({ body: String(value) }) };
    }
    if (key === "copublishers") {
      return { copublishers: extractCopublishers(value as Tree) };
    }
    if (key === "date") {
      return { year: String(value) };
    }
    if (key === "languages") {
      return { languages: this.parseLanguages(value) };
    }
    return value;
  }
}

export function ansiGrammarImplementation(): FlavorImplementation {
  const builder = new AnsiBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(ansiGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("ANSI: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
