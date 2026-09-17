import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/isbn/ — ISBN-10/ISBN-13 per ISO 2108. The grammar
 * accepts an optional "ISBN " / "ISBN:" / bare body, hyphenated or
 * contiguous; the builder validates length (10 with optional trailing X,
 * or 13 digits) and the ISO 2108 check digit, converting failures into
 * parse errors like the Ruby Builder. Hyphenation is preserved for
 * round-trip rendering; the URN is the bare namespace ("urn:isbn").
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

  rule("digit", () => digit);
  rule("x_digit", () => xDigit);
  rule("isbn_prefix", () =>
    str("ISBN")
      .then(space.or(space.maybe().then(colon, space.maybe())))
      .maybe(),
  );
  rule("digit_group", () => digitGroup);
  // Hyphenated body: digit groups joined by hyphens, final group may be
  // the single "X" check digit — or the contiguous 9-12 digit run with
  // optional trailing X.
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

export interface IsbnIdentifier {
  kind: "book";
  raw: string;
  hyphenated?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

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

export function buildIsbnIdentifier(tree: Tree): IsbnIdentifier {
  if (!isObj(tree) || tree["body"] === undefined || tree["body"] === null) {
    throw new ParseFailed("ISBN: unexpected parse tree", 0);
  }
  const hyphenatedInput = String(tree["body"]);
  const raw = hyphenatedInput.replaceAll("-", "");
  if (!VALID_LENGTH.test(raw)) {
    throw new ParseFailed(`ISBN must be 10 or 13 digits (got ${raw.length})`, 0);
  }
  if (!validCheckDigit(raw)) {
    throw new ParseFailed(`ISBN check digit invalid for ${raw}`, 0);
  }
  const id: IsbnIdentifier = { kind: "book", raw };
  if (hyphenatedInput.includes("-")) id.hyphenated = hyphenatedInput;
  return id;
}

export function toHash(id: IsbnIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = { _type: "pubid:isbn:book", raw: id.raw };
  if (id.hyphenated !== undefined) hash["hyphenated"] = id.hyphenated;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): IsbnIdentifier {
  if (hash["_type"] !== "pubid:isbn:book") {
    throw new ParseFailed(`ISBN: unknown _type ${String(hash["_type"])}`, 0);
  }
  const id: IsbnIdentifier = { kind: "book", raw: String(hash["raw"]) };
  if (hash["hyphenated"] !== undefined && hash["hyphenated"] !== null) {
    id.hyphenated = String(hash["hyphenated"]);
  }
  return id;
}

export function toHuman(id: IsbnIdentifier): string {
  return `ISBN ${id.hyphenated ?? id.raw}`;
}

// The Ruby flavor has no urn_generator, so the base generator emits the
// bare namespace for every ISBN.
export function toUrn(_id: IsbnIdentifier): string {
  return "urn:isbn";
}

class IsbnIdentifierImpl implements Identifier {
  constructor(private readonly id: IsbnIdentifier) {}
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
    return new IsbnIdentifierImpl(fromHash(hash));
  }
}

export function isbnGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new IsbnIdentifierImpl(buildIsbnIdentifier(parseGrammar(isbnGrammar, input)));
    },
  };
}
