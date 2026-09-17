import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/easc/ — EASC (Euro-Asian Council for
 * Standardization) interstate rules/recommendations. Cyrillic surface
 * forms ("ПМГ 03-2025", "РМГ 151-2025") with Latin transliterations
 * (PMG/RMG/V) accepted; series and variant normalize to Latin canonical
 * in the hash, the human form renders Cyrillic. The year separator
 * accepts hyphen, em-dash or en-dash with optional surrounding spaces.
 */

type EascSeries = "PMG" | "RMG";

const CYRILLIC_SERIES: Record<EascSeries, string> = {
  PMG: "ПМГ",
  RMG: "РМГ",
};

const SERIES_TYPES: Record<EascSeries, string> = {
  PMG: "pubid:easc:pmg",
  RMG: "pubid:easc:rmg",
};

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digits = match("[0-9]").repeat(1, Infinity);

  rule("space", () => space);
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
  rule("prefix", () => rules["series_word"]!.then(rules["variant_word"]!.maybe()));
  rule("number", () =>
    digits.then(str(".").then(digits).repeat(0, Infinity)).as("number"),
  );
  rule("year", () =>
    match("[0-9]").repeat(4, 4).or(match("[0-9]").repeat(2, 2)).as("year"),
  );
  rule("identifier", () =>
    rules["prefix"]!
      .then(rules["number"]!)
      .then(rules["year_sep"]!.then(rules["year"]!).maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const eascGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface EascIdentifier {
  kind: EascSeries;
  series: EascSeries;
  variant?: string;
  number: string;
  year?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildEascIdentifier(tree: Tree): EascIdentifier {
  if (!isObj(tree) || tree["series"] === undefined || tree["number"] === undefined) {
    throw new ParseFailed("EASC: unexpected parse tree", 0);
  }
  const seriesRaw = String(tree["series"]).toUpperCase();
  if (seriesRaw !== "ПМГ" && seriesRaw !== "PMG" && seriesRaw !== "РМГ" && seriesRaw !== "RMG") {
    throw new ParseFailed(`EASC: unknown series ${seriesRaw}`, 0);
  }
  const series: EascSeries = seriesRaw === "ПМГ" || seriesRaw === "PMG" ? "PMG" : "RMG";
  const id: EascIdentifier = { kind: series, series, number: String(tree["number"]) };
  if (tree["variant"] !== undefined && tree["variant"] !== null) {
    id.variant = "V";
  }
  if (tree["year"] !== undefined && tree["year"] !== null) {
    id.year = String(tree["year"]);
  }
  return id;
}

export function toHash(id: EascIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = {
    _type: SERIES_TYPES[id.series],
    series: id.series,
  };
  if (id.variant !== undefined) hash["variant"] = id.variant;
  hash["number"] = id.number;
  if (id.year !== undefined) hash["year"] = id.year;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): EascIdentifier {
  const series = String(hash["series"]) as EascSeries;
  if (series !== "PMG" && series !== "RMG") {
    throw new ParseFailed(`EASC: unknown series ${series}`, 0);
  }
  const id: EascIdentifier = { kind: series, series, number: String(hash["number"]) };
  if (hash["variant"] !== undefined && hash["variant"] !== null) {
    id.variant = String(hash["variant"]);
  }
  if (hash["year"] !== undefined && hash["year"] !== null) {
    id.year = String(hash["year"]);
  }
  return id;
}

export function toHuman(id: EascIdentifier): string {
  let result = CYRILLIC_SERIES[id.series];
  if (id.variant === "V") result += " В";
  result += ` ${id.number}`;
  if (id.year !== undefined) result += `-${id.year}`;
  return result;
}

export function toUrn(id: EascIdentifier): string {
  const parts = ["urn:easc", id.series.toLowerCase()];
  if (id.variant !== undefined) parts.push(id.variant.toLowerCase());
  parts.push(id.number);
  if (id.year !== undefined) parts.push(id.year);
  return parts.join(":");
}

class EascIdentifierImpl implements Identifier {
  constructor(private readonly id: EascIdentifier) {}
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
    return new EascIdentifierImpl(fromHash(hash));
  }
}

export function eascGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new EascIdentifierImpl(buildEascIdentifier(parseGrammar(eascGrammar, input)));
    },
  };
}
