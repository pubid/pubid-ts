import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import { PubidDate, Language, Iteration } from "../../model/component.js";
import { isoGrammar } from "./grammar.js";
import {
  IsoBundledIdentifier,
  IsoDirectives,
  IsoDirectivesSupplement,
  IsoEdition,
  IsoIdentifier,
  IsoPublisher,
  IsoSingleIdentifier,
  IsoSupplementIdentifier,
  IsoTcDocument,
  isoClassForType,
  locateStage,
  publishedStage,
  type TypedStageState,
} from "./model.js";

/**
 * Port of lib/pubid/iso/{builder,normalizer}.rb. Class dispatch follows
 * the Ruby Builder: joint → Combined (unreachable by the corpus),
 * supplements-bundle → BundledIdentifier, tc_type → TcDocument, else
 * locate_type(typed_stage.type_code) with the DIR/SUP special cases.
 */

const isObj = (v: Tree): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const s = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const str = Array.isArray(v) ? v.join("") : String(v);
  return str.length > 0 ? str : undefined;
};

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

// --- Normalizer (lib/pubid/iso/normalizer.rb) --------------------------------

const DAD_PATTERN = /^(.+?)\/(F?DAD)\s+(\d+)(?::(\d{4}))?$/;

const UPDATE_CODE_LINES: Record<string, string> = {
  "ISO/R 657/IV": "ISO/R 657-4:1969",
  "ISO/IEC/IEEE 8802-22.2:2015/Amd.2:2017(E)": "ISO/IEC/IEEE 8802-22:2015/Amd.2:2017(E)",
  "ISO/TR 17716.2": "ISO/TR 17716",
  "ISO/TR 17716.2(E)": "ISO/TR 17716(E)",
};

const UPDATE_CODE_REGEXES: [RegExp, string][] = [
  [/^(ISO[\w/]*) DIS (TR|TS|PAS|ISP) /, "$1 D$2 "],
  [/^(ISO[\w/]*) FDIS (TR|TS|PAS|ISP) /, "$1 FD$2 "],
  [/DIS Amd /, "DAM "],
  [/FDIS Amd /, "FDAM "],
  [/DIS Cor /, "DCOR "],
  [/FDIS Cor /, "FDCOR "],
  [/DIS Suppl /, "DSuppl "],
  [/DIS Add /, "DAD "],
];

const CYRILLIC_MAP: [string, string][] = [
  ["Руководства", "GUIDE"],
  ["Руководство", "GUIDE"],
  ["ИСО/МЭК", "ISO/IEC"],
  ["ИСО/ОПМС", "ISO/FDIS"],
  ["ИСО/ПМС", "ISO/DIS"],
  ["ИСО/ТО", "ISO/TR"],
  ["ИСО/ТС", "ISO/TS"],
  ["ИСО", "ISO"],
  ["МЭК", "IEC"],
  ["ТО", "TR"],
  ["ТС", "TS"],
  ["ОПМС", "FDIS"],
  ["ПМС", "DIS"],
];

function normalizeCyrillic(input: string): string {
  if (!/[а-яА-Я]/.test(input)) return input;
  let normalized = input.replace(/\s*#\s*.*$/, "");
  for (const [from, to] of CYRILLIC_MAP) {
    normalized = normalized.split(from).join(to);
  }
  return normalized.trim();
}

function applyUpdateCodes(input: string): string {
  const line = UPDATE_CODE_LINES[input];
  if (line !== undefined) return line;
  let out = input;
  for (const [pattern, replacement] of UPDATE_CODE_REGEXES) {
    // The Ruby table keys the supplement-position regexes with a "//"
    // prefix marking "after the first /"; apply those only past a slash.
    out = out.replace(pattern, replacement);
  }
  return out;
}

// --- Builder -------------------------------------------------------------------

function parseLanguages(raw: Tree): Language[] {
  const str = s(raw);
  if (str === undefined) return [];
  return str
    .split(",")
    .flatMap((chunk) => chunk.split("/"))
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((original) => {
      const code = original.length === 1 ? (Language.CHAR_MAP[original] ?? original.toLowerCase()) : original;
      return new Language({ code, originalCode: original });
    });
}

interface ParsedNumber {
  number: string | undefined;
  part: string | undefined;
  subpart: string | undefined;
  date: PubidDate | undefined;
}

/**
 * Builder#parse_number_with_part: em/en dashes, slashes and spaces
 * normalize to "-", then number[-part[-subpart]]; a 4-digit 1900-2099
 * part is a legacy year, not a part.
 */
function parseNumberWithPart(raw: string | undefined): ParsedNumber {
  const value = s(raw)?.replace(/[‑‐/]/g, "-").replace(/ /g, "-");
  if (value === undefined) return { number: undefined, part: undefined, subpart: undefined, date: undefined };
  const segments = value.split("-").filter((seg) => seg !== "");
  const [number, part, ...rest] = segments;
  const result: ParsedNumber = { number, part, subpart: rest.length > 0 ? rest.join("-") : undefined, date: undefined };
  if (part !== undefined && /^\d{4}$/.test(part)) {
    const yearValue = Number(part);
    if (yearValue >= 1900 && yearValue <= 2099 && rest.length === 0) {
      result.part = undefined;
      result.date = new PubidDate({ year: part });
    }
  }
  return result;
}

function parseDate(tree: Tree | undefined): PubidDate | undefined {
  if (tree === undefined || !isObj(tree)) return undefined;
  const flat = flatten(tree);
  const year = s(flat["year"]);
  if (year === undefined) return undefined;
  return new PubidDate({
    year,
    month: s(flat["month"]),
    day: s(flat["day"]),
  });
}

function parseEdition(raw: Tree | undefined): IsoEdition | undefined {
  const text = s(raw);
  if (text === undefined) return undefined;
  const number = /\d+/.exec(text)?.[0];
  return new IsoEdition({ ...(number !== undefined ? { number } : {}), original_text: text });
}

function typeStateFromToken(token: string | undefined, fallbackTypeKey: string): TypedStageState | undefined {
  const abbr = s(token);
  if (abbr === undefined) return undefined;
  const entry = locateStage(abbr);
  if (entry === undefined) return undefined;
  return { entry, originalAbbr: abbr };
}

class IsoBuilder {
  build(data: Tree): BaseIdentifier {
    const tree = flatten(data);
    if (tree["joint_identifier"] !== undefined) {
      // No corpus rows carry an IDF twin; fail rather than guess.
      throw new ParseFailed("ISO: joint IDF identifiers are not ported", 0);
    }
    if (tree["supplements"] !== undefined) return this.buildBundled(tree);
    if (tree["tc_type"] !== undefined) return this.buildTc(tree);
    return this.buildStandard(tree);
  }

  private publisherOf(tree: TreeObject): IsoPublisher | undefined {
    const primary = s(tree["publisher"]);
    const copubTree = tree["copublishers"];
    const copublishers: string[] = [];
    if (Array.isArray(copubTree)) {
      for (const entry of copubTree) {
        if (isObj(entry)) {
          const cp = s(entry["copublisher"]);
          if (cp !== undefined) copublishers.push(cp);
        }
      }
    } else if (copubTree !== undefined) {
      const cp = s(flatten(copubTree as Tree)["copublisher"]);
      if (cp !== undefined) copublishers.push(cp);
    }
    if (primary === undefined && copublishers.length === 0) return undefined;
    return new IsoPublisher({ publisher: primary ?? "ISO", copublisher: copublishers });
  }

  private baseAttrs(tree: TreeObject): Record<string, unknown> {
    const attrs: Record<string, unknown> = {};
    const numberWithPart = tree["number_with_part"] !== undefined ? flatten(tree["number_with_part"] as Tree) : {};
    const rawNumber = s(numberWithPart["number"]) ?? s(tree["number"]);
    const parsed = parseNumberWithPart(s(tree["number_with_part"]) ?? s(tree["number"]));
    if (parsed.number !== undefined || rawNumber !== undefined) {
      if (parsed.number !== undefined) attrs["number"] = parsed.number;
      if (parsed.part !== undefined) attrs["part"] = parsed.part;
      if (parsed.subpart !== undefined) attrs["subpart"] = parsed.subpart;
      if (parsed.date !== undefined) attrs["date"] = parsed.date;
    }
    const date = parseDate(tree["date"]) ?? parseDate(tree["base"] !== undefined ? undefined : undefined);
    if (tree["date"] !== undefined) {
      if (isObj(tree["date"])) {
        const flat = flatten(tree["date"] as Tree);
        const year = s(flat["year"]);
        if (year !== undefined) {
          attrs["date"] = new PubidDate({ year, month: s(flat["month"]), day: s(flat["day"]) });
        }
      } else {
        const dateStr = s(tree["date"]);
        if (dateStr !== undefined) {
          const [year, month, day] = dateStr.split("-");
          if (year !== undefined && year !== "") {
            attrs["date"] = new PubidDate({ year, month, day });
          }
        }
      }
    }
    if (tree["undated_marker"] !== undefined) {
      attrs["date"] = new PubidDate({ undated: true });
    }
    const edition = parseEdition(tree["edition"]);
    if (edition !== undefined) attrs["edition"] = edition;
    const languages = parseLanguages(tree["languages"]);
    if (languages.length > 0) attrs["languages"] = languages;
    if (tree["all_parts"] !== undefined) attrs["all_parts"] = true;
    if (tree["stage_iteration"] !== undefined) {
      attrs["stage_iteration"] = new Iteration({ string: s(tree["stage_iteration"]) });
    }
    return attrs;
  }

  private buildStandard(treeIn: TreeObject): BaseIdentifier {
    const tree = { ...treeIn };
    // Legacy ISO/R: publisher ISO + type "R".
    if (tree["iso_r_prefix"] !== undefined) {
      tree["publisher"] = "ISO";
      tree["type_with_stage"] = "R";
    }
    // NSB stage prefixes map onto typed stages.
    if (tree["nsb_stage"] !== undefined) {
      tree["type_with_stage"] = s(tree["nsb_stage"]) === "Fpr" ? "PRF" : "WD";
    }
    // French Guide/GUIDE prefix.
    if (tree["type_with_stage_fr"] !== undefined) {
      tree["type_with_stage"] = s(tree["type_with_stage_fr"]);
    }
    // Directive supplement without its own SUP keyword.
    if (tree["type_with_stage"] === undefined && tree["base"] !== undefined && isObj(tree["base"])) {
      const baseTree = flatten(tree["base"] as Tree);
      const dirTokens = new Set(["DIR", "Directives Part", "Directives, Part", "Directives,", "Directives"]);
      if (dirTokens.has(s(baseTree["type_with_stage"]) ?? "")) {
        tree["type_with_stage"] = "SUP";
      }
    }

    const state = typeStateFromToken(s(tree["type_with_stage"]), "is");
    const typeKey = state?.entry.typeCode ?? "is";

    if (typeKey === "dir-sup") return this.buildDirectivesSupplement(tree, state!);
    if (typeKey === "dir") return this.buildDirectives(tree, state ?? { entry: locateStage("DIR")!, originalAbbr: "DIR" });

    const klass = isoClassForType(typeKey);
    if (klass === undefined) {
      throw new ParseFailed(`ISO: unknown type key ${typeKey}`, 0);
    }

    const attrs = this.baseAttrs(tree);
    const publisher = this.publisherOf(tree);
    if (publisher !== undefined) attrs["publisher"] = publisher;
    if (state !== undefined) attrs["typedStageState"] = state;

    if ((tree["base"] !== undefined || klass.prototype instanceof IsoSupplementIdentifier) && tree["base"] !== undefined) {
      attrs["base"] = this.build(tree["base"] as Tree);
    }

    const identifier = new (klass as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
    return identifier;
  }

  private buildDirectives(tree: TreeObject, state: TypedStageState): BaseIdentifier {
    const attrs = this.baseAttrs(tree);
    const publisher = this.publisherOf(tree);
    if (publisher !== undefined) attrs["publisher"] = publisher;
    attrs["typedStageState"] = state;
    if (tree["subgroup"] !== undefined) attrs["subgroup"] = s(tree["subgroup"]);
    return new IsoDirectives(attrs);
  }

  private buildDirectivesSupplement(tree: TreeObject, state: TypedStageState): BaseIdentifier {
    const attrs = this.baseAttrs(tree);
    attrs["typedStageState"] = state;
    if (tree["publisher"] !== undefined) attrs["supplement_publisher"] = s(tree["publisher"]);
    if (tree["base"] !== undefined) attrs["base"] = this.build(tree["base"] as Tree);
    return new IsoDirectivesSupplement(attrs);
  }

  private buildTc(tree: TreeObject): BaseIdentifier {
    const attrs: Record<string, unknown> = {};
    const publisher = this.publisherOf(tree);
    if (publisher !== undefined) attrs["publisher"] = publisher;
    for (const key of ["tc_type", "tc_number", "sc_type", "sc_number", "wg_type", "wg_number", "number"] as const) {
      const value = s(tree[key]);
      if (value !== undefined) attrs[key] = value;
    }
    if (tree["year"] !== undefined) {
      attrs["date"] = new PubidDate({ year: s(tree["year"]) });
    }
    return new IsoTcDocument(attrs);
  }

  private buildBundled(tree: TreeObject): BaseIdentifier {
    const baseDocument = this.build(tree["base_document"] as Tree);
    const supplements = Array.isArray(tree["supplements"])
      ? (tree["supplements"] as Tree[]).map((entry) => this.build(flatten(entry as TreeObject)["supplement"] as Tree))
      : [];
    return new IsoBundledIdentifier({ base_document: baseDocument, supplements });
  }
}

// --- Entry points ----------------------------------------------------------------

function parseHuman(input: string): BaseIdentifier {
  const dad = DAD_PATTERN.exec(input);
  if (dad !== null) {
    // "ISO 2631/DAD 1[:1987]" — parsed manually; the grammar treats "/"
    // as a copublisher separator.
    const base = parseHuman(dad[1]!);
    const builder = new IsoBuilder();
    const attrs: Record<string, unknown> = {
      base,
      number: dad[3],
      typedStageState: { entry: locateStage(dad[2]!)!, originalAbbr: dad[2] },
    };
    if (dad[4] !== undefined) attrs["date"] = new PubidDate({ year: dad[4] });
    const klass = isoClassForType("add")!;
    return new (klass as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }
  const normalized = normalizeCyrillic(applyUpdateCodes(input));
  const tree = parseGrammar(isoGrammar, normalized);
  if (typeof tree !== "object" || tree === null) {
    throw new ParseFailed("ISO: unexpected parse tree", 0);
  }
  return new IsoBuilder().build(tree);
}

export function isoGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return parseHuman(input) as unknown as Identifier;
    },
  };
}
