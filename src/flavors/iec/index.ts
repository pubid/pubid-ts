import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import { TYPED_STAGES } from "./model.js";
import { Language, PubidDate } from "../../model/component.js";
import { iecGrammar, preprocessIec } from "./grammar.js";
import {
  locateStage,
  IEC_CLASSES,
  type IecIdentifier,
  type TypedStage,
} from "./model.js";

type TreeValue = unknown;

const isObj = (v: Tree): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const s = (v: TreeValue): string | undefined =>
  v === undefined || v === null ? undefined : String(v);

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

interface Parsed {
  typedStage?: TypedStage;
  kind: keyof typeof IEC_CLASSES.KIND_CLASSES;
  attrs: Record<string, unknown>;
  wrapper?: "sheet" | "vap" | "consolidated" | "fragment";
}

/** Splits a number_with_part tree into number/part/subpart. */
function numberComponents(tree: TreeValue): Record<string, string | undefined> {
  const obj = isObj(tree as Tree) ? (tree as TreeObject) : undefined;
  const raw = obj === undefined ? s(tree) : s(obj["number"]);
  if (raw === undefined) return {};
  const out: Record<string, string | undefined> = { number: raw };
  const part = obj === undefined ? undefined : s(obj["part"]);
  const subpart = obj === undefined ? undefined : s(obj["subpart"]);
  if (part !== undefined) out["part"] = part;
  if (subpart !== undefined) out["subpart"] = subpart;
  return out;
}

function buildDate(tree: TreeValue): PubidDate | undefined {
  const dateStr = s(flatten(tree as Tree));
  if (dateStr === undefined) return undefined;
  const parts = dateStr.split("-");
  return new PubidDate({ year: parts[0], month: parts[1], day: parts[2] });
}

function parseLanguages(tree: TreeValue): Language[] {
  const raw = s(tree);
  if (raw === undefined) return [];
  const tokens = raw.split(",").flatMap((chunk) => chunk.split("/"));
  return tokens
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((original) => {
      const code = original.length === 1
        ? (Language.CHAR_MAP[original] ?? original.toLowerCase())
        : original;
      return new Language({ code, originalCode: original });
    });
}

class IecBuilder {
  build(data: Tree): BaseIdentifier {
    return this.buildInner(data);
  }

  private buildInner(data: Tree): BaseIdentifier {
    const tree = flatten(data);

    // --- working programme / working document ---
    if (tree["wp_stage"] !== undefined) return this.buildWorkingProgramme(tree);
    if (tree["technical_committee"] !== undefined && tree["wd_number"] !== undefined) {
      return this.buildWorkingDocument(tree);
    }
    if (tree["technical_committee"] !== undefined) {
      throw new ParseFailed("IEC: technical groups are not corpus-covered", 0);
    }

    // --- fragment of an amendment/corrigendum (third_part notation) ---
    if (tree["fragment_type"] !== undefined && tree["base"] !== undefined) {
      return this.buildFragment(tree);
    }

    // --- sheets ---
    if (tree["base"] !== undefined && (tree["sheet_number"] !== undefined || tree["sheet_year"] !== undefined)) {
      return this.buildSheet(tree);
    }

    // --- supplements (incl. supplement-of-supplement) ---
    if (tree["base"] !== undefined) return this.buildSupplement(tree);

    return this.buildSingle(tree);
  }

  private commonAttrs(tree: TreeObject, attrs: Record<string, unknown>): void {
    Object.assign(attrs, numberComponents(tree["number_with_part"]));
    // Letters-prefixed numbers (IECEE "CAB", "AD") only take digit-first
    // parts — "CAB-G01" rejects (Ruby parity; digit numbers like 61158-X
    // keep letter parts).
    const number = attrs["number"] as string | undefined;
    const part = attrs["part"] as string | undefined;
    if (
      number !== undefined && /^[A-Z]{2,4}$/.test(number) &&
      part !== undefined && /^[A-Za-z]/.test(part)
    ) {
      throw new ParseFailed(`IEC: letter part ${part} after letters number ${number}`, 0);
    }
    const dateTree = tree["date"];
    if (dateTree !== undefined) {
      const date = buildDate(dateTree);
      if (date) attrs["date"] = date;
    }
    if (tree["undated_marker"] !== undefined) attrs["date"] = new PubidDate({ undated: true });
    const edition = s(tree["edition"]);
    if (edition !== undefined) attrs["edition"] = edition;
    if (tree["languages"] !== undefined) {
      attrs["languages"] = parseLanguages(tree["languages"]);
    }
    const publisher = s(tree["publisher"]);
    if (publisher !== undefined) attrs["publisher"] = publisher;
    const copubTree = tree["copublishers"];
    if (copubTree !== undefined && copubTree !== null && copubTree !== "") {
      const list = Array.isArray(copubTree) ? copubTree : [copubTree];
      const bodies = list
        .map((c) => (isObj(c) ? String(c["copublisher"]) : String(c)))
        .filter((b) => b !== "" && b !== "null" && b !== "undefined");
      if (bodies.length > 0) attrs["copublishers"] = bodies;
    }
    if (tree["all_parts"] !== undefined) attrs["all_parts"] = true;
    if (tree["database"] !== undefined) attrs["database"] = true;
  }

  private buildSingle(tree: TreeObject): BaseIdentifier {
    const stageAbbr = s(tree["type_with_stage"]) ?? s(tree["type_with_stage_fr"]) ?? "";
    const typedStage = locateStage(stageAbbr) ?? locateStage("IS")!;
    const kind = typedStage.typeCode === "wp" ? "is" : typedStage.typeCode;

    const attrs: Record<string, unknown> = {};
    this.commonAttrs(tree, attrs);
    // TRF with an embedded CISPR document: the CISPR number is runtime-only
    // (hash carries just year/publisher; the URN names the CISPR document).
    if (tree["trf_org"] !== undefined) {
      const cisprComponents = numberComponents(tree["number_with_part"]);
      attrs["cispr_number"] = cisprComponents["number"];
      attrs["cispr_part"] = cisprComponents["part"];
      delete attrs["number"];
      delete attrs["part"];
      delete attrs["subpart"];
    }
    // The supplement-of-supplement path stores the base separately.
    const parsed: Parsed = {
      typedStage,
      kind: kind as Parsed["kind"],
      attrs,
    };

    // Consolidated supplements (+AMD…+AMD…)
    const consolidated = tree["consolidated_supplements"];
    let identifier = this.construct(parsed, attrs);

    if (consolidated !== undefined) {
      identifier = this.wrapConsolidated(identifier, consolidated);
    }
    const vapSuffix = s(tree["vap_suffix"]);
    if (vapSuffix !== undefined) {
      identifier = this.wrapVap(identifier, vapSuffix);
    }
    return identifier;
  }

  private construct(parsed: Parsed, attrs: Record<string, unknown>): BaseIdentifier {
    const klass = IEC_CLASSES.KIND_CLASSES[parsed.kind]!;
    if (klass === undefined) throw new ParseFailed(`IEC: unknown kind ${String(parsed.kind)}`, 0);
    const identifier = new (klass as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
    (identifier as unknown as { typedStage: TypedStage | undefined }).typedStage = parsed.typedStage;
    // The wire "stage" is the draft stage code (published stages drop).
    const ts = parsed.typedStage;
    if (ts !== undefined && ts.stageCode !== "published") {
      (identifier as unknown as Record<string, unknown>)["stage"] = ts.code;
    }
    return identifier;
  }

  private wrapConsolidated(base: BaseIdentifier, data: TreeValue): BaseIdentifier {
    const list = Array.isArray(data) ? data : [data];
    const members: BaseIdentifier[] = [base];
    for (const raw of list) {
      if (!isObj(raw)) continue;
      const type = s(raw["supplement_type"]);
      const number = s(raw["supplement_number"]);
      if (type === undefined || number === undefined) continue;
      const date = s(raw["supplement_year"]);
      const attrs: Record<string, unknown> = {
        number,
        ...(date !== undefined ? { date: new PubidDate({ year: date }) } : {}),
      };
      const kind = type === "AMD" ? "amd" : "cor";
      const member = this.construct(
        { kind: kind as Parsed["kind"], attrs, typedStage: locateStage(type)! },
        attrs,
      );
      members.push(member);
    }
    return new (IEC_CLASSES.CONSOLIDATED_CLASS as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)({
      identifiers: members,
    });
  }

  private wrapVap(base: BaseIdentifier, vapSuffix: string): BaseIdentifier {
    const vap = vapSuffix.split("-");
    let edition: string | undefined;
    // A consolidated base carries the edition on its FIRST member (Ruby).
    const kind = base.constructor.polymorphicName.slice("pubid:iec:".length);
    const holder =
      kind === "consolidated-identifier"
        ? ((base as unknown as { identifiers: BaseIdentifier[] }).identifiers[0] as unknown as Record<string, unknown>)
        : (base as unknown as Record<string, unknown>);
    if (holder["edition"] !== undefined) {
      edition = String(holder["edition"]);
      delete holder["edition"];
    }
    return new (IEC_CLASSES.VAP_CLASS as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)({
      base,
      vap,
      ...(edition !== undefined ? { edition } : {}),
    });
  }

  private buildSupplement(tree: TreeObject): BaseIdentifier {
    const base = this.buildInner(tree["base"] as Tree);
    const stageAbbr = s(tree["type_with_stage"]) ?? "";
    const typedStage = locateStage(stageAbbr) ?? locateStage("AMD")!;
    let kind: Parsed["kind"];
    if (typedStage.typeCode === "cor") kind = "cor";
    else if (typedStage.typeCode === "ish") kind = "ish";
    else if (typedStage.typeCode === "frag") {
      // FRAG parses as a supplement stage; the class is the fragment.
      const innerAttrs: Record<string, unknown> = {};
      this.commonAttrs(tree, innerAttrs);
      const number = innerAttrs["number"];
      delete innerAttrs["number"];
      const baseRec2 = base as unknown as Record<string, unknown>;
      if (baseRec2["publisher"] !== undefined && baseRec2["publisher"] !== "IEC") innerAttrs["publisher"] = baseRec2["publisher"];
      const fragment = new (IEC_CLASSES.FRAGMENT_CLASS as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)({
        base,
        ...(number !== undefined ? { fragment_number: number } : {}),
        ...innerAttrs,
      });
      return fragment;
    } else kind = "amd";

    const attrs: Record<string, unknown> = {};
    this.commonAttrs(tree, attrs);
    // Supplements copy the delegated publisher/copublishers level.
    const baseRec = base as unknown as Record<string, unknown>;
    if (attrs["publisher"] === undefined && baseRec["publisher"] !== undefined && baseRec["publisher"] !== "IEC") {
      attrs["publisher"] = baseRec["publisher"];
    }
    if (attrs["copublishers"] === undefined && Array.isArray(baseRec["copublishers"]) && baseRec["copublishers"].length > 0) {
      attrs["copublishers"] = baseRec["copublishers"];
    }

    const supplement = this.construct({ kind: kind as Parsed["kind"], attrs, typedStage }, attrs);
    const suppRec = supplement as unknown as Record<string, unknown>;
    suppRec["base"] = base;

    const vapSuffix = s(tree["vap_suffix"]);
    if (vapSuffix !== undefined) return this.wrapVap(supplement, vapSuffix);
    return supplement;
  }

  private buildSheet(tree: TreeObject): BaseIdentifier {
    let base = this.buildInner(tree["base"] as Tree);
    const sheet_number = s(tree["sheet_number"]);
    const sheet_year = s(tree["sheet_year"]);
    base = new (IEC_CLASSES.SHEET_CLASS as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)({
      base,
      ...(sheet_number !== undefined ? { sheet_number } : {}),
      ...(sheet_year !== undefined ? { sheet_year } : {}),
    });
    // A supplement wrapping the sheet: IEC 60695-2-1/1:1994/COR1:1995.
    if (tree["type_with_stage"] !== undefined) {
      const stageAbbr = s(tree["type_with_stage"]) ?? "";
      const typedStage = locateStage(stageAbbr) ?? locateStage("COR")!;
      const kind = typedStage.typeCode === "cor" ? "cor" : "amd";
      const attrs: Record<string, unknown> = {};
      const numberObj = numberComponents(tree["number_with_part"]);
      Object.assign(attrs, numberObj);
      const dateTree = tree["date"];
      if (dateTree !== undefined) {
        const date = buildDate(dateTree);
        if (date) attrs["date"] = date;
      }
      const supplement = this.construct({ kind: kind as Parsed["kind"], attrs, typedStage }, attrs);
      (supplement as unknown as Record<string, unknown>)["base"] = base;
      return supplement;
    }
    return base;
  }

  private buildFragment(tree: TreeObject): BaseIdentifier {
    // fragment_notation on the outer identifier (third_part)
    const innerTree = { ...tree };
    delete innerTree["fragment_type"];
    delete innerTree["fragment_number"];
    const base = this.buildInner(innerTree as TreeObject);
    const fragment_number = s(tree["fragment_number"]);
    const edition = s(tree["edition"]);
    return new (IEC_CLASSES.FRAGMENT_CLASS as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)({
      base,
      ...(fragment_number !== undefined ? { fragment_number } : {}),
      ...(edition !== undefined ? { edition } : {}),
    });
  }

  private buildWorkingProgramme(tree: TreeObject): BaseIdentifier {
    const attrs: Record<string, unknown> = {
      wp_stage: s(tree["wp_stage"]),
      wp_type: s(tree["wp_type"]),
    };
    if (tree["wp_raw"] !== undefined) {
      // TC-style name ("SyCCOMM-1"): split the trailing number as the part.
      const raw = String(tree["wp_raw"]).replaceAll("‑", "-").replaceAll("‐", "-");
      const segments = raw.split("-").filter((seg) => seg !== "");
      attrs["number"] = segments.shift();
      if (segments.length > 0) attrs["part"] = segments.shift();
      if (segments.length > 0) attrs["subpart"] = segments.join("-");
    }
    Object.assign(attrs, numberComponents(tree["number_with_part"]));
    const edition = s(tree["edition"]);
    if (edition !== undefined) attrs["edition"] = edition;
    const identifier = new (IEC_CLASSES.KIND_CLASSES["wp"]! as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
    const ts = locateStage(s(tree["wp_stage"]) === "PNW" ? "PNW" : "PWI")!;
    (identifier as unknown as { typedStage: TypedStage | undefined }).typedStage = ts;
    if (ts !== undefined && ts.stageCode !== "published") {
      (identifier as unknown as Record<string, unknown>)["stage"] = ts.code;
    }
    return identifier;
  }

  private buildWorkingDocument(tree: TreeObject): BaseIdentifier {
    const attrs: Record<string, unknown> = {
      technical_committee: s(tree["technical_committee"]),
      wd_number: s(tree["wd_number"]),
      wd_language: s(tree["wd_language"]),
      wd_stage: s(tree["wd_stage"]),
    };
    return new (IEC_CLASSES.KIND_CLASSES["wp"]! as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }
}

/** --- URN: the positional-slot machine (lib/pubid/iec/urn_generator.rb) --- */

const TYPE_SLOT_CODES = new Set(["tr", "ts", "pas", "srd", "guide", "tec", "wp"]);
const DELIVERABLES = new Set(["cmv", "csv", "exv", "prv", "rlv", "ser"]);
const ADJUNCT_TOKENS: Record<string, string> = {
  amendment: "amd",
  corrigendum: "cor",
  "interpretation-sheet": "ish",
};

function idKind(id: BaseIdentifier): string {
  return id.constructor.polymorphicName.slice("pubid:iec:".length);
}

function maybeOf<T>(id: BaseIdentifier, attr: string): T | undefined {
  return (id as unknown as Record<string, unknown>)[attr] as T | undefined;
}

function findDown<T>(id: BaseIdentifier | undefined, attr: string): T | undefined {
  let current = id;
  while (current !== undefined) {
    const value = maybeOf<T>(current, attr);
    if (value !== undefined && !(Array.isArray(value) && value.length === 0) && value !== "") {
      return value;
    }
    current =
      (maybeOf<BaseIdentifier>(current, "base") as BaseIdentifier | undefined) ??
      (maybeOf<BaseIdentifier[]>(current, "identifiers")?.[0] as BaseIdentifier | undefined);
  }
  return undefined;
}

function rootOf(id: BaseIdentifier): BaseIdentifier {
  let current = id;
  while (true) {
    const base = maybeOf<BaseIdentifier>(current, "base");
    if (base !== undefined) {
      current = base;
      continue;
    }
    const ids = maybeOf<BaseIdentifier[]>(current, "identifiers");
    if (ids !== undefined && ids.length > 0 && ids[0] !== current) {
      current = ids[0]!;
      continue;
    }
    return current;
  }
}

function adjunctFields(id: BaseIdentifier, plus: boolean): string[] {
  const kind = idKind(id);
  const token = ADJUNCT_TOKENS[kind];
  if (token === undefined) return [];
  const date = maybeOf<PubidDate>(id, "date");
  return [
    plus ? "plus" : "",
    token,
    String(maybeOf(id, "number") ?? ""),
    date !== undefined ? (date.render() ?? "") : "",
  ];
}

function adjunctSlots(id: BaseIdentifier | undefined): string[] {
  if (id === undefined) return [];
  const kind = idKind(id);
  if (kind === "consolidated-identifier") {
    const members = maybeOf<BaseIdentifier[]>(id, "identifiers") ?? [];
    return [
      ...adjunctSlots(members[0]),
      ...members.slice(1).flatMap((m) => adjunctFields(m, true)),
    ];
  }
  const recursed = adjunctSlots(maybeOf<BaseIdentifier>(id, "base"));
  if (ADJUNCT_TOKENS[kind] !== undefined) {
    return [...recursed, ...adjunctFields(id, false)];
  }
  return recursed;
}

export function iecToUrn(identifier: BaseIdentifier): string {
  // The document the URN names: the origin standard with wrappers peeled.
  const doc = rootOf(identifier);
  const trf = doc;
  let docWithNumber: BaseIdentifier | { number?: unknown; part?: unknown; subpart?: unknown; publisher?: unknown; copublishers?: unknown; date?: unknown; typedStage?: unknown };
  if (maybeOf<string>(trf, "number") === undefined && maybeOf<string>(trf, "cispr_number") !== undefined) {
    // TRF: read number/part from the runtime CISPR columns.
    docWithNumber = {
      get number() { return maybeOf<string>(trf, "cispr_number"); },
      get part() { return maybeOf<string>(trf, "cispr_part"); },
      get subpart() { return undefined; },
      get publisher() { return "CISPR"; },
      get copublishers() { return []; },
      get date() { return undefined; },
      get typedStage() { return (trf as unknown as { typedStage?: TypedStage }).typedStage; },
    };
  } else {
    docWithNumber = maybeOf<string>(doc, "number") !== undefined
      ? doc
      : (maybeOf<BaseIdentifier>(doc, "cispr_identifier") as BaseIdentifier | undefined) ?? doc;
  }

  const number = maybeOf<string>(docWithNumber as BaseIdentifier, "number");
  if (number === undefined) return "urn:iec:std:";
  const numSegment = [number, maybeOf<string>(docWithNumber as BaseIdentifier, "part"), maybeOf<string>(docWithNumber as BaseIdentifier, "subpart")]
    .filter((v) => v !== undefined && v !== "")
    .join("-")
    .replace(/\s+/g, "-");
  if (numSegment === "") return "urn:iec:std:";

  const publishers = [
    maybeOf<string>(docWithNumber as BaseIdentifier, "publisher") ?? "IEC",
    ...(maybeOf<string[]>(docWithNumber as BaseIdentifier, "copublishers") ?? []),
  ]
    .filter((p): p is string => p !== undefined && p !== "")
    .map((p) => p.split(/\s+/).at(-1)!)
    .filter((p) => p !== "");
  const authority = publishers.join("-");

  const date = maybeOf<PubidDate>(docWithNumber as BaseIdentifier, "date");
  const dateSlot = date !== undefined ? (date.render() ?? "") : "";

  const ts = (docWithNumber as BaseIdentifier as unknown as { typedStage?: TypedStage }).typedStage;
  const typeToken = ts !== undefined && TYPE_SLOT_CODES.has(ts.typeCode) ? ts.typeCode : "";
  const stageToken =
    ts !== undefined && ts.stageCode !== "published"
      ? `stage-${ts.harmonized ?? ts.stageCode}`
      : "";
  const stageOrType = [typeToken, stageToken].filter((t) => t !== "").join("-");

  const vap = findDown<string[]>(identifier, "vap");
  const vapCodes = (vap ?? [])
    .map((c) => c.toLowerCase())
    .filter((c) => DELIVERABLES.has(c));
  let deliverable = vapCodes.join("-");
  if (deliverable === "") {
    const edition = findDown<string>(identifier, "edition");
    deliverable = edition !== undefined ? `ed-${edition}` : "";
  }

  const langs = maybeOf<Language[]>(identifier, "languages") ?? [];
  const language = langs.map((l) => l.code).join("-");

  const slots = ["urn", "iec", "std", authority, numSegment, dateSlot, stageOrType, deliverable];
  const adjuncts = adjunctSlots(identifier);
  const bareSeries =
    slots.at(-1) === "ser" &&
    slots.slice(5, 7).every((x) => x === "") &&
    adjuncts.length === 0 &&
    language === "";
  if (!bareSeries) slots.push(language);

  return [...slots, ...adjuncts].join(":").toLowerCase();
}

// Attach the URN generator to every registered IEC class (the base
// toUrn resolves constructor.urnGenerator).
class IecUrnGenerator {
  constructor(private readonly identifier: BaseIdentifier) {}
  generate(): string {
    return iecToUrn(this.identifier);
  }
}
for (const klass of [
  ...Object.values(IEC_CLASSES.KIND_CLASSES),
  IEC_CLASSES.SHEET_CLASS,
  IEC_CLASSES.VAP_CLASS,
  IEC_CLASSES.CONSOLIDATED_CLASS,
  IEC_CLASSES.FRAGMENT_CLASS,
]) {
  if (klass !== undefined) {
    (klass as unknown as Record<string, unknown>).urnGenerator = IecUrnGenerator;
  }
}

export function iecGrammarImplementation(): FlavorImplementation {
  const builder = new IecBuilder();
  return {
    // Inverse of the IEC UrnGenerator (lib/pubid/iec/urn_parser.rb):
    // reassemble the positional URN fields into a text code, parse it, then
    // attach languages and the all-parts wrap.
    parseUrn(urn: string): Identifier {
      const parsed = urnToCode(urn);
      if (!parsed) throw new Error(`Invalid IEC URN: ${urn}`);
      const [code, lang, allParts] = parsed;
      // The reference parses the unprefixed rebuild and its grammar
      // defaults the IEC publisher; the ts grammar needs it explicit.
      const id = this.parse(code);
      if (lang && lang !== "" && "languages" in (id as object)) {
        (id as unknown as { languages: unknown }).languages = lang
          .split("-")
          .map((c) => new Language({ code: c }));
      }
      if (allParts) {
        (id as unknown as { all_parts: boolean }).all_parts = true;
      }
      return id;
    },

    parse(input: string): Identifier {
      let tree: Tree;
      try {
        tree = parseGrammar(iecGrammar, preprocessIec(input));
      } catch {
        throw new ParseFailed("IEC: parse failed", 0);
      }
      return builder.build(tree) as unknown as Identifier;
    },
  };
}

// Port of Relaton::Iec.urn_to_code + the slot helpers
// (lib/pubid/iec/urn_parser.rb): reassemble the positional URN fields into
// a text code. Returns [code, language, allParts].
function urnToCode(urn: string): [string, string | undefined, boolean] | undefined {
  const fields = urn.toUpperCase().split(":");
  if (fields.length < 5) return undefined;

  const [head, num, date, type, deliv, lang] = fields.slice(3, 9);
  let allParts = false;

  let code = head!.replaceAll("-", "/");
  const typeCode = typeSlotToCode(type);
  if (typeCode !== "") code += ` ${typeCode}`;
  code += ` ${num!}`;
  if (date !== undefined && date !== "") code += `:${date}`;
  code += adjunctToCode(fields.slice(9));

  if ((deliv ?? "").toLowerCase() === "ser") {
    allParts = true;
  } else if (deliv !== undefined) {
    const edition = editionSlotToCode(deliv);
    if (edition) code += ` ${edition}`;
    else if (deliv !== "") code += ` ${deliv}`;
  }

  return [code, lang?.toLowerCase(), allParts];
}

// The type slot holds a legacy type token ("TS"), a stage
// ("STAGE-10.20"), or both ("TS-STAGE-50.00"); a stage is written back as
// the abbreviation resolved from the typed-stage registry.
function typeSlotToCode(type: string | undefined): string {
  if (type === undefined || type === "") return "";
  const match = type.match(/^([A-Z]+-)?STAGE-([\d.]+)$/);
  if (!match) return type;
  const stageType = (match[1] ?? "IS-").replace("-", "").toLowerCase();
  const stage = TYPED_STAGES.find(
    (t) => t.typeCode === stageType && (t.harmonized ?? "") === match[2],
  );
  return stage ? stage.abbr : "";
}

// "ED-7" in the deliverable slot is an edition, not a deliverable code.
function editionSlotToCode(deliv: string | undefined): string | undefined {
  const match = deliv?.match(/^ED-(.+)$/);
  return match ? `ED${match[1]}` : undefined;
}

// Adjuncts are (relation, type, number, date) quartets; a "PLUS" relation
// yields "+", otherwise "/".
function adjunctToCode(fields: string[]): string {
  if (!fields.length) return "";
  const [rel = "", type = "", num = "", date = ""] = fields.slice(0, 4);
  let code = (rel === "" ? "/" : "+") + type + num;
  if (date !== "") code += `:${date}`;
  return code + adjunctToCode(fields.slice(4));
}

