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
import { ISO_TYPED_STAGES, type IsoTypedStage } from "./stages.generated.js";

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
    // Bare TC reference (pubid-iso#285): tc_type is absent by
    // construction; sc_type is the route's required segment and cannot
    // appear on a standard identifier. Canonicalizes the publisher to ISO.
    if (tree["tc_type"] === undefined && tree["sc_type"] !== undefined && tree["tc_number"] !== undefined) {
      tree["tc_type"] = "TC";
      return this.buildTc(tree);
    }
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
    // The explicit URN type token pins the class: a stage's abbreviation
    // can overwrite type_with_stage with an IS-only stage ("WDA" for
    // 90.93), and the document must stay a TR/TS (the Ruby builder reads
    // the same document_type hint).
    const documentType = s(tree["document_type"]);
    const typeKey = documentType !== undefined
      ? documentType.toLowerCase()
      : state?.entry.typeCode ?? "is";

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

// --- URN ingestion (lib/pubid/iso/urn_parser.rb) ----------------------------

// RFC 5141-bis typed-stage abbreviations → stage codes. "DIS"/"ADIS" are
// ISO ladder stages the reference maps; everything else mirrors the gem's
// TYPED_STAGE_REVERSE_MAP verbatim.
const URN_STAGE_ABBRS: Record<string, string> = {
  WD: "wd", WDS: "wds", CD: "cd", CDV: "cdv", DIS: "dis", FDIS: "fdis",
  PDAM: "pdam", DAM: "dam", FDAM: "fdamd", DCOR: "dcor", FDCOR: "fdcor",
  CDTS: "cdts", DTS: "dts", FDTS: "fdts",
};
const URN_TYPE_TOKENS = new Set([
  "tr", "ts", "pas", "guide", "dir", "dir-sup", "iwa-sup", "isp", "iwa", "r", "data",
]);
const URN_SUPP_TYPES = new Set(["amd", "cor", "sup", "add"]);
// The URN type tokens are the gem's type keys; the ts leaf for ISO/R is
// keyed "rec".
const URN_TYPE_KEYS: Record<string, string> = { r: "rec" };

function urnStageByHarmonized(code: string): IsoTypedStage | undefined {
  const candidates = ISO_TYPED_STAGES.filter((s) => s.harmonized?.includes(code));
  // The gem prefers the IS family when a code is shared across families
  // (pubid#570 — the registry order is load-order dependent there).
  return candidates.find((s) => s.typeCode === "is") ?? candidates[0];
}

// When the URN gives a harmonized code and no type token, the document is
// an IS: prefer the non-published IS stages (PRF over the published IS for
// 60.00), then the stage covering the most codes (WD over WDS).
function urnIsStageByHarmonized(code: string): IsoTypedStage | undefined {
  const candidates = ISO_TYPED_STAGES.filter(
    (s) => s.typeCode === "is" && s.harmonized?.includes(code),
  );
  if (candidates.length === 0) return undefined;
  const nonPublished = candidates.filter((s) => s.stageCode !== "published");
  const pool = nonPublished.length > 0 ? nonPublished : candidates;
  let best = pool[0]!;
  for (const candidate of pool) {
    if ((candidate.harmonized?.length ?? 0) > (best.harmonized?.length ?? 0)) best = candidate;
  }
  return best;
}

// The URN carries parts as "10164:-5-1-1" or "9001-1"; split into
// number / part / subpart (a subpart keeps its dashes).
function parseUrnNumberPart(
  raw: string | undefined,
): [string | undefined, string | undefined, string | undefined] {
  if (raw === undefined) return [undefined, undefined, undefined];
  if (/^\w+:-/.test(raw)) {
    const segments = raw.split(":-");
    const tail = segments.slice(1).join("-").split("-");
    return [
      segments[0],
      tail[0],
      tail.length > 1 ? tail.slice(1).join("-") : undefined,
    ];
  }
  if (raw.includes("-")) {
    const segments = raw.split("-");
    return [
      segments[0],
      segments[1],
      segments.length > 2 ? segments.slice(2).join("-") : undefined,
    ];
  }
  return [raw, undefined, undefined];
}

interface UrnSupplement {
  stage?: string | undefined;
  type?: string | undefined;
  number?: string | undefined;
  version?: string | undefined;
  year?: string | undefined;
  languages?: string | undefined;
}

function parseIsoUrn(urn: string): BaseIdentifier {
  if (!urn.startsWith("urn:iso:std:")) throw new Error(`Invalid ISO URN: ${urn}`);
  let parts = urn.slice("urn:iso:std:".length).split(":");

  // A trailing "ser" marks an all-parts identifier.
  let allParts = false;
  if (parts[parts.length - 1] === "ser") {
    parts = parts.slice(0, -1);
    allParts = true;
  }

  const publishers = (parts.shift() ?? "").split("-").map((p) => p.toUpperCase());

  let typeCode: string | undefined;
  if (parts[0] !== undefined && URN_TYPE_TOKENS.has(parts[0].toLowerCase())) {
    typeCode = parts.shift()!.toLowerCase();
  }

  // RFC 5141 requires docnumber -- "urn:iso:std:iso" is not a valid
  // NSS, and building it silently produced the identity-free "ISO "
  // (mirrors lib/pubid/iso/urn_parser.rb)
  if (parts.length === 0) throw new Error(`missing docnumber: ${urn}`);

  let [number, part, subpart] = parseUrnNumberPart(parts.shift());

  let year: string | undefined;
  if (/^\d{4}$/.test(parts[0] ?? "")) year = parts.shift();

  // URN-style part notation can trail the year (":10164:2019:-22").
  if ((parts[0] ?? "").startsWith("-")) {
    const partStr = parts.shift()!;
    [number, part, subpart] = parseUrnNumberPart(`${number}${partStr}`);
  }
  if (year === undefined && /^\d{4}$/.test(parts[0] ?? "")) year = parts.shift();

  let edition: string | undefined;
  if ((parts[0] ?? "").startsWith("ed-")) edition = parts.shift()!.slice(3);

  let languages: string | undefined;
  if (
    parts[0] !== undefined && !/^\d+$/.test(parts[0]) &&
    !/^(amd|cor|sup|add|v\d+|stage-|ed-)/i.test(parts[0]) &&
    !(parts[0].toUpperCase() in URN_STAGE_ABBRS) &&
    !/^[A-Za-z]+\.\d+$/.test(parts[0])
  ) {
    languages = parts.shift()!.split(",").map((l) => l.toUpperCase()).join("/");
  }

  // Stage: either "stage-XX.XX[.vN]" (harmonized) or a typed abbreviation
  // ("WD", "CD.2").
  let stageCode: string | undefined;
  let stageFromAbbr: string | undefined;
  let stageIteration: string | undefined;
  if ((parts[0] ?? "").startsWith("stage-")) {
    const stageStr = parts.shift()!;
    stageCode = stageStr.slice(6).replace(/\.v\d+$/i, "");
    const iteration = /\.v(\d+)$/i.exec(stageStr);
    if (iteration !== null) stageIteration = iteration[1];
  } else if (
    (parts[0] !== undefined && parts[0].toUpperCase() in URN_STAGE_ABBRS) ||
    (parts[0] !== undefined && /^[A-Za-z]+\.\d+$/.test(parts[0]) &&
      (parts[0].toUpperCase().split(".")[0] ?? "") in URN_STAGE_ABBRS)
  ) {
    const stageAbbr = parts[0]!.toUpperCase();
    // A supplement-family stage directly before its own supplement type
    // token ("...:FDAM:amd:1:v1") names the SUPPLEMENT's stage: consuming
    // it as the base's stage builds the base as a base-less supplement,
    // which cannot render (the gem guards the same way).
    const family = locateStage(stageAbbr.split(".")[0] ?? "")?.typeCode;
    const supplementFollows = (family !== undefined &&
      ["amd", "cor", "suppl", "add"].includes(family)) &&
      parts.slice(1).some((token) => URN_SUPP_TYPES.has(token.toLowerCase()) &&
        (URN_TYPE_KEYS[token.toLowerCase()] ?? token.toLowerCase()) === family);
    if (!supplementFollows) {
      parts.shift();
      if (stageAbbr.includes(".")) {
        const abbrPart = stageAbbr.split(".")[0]!;
        const iterationPart = stageAbbr.split(".")[1]!;
        stageCode = URN_STAGE_ABBRS[abbrPart]!;
        stageFromAbbr = abbrPart;
        stageIteration = iterationPart;
      } else {
        stageCode = URN_STAGE_ABBRS[stageAbbr]!;
        stageFromAbbr = stageAbbr;
      }
    }
  }

  // Supplements (amd, cor, sup, add), left-to-right: each wraps the previous.
  const supplements: UrnSupplement[] = [];
  while (parts.length > 0) {
    const supp: UrnSupplement = {};
    if ((parts[0] ?? "").startsWith("stage-")) {
      supp.stage = parts.shift()!.slice(6).replace(/\.v\d+$/i, "");
    } else if (parts[0] !== undefined && parts[0].toUpperCase() in URN_STAGE_ABBRS) {
      supp.stage = URN_STAGE_ABBRS[parts.shift()!.toUpperCase()]!;
    }
    if (parts[0] !== undefined && URN_SUPP_TYPES.has(parts[0].toLowerCase())) {
      supp.type = parts.shift()!.toLowerCase();
    }
    if (/^\d+$/.test(parts[0] ?? "")) {
      if (/^\d{4}$/.test(parts[0]!)) supp.year = parts.shift();
      else supp.number = parts.shift();
    }
    // The legacy year-overloaded wire ("amd:2007:v2" -- the number rode
    // the version slot): a v-token with no preceding number carries the
    // NUMBER. The RFC 5141-bis order ("amd:1:2007:v2") keeps the number
    // in its own slot, so a v-token after a number is the true
    // <supplversion>.
    const consumeV = () => {
      if ((parts[0] ?? "").startsWith("v")) {
        const value = parts.shift()!.slice(1).split(".")[0]!;
        if (supp.number === undefined) supp.number = value;
        else supp.version = value;
      }
    };
    consumeV();
    if (supp.year === undefined && /^\d{4}$/.test(parts[0] ?? "")) supp.year = parts.shift();
    // a v-token after the year would otherwise start a type-less wrap
    consumeV();
    if (
      parts[0] !== undefined && !/^\d+$/.test(parts[0]) &&
      !/^(amd|cor|sup|add|v\d+|stage-)/i.test(parts[0])
    ) {
      supp.languages = parts.shift()!.split(",").map((l) => l.toUpperCase()).join("/");
    }
    supplements.push(supp);
  }

  // Builder tree, mirroring the gem's build_identifier.
  const base: TreeObject = {};
  if (publishers[0] !== undefined && publishers[0] !== "") {
    base["publisher"] = publishers[0];
    if (publishers.length > 1) {
      base["copublishers"] = publishers.slice(1).map((c) => ({ copublisher: c }));
    }
  }
  if (part !== undefined || subpart !== undefined) {
    base["number_with_part"] = [number, part, subpart].filter((p) => p !== undefined).join("-");
  } else if (number !== undefined) {
    base["number"] = number;
  }
  if (year !== undefined) base["date"] = year;
  if (edition !== undefined) base["edition"] = edition;
  if (typeCode !== undefined && typeCode !== "is") {
    base["type_with_stage"] = typeCode.toUpperCase();
    // Pin the document class against the stage block below overwriting
    // type_with_stage (the Ruby builder reads the same hint).
    base["document_type"] = (URN_TYPE_KEYS[typeCode] ?? typeCode).toUpperCase();
  }

  if (stageCode !== undefined) {
    let stage: IsoTypedStage | undefined;
    if (stageFromAbbr !== undefined) {
      stage = locateStage(stageFromAbbr) ??
        ISO_TYPED_STAGES.find((s) => s.stageCode === stageCode);
    } else if (typeCode === undefined || typeCode === "is") {
      stage = urnIsStageByHarmonized(stageCode);
      // FCD is a legacy spelling of the DIS stage in URN form.
      if (stageCode === "40.00" && stage?.stageCode === "fcd") {
        stage = ISO_TYPED_STAGES.find(
          (s) => s.stageCode === "dis" && s.harmonized?.includes("40.00"),
        ) ?? stage;
      }
    }
    stage ??= urnStageByHarmonized(stageCode);
    if (stage !== undefined) base["type_with_stage"] = stage.abbr[0] ?? "";
    else base["stage"] = stageCode;
    if (stageIteration !== undefined) base["stage_iteration"] = stageIteration;
  }

  if (languages !== undefined) base["languages"] = languages;

  let tree: TreeObject = base;
  for (const supp of supplements) {
    // A bare language token with no supplement identity names the BASE
    // document (the gem merges it the same way — a wrapper would drop it).
    if (supp.type === undefined && supp.stage === undefined &&
        supp.number === undefined && supp.year === undefined &&
        supp.languages !== undefined) {
      base["languages"] = supp.languages;
      continue;
    }
    const suppTree: TreeObject = {};
    if (supp.stage !== undefined) {
      // A harmonized code resolves within the supplement's own type
      // family -- the IS-family default would turn a staged Corrigendum
      // into a plain IS (mirrors the gem's build_identifier).
      const stage = /^\d\d\.\d\d$/.test(supp.stage)
        ? ISO_TYPED_STAGES.find((st) => st.harmonized?.includes(supp.stage!) && st.typeKey === supp.type) ??
          ISO_TYPED_STAGES.find((st) => st.harmonized?.includes(supp.stage!) && st.typeKey === "is")
        : ISO_TYPED_STAGES.find((st) => st.stageCode === supp.stage);
      suppTree["type_with_stage"] = stage !== undefined
        ? stage.abbr[0] ?? ""
        : supp.type?.toUpperCase() ?? supp.stage.toUpperCase();
    }
    if (supp.type !== undefined && suppTree["type_with_stage"] === undefined) {
      // "sup" is the generic Supplement (type key "suppl") -- the raw
      // "SUP" resolves the Directives Supplement row, whose render needs
      // the supplement_publisher a guide chain never has
      const typeToken = supp.type === "sup" ? "SUPPL" : supp.type.toUpperCase();
      suppTree["type_with_stage"] = typeToken;
    }
    if (supp.number !== undefined) suppTree["number"] = supp.number;
    if (supp.year !== undefined) suppTree["date"] = supp.year;
    if (supp.version !== undefined) suppTree["supplement_version"] = supp.version;
    if (supp.languages !== undefined) suppTree["languages"] = supp.languages;
    tree = { base: tree, ...suppTree };
  }
  const identifier = new IsoBuilder().build(tree);
  if (allParts) {
    (identifier as unknown as { all_parts: boolean }).all_parts = true;
  }
  return identifier;
}

export function isoGrammarImplementation(): FlavorImplementation {
  return {
    // Inverse of the ISO UrnGenerator (lib/pubid/iso/urn_parser.rb): the
    // reference rebuilds a builder hash straight from the positional URN
    // fields, so the port does the same against the shared IsoBuilder.
    parseUrn(urn: string): Identifier {
      return parseIsoUrn(urn) as unknown as Identifier;
    },

    parse(input: string): Identifier {
      return parseHuman(input) as unknown as Identifier;
    },
  };
}
