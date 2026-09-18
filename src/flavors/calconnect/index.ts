import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";
import { PubidDate } from "../../model/component.js";

/**
 * Port of lib/pubid/calconnect/ on the unified model — the flavor that
 * motivated it. Shape: CC[/<series>] <number>[:<date>]. The publication
 * date is a PubidDate serialized FLAT as year/month/day through three
 * converter mappings (Ruby's `map "year", with: {to: :year_to_kv}` trio);
 * a partial (date-less) reference simply has no date attribute. URN:
 * urn:calconnect[:<series>]:<number>[:<full date>].
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const digits = match("[0-9]").repeat(1, Infinity);
  const series = match("[A-Za-z]").repeat(1, Infinity).as("series");

  rule("series", () => series);
  rule("number", () =>
    digits.then(str(".").or(str("-")).then(digits).maybe()).as("number"),
  );
  rule("date", () =>
    digits.as("year").then(
      str("-").then(digits.as("month"), str("-"), digits.as("day")).maybe(),
    ),
  );
  rule("identifier", () =>
    str("CC")
      .then(str("/").then(series).maybe())
      .then(str(" "), rules["number"]!)
      .then(str(":").then(rules["date"]!).maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const calconnectGrammar: Grammar = { rules: buildRules(), root: "root" };

class CalconnectUrnGenerator extends BaseUrnGenerator<CalconnectIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "calconnect"];
    if (id.series !== undefined) parts.push(id.series);
    parts.push(id.number);
    const date = id.date?.render();
    if (date !== undefined && date !== "") parts.push(date);
    return parts.join(":");
  }
}

export class CalconnectIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:calconnect:standard";
  static attributes = extendAttributes(BaseIdentifier, {
    series: { type: "string" },
    number: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "series", to: "series" },
    { wire: "number", to: "number" },
    {
      wire: "year",
      to: "date",
      toWire: (m) => (m["date"] as PubidDate | undefined)?.year,
      fromWire: (h) =>
        h["year"] === undefined || h["year"] === null
          ? undefined
          : new PubidDate({
              year: String(h["year"]),
              month: h["month"] as string | undefined,
              day: h["day"] as string | undefined,
            }),
    },
    { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
    { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
  );
  static urnGenerator = CalconnectUrnGenerator;

  declare readonly series: string | undefined;
  declare readonly number: string;
  declare readonly date: PubidDate | undefined;

  render(): string {
    const prefix = this.series === undefined ? "CC " : `CC/${this.series} `;
    const date = this.date?.render();
    return `${prefix}${this.number}${date === undefined || date === "" ? "" : `:${date}`}`;
  }
}
registerType(CalconnectIdentifier as unknown as IdentifierStatic);

class CalconnectBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return CalconnectIdentifier as unknown as IdentifierStatic;
  }

  protected cast(key: string, value: unknown): unknown {
    // The date needs year+month+day combined; assembled in build().
    if (key === "year" || key === "month" || key === "day") return null;
    return value;
  }

  build(data: Record<string, unknown> | Record<string, unknown>[]): BaseIdentifier {
    const flat = Array.isArray(data) ? Object.assign({}, ...data) : data;
    const attrs: Record<string, unknown> = {};
    if (flat["series"] !== undefined && flat["series"] !== null) attrs["series"] = String(flat["series"]);
    if (flat["number"] === undefined || flat["number"] === null) {
      throw new ParseFailed("CalConnect: no number", 0);
    }
    attrs["number"] = String(flat["number"]);
    if (flat["year"] !== undefined && flat["year"] !== null) {
      attrs["date"] = new PubidDate({
        year: String(flat["year"]),
        month: flat["month"] === undefined || flat["month"] === null ? undefined : String(flat["month"]),
        day: flat["day"] === undefined || flat["day"] === null ? undefined : String(flat["day"]),
      });
    }
    return new CalconnectIdentifier(attrs);
  }
}

export function calconnectGrammarImplementation(): FlavorImplementation {
  const builder = new CalconnectBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(calconnectGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("CalConnect: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
