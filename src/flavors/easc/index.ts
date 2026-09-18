import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/easc/ on the unified model. Cyrillic surface
 * forms ("ПМГ 03-2025") with Latin transliterations; series/variant
 * normalize to Latin canonical in the hash, the human form renders
 * Cyrillic. Hyphen/em-dash/en-dash year separators with optional spaces.
 */

type EascSeries = "PMG" | "RMG";

const CYRILLIC_SERIES: Record<EascSeries, string> = { PMG: "ПМГ", RMG: "РМГ" };

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digits = match("[0-9]").repeat(1, Infinity);

  rule(
    "year_sep",
    () =>
      space
        .maybe()
        .then(str("-").or(str("—")).or(str("–")))
        .then(space.maybe()),
  );
  rule(
    "series_word",
    () =>
      str("ПМГ")
        .or(str("РМГ"))
        .or(str("PMG"))
        .or(str("RMG"))
        .as("series")
        .then(space),
  );
  rule("variant_word", () => str("В").or(str("V")).as("variant").then(space));
  rule("number", () =>
    digits.then(str(".").then(digits).repeat(0, Infinity)).as("number"),
  );
  rule("year", () =>
    match("[0-9]").repeat(4, 4).or(match("[0-9]").repeat(2, 2)).as("year"),
  );
  rule("identifier", () =>
    rules["series_word"]!
      .then(rules["variant_word"]!.maybe())
      .then(rules["number"]!)
      .then(rules["year_sep"]!.then(rules["year"]!).maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const eascGrammar: Grammar = { rules: buildRules(), root: "root" };

function eascClass(series: EascSeries): IdentifierStatic {
  class EascSeriesIdentifier extends BaseIdentifier {
    static polymorphicName = `pubid:easc:${series.toLowerCase()}`;
    static attributes = extendAttributes(BaseIdentifier, {
      series: { type: "string" },
      variant: { type: "string" },
      number: { type: "string" },
      year: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "series", to: "series" },
      { wire: "variant", to: "variant" },
      { wire: "number", to: "number" },
      { wire: "year", to: "year" },
    );

    declare readonly series: EascSeries;
    declare readonly variant: string | undefined;
    declare readonly number: string;
    declare readonly year: string | undefined;

    render(): string {
      let result = CYRILLIC_SERIES[series];
      if (this.variant === "V") result += " В";
      result += ` ${this.number}`;
      if (this.year !== undefined) result += `-${this.year}`;
      return result;
    }
  }
  class EascUrnGenerator extends BaseUrnGenerator<EascSeriesIdentifier> {
    generate(): string {
      const parts = ["urn", "easc", this.identifier.series.toLowerCase()];
      if (this.identifier.variant !== undefined) parts.push(this.identifier.variant.toLowerCase());
      parts.push(this.identifier.number);
      if (this.identifier.year !== undefined) parts.push(this.identifier.year);
      return parts.join(":");
    }
  }
  (EascSeriesIdentifier as unknown as Record<string, unknown>).urnGenerator = EascUrnGenerator;
  registerType(EascSeriesIdentifier as unknown as IdentifierStatic);
  return EascSeriesIdentifier as unknown as IdentifierStatic;
}

const SERIES_CLASSES: Record<EascSeries, IdentifierStatic> = {
  PMG: eascClass("PMG"),
  RMG: eascClass("RMG"),
};

class EascBuilder extends BaseBuilder {
  protected selectClass(data: Record<string, unknown>): IdentifierStatic {
    const raw = String(data["series"]).toUpperCase();
    if (raw !== "ПМГ" && raw !== "PMG" && raw !== "РМГ" && raw !== "RMG") {
      throw new ParseFailed(`EASC: unknown series ${raw}`, 0);
    }
    return SERIES_CLASSES[raw === "ПМГ" || raw === "PMG" ? "PMG" : "RMG"];
  }

  protected defaultIdentifierClass(): IdentifierStatic {
    return SERIES_CLASSES["PMG"];
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "series") {
      const raw = String(value).toUpperCase();
      return { series: raw === "ПМГ" || raw === "PMG" ? "PMG" : "RMG" };
    }
    if (key === "variant") return { variant: "V" };
    return value;
  }
}

export function eascGrammarImplementation(): FlavorImplementation {
  const builder = new EascBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(eascGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("EASC: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
