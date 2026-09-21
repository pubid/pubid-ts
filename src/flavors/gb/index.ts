import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseBuilder } from "../../model/builder.js";
import { PubidDate, Publisher } from "../../model/component.js";

/**
 * Port of lib/pubid/gb/ on the unified model. The series code lives in
 * the inherited `publisher` (a Publisher, flattened to its body scalar
 * via the class's flat-scalar entry — the CEN precedent); mandate is
 * split out of an inline /T|/Z; date flattens to `year` (shared rule).
 * No Ruby urn_generator: the BASE template derives
 * urn:gb:<publisher>:<number>[:-part][:year] with the publisher
 * lowercased.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digits = match("[0-9]").repeat(1, Infinity);

  rule(
    "publisher_code",
    () =>
      // Social-group form: "T/" then uppercase letters/digits.
      (str("T/").then(match("[A-Z0-9]").repeat(1, Infinity))).as("publisher_code")
        // Confidential national series: lowercase "n" is part of the code
        // (PEG: before the uppercase-only branch, no backtracking).
        .or(
          (str("GBn").then(str("/T").or(str("/Z")).maybe())).as("publisher_code"),
        )
        // Standard form: 1-3 letters, optional slash-T-or-Z.
        .or(
          (match("[A-Z]")
            .repeat(1, 3)
            .then(str("/T").or(str("/Z")).maybe()).as("publisher_code")),
        ),
  );
  rule("mandate_suffix", () =>
    str("/").then(str("T").or(str("Z")).as("mandate")).maybe(),
  );
  rule("number", () => digits.as("number"));
  rule("part", () => str(".").then(digits.as("part")));
  rule("year", () => str("-").or(str("—")).then(match("[0-9]").repeat(4, 4).as("year")).maybe());
  rule("all_parts_flag", () =>
    space.then(str("("), str("all parts"), str(")")).as("all_parts"),
  );
  rule("identifier", () =>
    rules["publisher_code"]!
      .then(space)
      .then(rules["mandate_suffix"]!)
      .then(rules["number"]!)
      .then(rules["part"]!.maybe())
      .then(rules["year"]!)
      .then(rules["all_parts_flag"]!.maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const gbGrammar: Grammar = { rules: buildRules(), root: "root" };

export class GbIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:gb:standard";
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: Publisher },
    mandate: { type: "string" },
    number: { type: "string" },
    part: { type: "string" },
  });
  static mappings = keyValue(
    {
      wire: "publisher",
      to: "publisher",
      // The flat wire form is the Publisher's body scalar; rebuild the
      // component on deserialize (lutaml coerces it on the Ruby side).
      fromWire: (hash) => {
        const value = hash["publisher"];
        return typeof value === "string" ? new Publisher({ body: value }) : value;
      },
    },
    { wire: "mandate", to: "mandate" },
    { wire: "number", to: "number" },
    { wire: "part", to: "part" },
    { wire: "date", to: "date" },
  );
  // GB's flat-scalar entry: the Publisher serializes as its body scalar.
  static flatScalarComponents = { publisher: "publisher" };
  static flatScalarFields = { publisher: "body" };

  declare readonly publisher: Publisher;
  declare readonly mandate: string | undefined;
  declare readonly number: string;
  declare readonly part: string | undefined;
  declare readonly date: PubidDate | undefined;

  render(): string {
    let code = this.publisher.body;
    if (this.mandate !== undefined && !code.includes("/")) code += `/${this.mandate}`;
    let numberPortion = this.number;
    if (this.part !== undefined) numberPortion += `.${this.part}`;
    if (this.date !== undefined && this.date.year !== undefined) numberPortion += `-${this.date.year}`;
    return `${code} ${numberPortion}`;
  }
}
registerType(GbIdentifier as unknown as IdentifierStatic);

// The document a member names: without its part and its edition (the
// attributes an all-parts reference ignores).
function gbDocumentOf(member: GbIdentifier): GbIdentifier {
  const r = member as unknown as Record<string, unknown>;
  return new GbIdentifier({
    publisher: r["publisher"],
    mandate: r["mandate"],
    number: r["number"],
  });
}

// "GB/T 5606 (all parts)" names every part of one document: the wrapper
// holds the member identifiers (gem #433 - the mark is a class, not a
// flag), renders the document plus the suffix, and URNs as the document.
export class GbAllPartsIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:gb:all-parts";
  static get attributes() {
    return extendAttributes(BaseIdentifier, {
      identifiers: { type: GbIdentifier as unknown as IdentifierStatic, collection: true },
    });
  }
  static get mappings() {
    return [{ wire: "identifiers", to: "identifiers" } as never];
  }

  declare readonly identifiers: GbIdentifier[];

  render(): string {
    const first = this.identifiers[0];
    return `${first === undefined ? "" : gbDocumentOf(first).render()} (all parts)`;
  }

  toUrn(): string {
    const first = this.identifiers[0];
    return gbDocumentOf(first!).toUrn();
  }
}
registerType(GbAllPartsIdentifier as unknown as IdentifierStatic);

class GbBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return GbIdentifier as unknown as IdentifierStatic;
  }

  build(tree: Record<string, unknown>): BaseIdentifier {
    const id = super.build(tree);
    if (tree["all_parts"] === undefined) return id;
    // "(all parts)" wraps the document it parsed.
    return new GbAllPartsIdentifier({
      identifiers: [id as GbIdentifier],
    }) as unknown as BaseIdentifier;
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "publisher_code") {
      // Split an inline /T or /Z mandate out of the code.
      const code = String(value);
      const m = /^(.*?)\/(T|Z)$/.exec(code);
      return m
        ? { publisher: new Publisher({ body: m[1] }), mandate: m[2] }
        : { publisher: new Publisher({ body: code }) };
    }
    if (key === "year") {
      return value === undefined || value === null ? null : { date: new PubidDate({ year: String(value) }) };
    }
    if (key === "all_parts") {
      // Presence marker only: the wrapper carries the members.
      return value;
    }
    return value;
  }
}

export function gbGrammarImplementation(): FlavorImplementation {
  const builder = new GbBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(gbGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("GB: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
