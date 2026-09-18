import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/isbn/ on the unified model. ISBN-10/13 per ISO
 * 2108; the builder validates length and the ISO 2108 check digit and
 * surfaces failures as parse errors (Ruby Builder parity). The Ruby
 * flavor has no urn_generator → the base template emits "urn:isbn".
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const colon = str(":");
  const hyphen = str("-");
  const digit = match("[0-9]");
  const xDigit = digit.or(str("X"));
  const digitGroup = digit.repeat(1, Infinity);

  rule("isbn_prefix", () =>
    str("ISBN")
      .then(space.or(space.maybe().then(colon, space.maybe())))
      .maybe(),
  );
  rule("isbn_body", () =>
    digitGroup
      .then(hyphen.then(digitGroup).repeat(0, Infinity))
      .then(hyphen.then(xDigit).maybe())
      .as("body")
      .or(digit.repeat(9, 12).then(xDigit.maybe()).as("body")),
  );
  rule("identifier", () => rules["isbn_prefix"]!.then(rules["isbn_body"]!));
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const isbnGrammar: Grammar = { rules: buildRules(), root: "root" };

export class IsbnIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:isbn:book";
  static attributes = extendAttributes(BaseIdentifier, {
    raw: { type: "string" },
    hyphenated: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "raw", to: "raw" },
    { wire: "hyphenated", to: "hyphenated" },
  );

  declare readonly raw: string;
  declare readonly hyphenated: string | undefined;

  render(): string {
    return `ISBN ${this.hyphenated ?? this.raw}`;
  }
}
registerType(IsbnIdentifier as unknown as IdentifierStatic);

const VALID_LENGTH = /^(?:\d{9}[\dX]|\d{13})$/;

function validCheckDigit(full: string): boolean {
  // ISBN-10: weights 10..1 mod 11, 10 renders as "X".
  // ISBN-13: alternating weights 1/3 mod 10.
  const digits = full.toUpperCase().replace(/[^0-9X]/g, "");
  if (digits.length === 10) {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
    const computed = (11 - (sum % 11)) % 11;
    return (computed === 10 ? "X" : String(computed)) === digits[9];
  }
  if (digits.length === 13) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (sum % 10)) % 10) === digits[12];
  }
  return false;
}

class IsbnBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return IsbnIdentifier as unknown as IdentifierStatic;
  }

  protected cast(key: string, value: unknown): unknown {
    if (key !== "body") return value;
    const hyphenatedInput = String(value);
    const raw = hyphenatedInput.replaceAll("-", "");
    if (!VALID_LENGTH.test(raw)) {
      throw new ParseFailed(`ISBN must be 10 or 13 digits (got ${raw.length})`, 0);
    }
    if (!validCheckDigit(raw)) {
      throw new ParseFailed(`ISBN check digit invalid for ${raw}`, 0);
    }
    return hyphenatedInput.includes("-") ? { raw, hyphenated: hyphenatedInput } : { raw };
  }
}

export function isbnGrammarImplementation(): FlavorImplementation {
  const builder = new IsbnBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(isbnGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("ISBN: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
