import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { Language, PubidDate, Iteration } from "../../model/component.js";

/**
 * IEC model classes (lib/pubid/iec/identifiers/*). The typed stage is a
 * runtime attribute driving type derivation and the URN stage slot; the
 * wire hash carries only the stage CODE for non-published drafts.
 */

export type IecTypeCode =
  | "is" | "tr" | "ts" | "pas" | "srd" | "od" | "guide" | "ish"
  | "frag" | "trf" | "tec" | "wp" | "sttr" | "amd" | "cor";

export interface TypedStage {
  code: string;
  stageCode: string;
  typeCode: IecTypeCode;
  abbr: string;
  /** Harmonized stage code for the URN "stage-…" slot (drafts only). */
  harmonized?: string | undefined;
  /** Grammar tokens that resolve to this stage (defaults to [abbr]). */
  tokens?: string[] | undefined;
}

const TS = (code: string, stageCode: string, typeCode: IecTypeCode, abbr: string, harmonized?: string, tokens?: string[]): TypedStage =>
  ({ code, stageCode, typeCode, abbr, harmonized, tokens });

export const TYPED_STAGES: TypedStage[] = [
  TS("is", "published", "is", ""),
  TS("tr", "published", "tr", "TR"),
  TS("ts", "published", "ts", "TS"),
  TS("pas", "published", "pas", "PAS"),
  TS("srd", "published", "srd", "SRD"),
  TS("od", "published", "od", "OD"),
  TS("guide", "published", "guide", "GUIDE", undefined, ["GUIDE", "Guide"]),
  TS("ish", "published", "ish", "ISH"),
  TS("frag", "published", "frag", "FRAG"),
  TS("trf", "published", "trf", "TRF"),
  TS("amd", "published", "amd", "AMD"),
  TS("cor", "published", "cor", "COR"),
  TS("np", "np", "is", "NP", "10.20"),
  TS("pnw", "pnw", "is", "PNW", "10.20"),
  TS("pwi", "pwi", "is", "PWI", "00.00"),
  TS("anw", "anw", "is", "ANW"),
  TS("wd", "wd", "is", "WD"),
  TS("cd", "cd", "is", "CD", "30.20"),
  TS("cdv", "cdv", "is", "CDV", "40.20"),
  TS("fdis", "fdis", "is", "FDIS", "50.00"),
  TS("prf", "prf", "is", "PRF"),
  TS("bpub", "bpub", "is", "BPUB"),
  TS("ppub", "ppub", "is", "PPUB"),
  TS("dtr", "dtr", "tr", "DTR"),
  TS("adtr", "adtr", "tr", "ADTR"),
  TS("cdtr", "cdtr", "tr", "CDTR"),
  TS("ndtr", "ndtr", "tr", "NDTR"),
  TS("dts", "dts", "ts", "DTS"),
  TS("adts", "adts", "ts", "ADTS"),
  TS("cdts", "cdts", "ts", "CDTS"),
  TS("ndts", "ndts", "ts", "NDTS"),
  TS("dpas", "dpas", "pas", "DPAS"),
  TS("cdpas", "cdpas", "pas", "CDPAS"),
  TS("dam", "dam", "amd", "DAM"),
  TS("fdam", "fdam", "amd", "FDAM"),
  TS("dcor", "dcor", "cor", "DCOR"),
  TS("fdcor", "fdcor", "cor", "FDCOR"),
  TS("cdish", "cdish", "ish", "CDISH"),
  TS("dish", "dish", "ish", "DISH"),
];

export function stageTokens(): string[] {
  return TYPED_STAGES.flatMap((t) => t.tokens ?? [t.abbr]);
}

export function locateStage(token: string): TypedStage | undefined {
  const needle = token.trim();
  return (
    TYPED_STAGES.find((t) => (t.tokens ?? [t.abbr]).includes(needle)) ??
    TYPED_STAGES.find((t) => t.abbr.toUpperCase() === needle.toUpperCase())
  );
}

const TYPE_NAMES: Record<IecTypeCode, string | undefined> = {
  is: "international-standard",
  tr: "technical-report",
  ts: "technical-specification",
  pas: "publicly-available-specification",
  srd: "systems-reference-document",
  od: "operational-document",
  guide: "guide",
  ish: "interpretation-sheet",
  frag: "fragment-identifier",
  trf: "test-report-form",
  amd: "amendment",
  cor: "corrigendum",
  tec: undefined,
  wp: undefined,
  sttr: undefined,
};

// The shared single-document attribute table (SingleIdentifier seam).
const SINGLE_ATTRS = {
  number: { type: "string" },
  part: { type: "string" },
  subpart: { type: "string" },
  date: { type: PubidDate },
  undated: { type: "boolean", default: false },
  edition: { type: "string" },
  languages: { type: Language, collection: true, initializeEmpty: true },
  publisher: { type: "string", default: "IEC" },
  copublishers: { type: "string", collection: true, initializeEmpty: true },
  stage: { type: "string" },
  stage_iteration: { type: Iteration },
  all_parts: { type: "boolean", default: false },
  database: { type: "boolean", default: false },
} as const;

// The Identifier-level whitelist: date flat, publisher only when it is
// not the IEC default, copublishers as a body list, stage only for drafts.
const BASE_MAPPINGS = keyValue(
  { wire: "stage_iteration", to: "stage_iteration" },
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
            undated: h["undated"] === true,
          }),
  },
  { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
  { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
  {
    wire: "undated",
    to: "date",
    toWire: (m) => ((m["date"] as PubidDate | undefined)?.undated ? true : undefined),
    fromWire: (h) => (h["undated"] === true ? new PubidDate({ undated: true }) : undefined),
  },
  { wire: "edition", to: "edition" },
  { wire: "languages", to: "languages" },
  {
    wire: "publisher",
    to: "publisher",
    toWire: (m) => (m["publisher"] === "IEC" ? undefined : m["publisher"]),
    fromWire: (h) => (h["publisher"] === undefined || h["publisher"] === null ? undefined : String(h["publisher"])),
  },
  {
    wire: "copublishers",
    to: "copublishers",
    toWire: (m) => {
      const list = m["copublishers"] as string[] | undefined;
      return list !== undefined && list.length > 0 ? list : undefined;
    },
    fromWire: (h) => (Array.isArray(h["copublishers"]) ? (h["copublishers"] as string[]).map(String) : undefined),
  },
  { wire: "stage", to: "stage" },
  { wire: "all_parts", to: "all_parts" },
  { wire: "database", to: "database" },
);

export abstract class IecIdentifier extends BaseIdentifier {
  declare readonly number: string | undefined;

  /** Walk the supplement chain to the base document (BSI's URN
   * generator reaches the root identity of adopted bases). */
  root(): IecIdentifier {
    const base = (this as unknown as Record<string, unknown>)["base"];
    return base instanceof IecIdentifier ? base.root() : this;
  }

  declare readonly part: string | undefined;
  declare readonly subpart: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly edition: string | undefined;
  declare readonly languages: Language[];
  declare readonly publisher: string | undefined;
  declare readonly copublishers: string[];
  declare readonly stage: string | undefined;
  declare readonly all_parts: boolean | undefined;
  declare readonly database: boolean | undefined;
  declare readonly base: IecIdentifier | undefined;

  /** The runtime typed stage — never serialized directly. */
  typedStage: TypedStage | undefined;

  /** Ruby SingleIdentifier#publisher_portion. */
  publisherPortion(): string {
    const publishers =
      this.copublishers.length > 0
        ? [this.publisher ?? "IEC", ...this.copublishers]
        : [this.publisher ?? "IEC"];
    let pub = publishers.join("/");
    const abbr = this.typedStage?.abbr ?? "";
    if (abbr !== "") pub += ` ${abbr}`;
    return pub;
  }

  /** Ruby SingleIdentifier#number_portion. */
  numberPortion(): string {
    return [
      this.number !== undefined ? String(this.number) : "",
      this.part !== undefined ? `-${this.part}` : "",
      this.subpart !== undefined ? `-${this.subpart}` : "",
      this.stageIterationValue() !== undefined ? `.${this.stageIterationValue()}` : "",
      this.date !== undefined ? `:${this.date.render()}` : "",
    ].join("");
  }

  stageIterationValue(): string | undefined {
    return (this as unknown as { stage_iteration?: { string?: string } }).stage_iteration?.string;
  }

  languagePortion(): string {
    if (this.languages.length === 0) return "";
    return `(${this.languages.map((l) => l.code).join(",")})`;
  }
}

function iecSingleClass(kind: IecTypeCode): IdentifierStatic {
  const name = TYPE_NAMES[kind];
  if (name === undefined) throw new Error(`no type name for ${kind}`);
  class IecSingleIdentifier extends IecIdentifier {
    static polymorphicName = `pubid:iec:${name}`;
    static attributes = extendAttributes(BaseIdentifier, SINGLE_ATTRS);
    // Ruby: number/part/subpart live on the SingleIdentifier key_value seam.
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "part", to: "part" },
      { wire: "subpart", to: "subpart" },
      ...BASE_MAPPINGS,
    );

    render(): string {
      let result = `${this.publisherPortion()} ${this.numberPortion()}`;
      if (this.edition !== undefined) result += ` ED${this.edition}`;
      if (this.database === true) result += " DB";
      if (this.all_parts === true) result += " (all parts)";
      result += this.languagePortion();
      return result;
    }
  }
  registerType(IecSingleIdentifier as unknown as IdentifierStatic);
  return IecSingleIdentifier as unknown as IdentifierStatic;
}

/** Working documents: the TC/wd fields are runtime-only (hash is bare). */
function iecWorkingDocumentClass(): IdentifierStatic {
  class IecWorkingDocument extends IecIdentifier {
    static polymorphicName = "pubid:iec:working-document";
    static attributes = extendAttributes(BaseIdentifier, {
      ...SINGLE_ATTRS,
      wp_stage: { type: "string" },
      wp_type: { type: "string" },
      technical_committee: { type: "string" },
      wd_number: { type: "string" },
      wd_language: { type: "string" },
      wd_stage: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "part", to: "part" },
      { wire: "subpart", to: "subpart" },
      { wire: "edition", to: "edition" },
    );

    declare readonly wp_stage: string | undefined;
    declare readonly wp_type: string | undefined;
    declare readonly technical_committee: string | undefined;
    declare readonly wd_number: string | undefined;
    declare readonly wd_language: string | undefined;
    declare readonly wd_stage: string | undefined;

    render(): string {
      if (this.wp_stage !== undefined) {
        const parts: string[] = [this.wp_stage];
        if (this.wp_type !== undefined && this.wp_type.trim() !== "") {
          parts.push(` ${this.wp_type.trim()}`);
        }
        if (this.number !== undefined) {
          let numStr = String(this.number);
          if (this.part !== undefined && this.part !== "") numStr += `-${this.part}`;
          if (this.subpart !== undefined && this.subpart !== "") numStr += `-${this.subpart}`;
          parts.push(` ${numStr}`);
        }
        if (this.edition !== undefined) parts.push(` ED${this.edition}`);
        return parts.join("");
      }
      const parts: string[] = [];
      if (this.technical_committee !== undefined) parts.push(this.technical_committee);
      if (this.wd_number !== undefined) {
        let numPart = this.wd_number;
        if (this.wd_language !== undefined) numPart += `(${this.wd_language})`;
        parts.push(numPart);
      }
      if (this.wd_stage !== undefined) parts.push(this.wd_stage);
      return parts.join("/");
    }
  }
  registerType(IecWorkingDocument as unknown as IdentifierStatic);
  return IecWorkingDocument as unknown as IdentifierStatic;
}

const yearFromWire = BASE_MAPPINGS.find((x) => x.wire === "year")!.fromWire!;

/** Test report forms: IECEE/IECQ/CISPR documents with an optional embedded CISPR id. */
function iecTrfClass(): IdentifierStatic {
  class IecTestReportForm extends IecIdentifier {
    static polymorphicName = "pubid:iec:test-report-form";
    static attributes = extendAttributes(BaseIdentifier, {
      ...SINGLE_ATTRS,
      cispr_number: { type: "string" },
      cispr_part: { type: "string" },
      trf_info: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "part", to: "part" },
      { wire: "subpart", to: "subpart" },
      { wire: "year", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.year, fromWire: yearFromWire },
      { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
      { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
      {
        wire: "publisher",
        to: "publisher",
        toWire: (m) => (m["publisher"] === "IEC" ? undefined : m["publisher"]),
        fromWire: (h) => (h["publisher"] === undefined || h["publisher"] === null ? undefined : String(h["publisher"])),
      },
      {
        wire: "copublishers",
        to: "copublishers",
        toWire: (m) => {
          const list = m["copublishers"] as string[] | undefined;
          return list !== undefined && list.length > 0 ? list : undefined;
        },
        fromWire: (h) => (Array.isArray(h["copublishers"]) ? (h["copublishers"] as string[]).map(String) : undefined),
      },
    );

    declare readonly cispr_number: string | undefined;
    declare readonly cispr_part: string | undefined;
    declare readonly trf_info: string | undefined;

    render(): string {
      let result = this.publisherPortion() + " ";
      if (this.cispr_number !== undefined) {
        let numStr = this.cispr_number;
        if (this.cispr_part !== undefined && this.cispr_part !== "") numStr += `-${this.cispr_part}`;
        let cisprStr = `CISPR ${numStr}`;
        if (this.date !== undefined) cisprStr += `:${this.date.render()}`;
        result += cisprStr;
      } else {
        result += this.numberPortion();
      }
      if (this.trf_info !== undefined && this.trf_info !== "") result += ` ${this.trf_info}`;
      return result;
    }
  }
  registerType(IecTestReportForm as unknown as IdentifierStatic);
  return IecTestReportForm as unknown as IdentifierStatic;
}

/** Supplements: amendment / corrigendum / interpretation sheet. */
function iecSupplementClass(kind: "amendment" | "corrigendum" | "interpretation-sheet"): IdentifierStatic {
  const notation = kind === "amendment" ? "amd" : kind === "corrigendum" ? "cor" : "ish";
  const abbr = kind === "amendment" ? "AMD" : kind === "corrigendum" ? "COR" : "ISH";
  class IecSupplementIdentifier extends IecIdentifier {
    static polymorphicName = `pubid:iec:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: IecIdentifier as unknown as IdentifierStatic },
      number: { type: "string" },
      synthetic_base: { type: "boolean", default: false },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "year", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.year, fromWire: yearFromWire },
      { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
      { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
      { wire: "edition", to: "edition" },
      {
        wire: "publisher",
        to: "publisher",
        toWire: (m) => (m["publisher"] === "IEC" ? undefined : m["publisher"]),
        fromWire: (h) => (h["publisher"] === undefined || h["publisher"] === null ? undefined : String(h["publisher"])),
      },
      {
        wire: "copublishers",
        to: "copublishers",
        toWire: (m) => {
          const list = m["copublishers"] as string[] | undefined;
          return list !== undefined && list.length > 0 ? list : undefined;
        },
        fromWire: (h) => (Array.isArray(h["copublishers"]) ? (h["copublishers"] as string[]).map(String) : undefined),
      },
      { wire: "base", to: "base" },
    );

    declare readonly synthetic_base: boolean | undefined;

    render(): string {
      const base = this.base;
      if (base === undefined || this.synthetic_base === true) {
        // Standalone draft supplement (not in the corpus; Ruby parity shape).
        let result = this.publisherPortion();
        result += ` ${abbr} ${base?.number ?? this.number ?? ""}`;
        if (this.date !== undefined) result += `:${this.date.render()}`;
        if (this.edition !== undefined) result += ` ED${this.edition}`;
        return result;
      }
      let result = base.render();
      result += `/${abbr}${this.number ?? ""}`;
      if (this.date !== undefined) result += `:${this.date.render()}`;
      if (this.edition !== undefined) result += ` ED${this.edition}`;
      return result;
    }
  }
  registerType(IecSupplementIdentifier as unknown as IdentifierStatic);
  return IecSupplementIdentifier as unknown as IdentifierStatic;
}

function iecSheetClass(): IdentifierStatic {
  class IecSheetIdentifier extends IecIdentifier {
    static polymorphicName = "pubid:iec:sheet-identifier";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: IecIdentifier as unknown as IdentifierStatic },
      sheet_number: { type: "string" },
      sheet_year: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "base", to: "base" },
      { wire: "sheet_number", to: "sheet_number" },
      { wire: "sheet_year", to: "sheet_year" },
    );

    declare readonly sheet_number: string | undefined;
    declare readonly sheet_year: string | undefined;

    render(): string {
      let result = this.base?.render() ?? "";
      result += `/${this.sheet_number}`;
      if (this.sheet_year !== undefined && this.sheet_year !== "") result += `:${this.sheet_year}`;
      return result;
    }
  }
  registerType(IecSheetIdentifier as unknown as IdentifierStatic);
  return IecSheetIdentifier as unknown as IdentifierStatic;
}

function iecVapClass(): IdentifierStatic {
  class IecVapIdentifier extends IecIdentifier {
    static polymorphicName = "pubid:iec:vap-identifier";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: IecIdentifier as unknown as IdentifierStatic },
      vap: { type: "string", collection: true, initializeEmpty: true },
      edition: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "base", to: "base" },
      { wire: "vap", to: "vap" },
      { wire: "edition", to: "edition" },
    );

    declare readonly vap: string[];

    render(): string {
      let result = this.base?.render() ?? "";
      if (this.vap.length > 0) result += ` ${this.vap.join("-")}`;
      if (this.edition !== undefined) result += ` ED${this.edition}`;
      return result;
    }
  }
  registerType(IecVapIdentifier as unknown as IdentifierStatic);
  return IecVapIdentifier as unknown as IdentifierStatic;
}

function iecConsolidatedClass(): IdentifierStatic {
  class IecConsolidatedIdentifier extends IecIdentifier {
    static polymorphicName = "pubid:iec:consolidated-identifier";
    static attributes = extendAttributes(BaseIdentifier, {
      identifiers: { type: IecIdentifier as unknown as IdentifierStatic, collection: true, initializeEmpty: true },
    });
    static mappings = keyValue({ wire: "identifiers", to: "identifiers" });

    declare readonly identifiers: IecIdentifier[];

    render(): string {
      return this.identifiers
        .map((id, idx) => {
          if (idx === 0) return id.render();
          const kind = id.constructor.polymorphicName.slice("pubid:iec:".length);
          const date = id.date?.render();
          if (kind === "amendment") return date !== undefined && date !== "" ? `+AMD${id.number}:${date}` : `+AMD${id.number}`;
          if (kind === "corrigendum") return date !== undefined && date !== "" ? `+COR${id.number}:${date}` : `+COR${id.number}`;
          return `+${id.render()}`;
        })
        .join("");
    }
  }
  registerType(IecConsolidatedIdentifier as unknown as IdentifierStatic);
  return IecConsolidatedIdentifier as unknown as IdentifierStatic;
}

function iecFragmentClass(): IdentifierStatic {
  class IecFragmentIdentifier extends IecIdentifier {
    static polymorphicName = "pubid:iec:fragment-identifier";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: IecIdentifier as unknown as IdentifierStatic },
      fragment_number: { type: "string" },
      edition: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "base", to: "base" },
      { wire: "edition", to: "edition" },
      { wire: "fragment_number", to: "fragment_number" },
    );

    declare readonly fragment_number: string | undefined;

    render(): string {
      const base = this.base;
      let result = base?.render() ?? "";
      const isCorr = base?.constructor.polymorphicName === "pubid:iec:corrigendum";
      result += isCorr ? `/FRAGC${this.fragment_number}` : `/FRAG${this.fragment_number}`;
      if (this.edition !== undefined) result += ` ED${this.edition}`;
      return result;
    }
  }
  registerType(IecFragmentIdentifier as unknown as IdentifierStatic);
  return IecFragmentIdentifier as unknown as IdentifierStatic;
}

const SINGLE_KINDS: IecTypeCode[] = ["is", "tr", "ts", "pas", "srd", "od", "guide"];

const KIND_CLASSES: Partial<Record<IecTypeCode, IdentifierStatic>> = {};
for (const kind of SINGLE_KINDS) {
  KIND_CLASSES[kind] = iecSingleClass(kind);
}
KIND_CLASSES["wp"] = iecWorkingDocumentClass();
KIND_CLASSES["trf"] = iecTrfClass();
KIND_CLASSES["amd"] = iecSupplementClass("amendment");
KIND_CLASSES["cor"] = iecSupplementClass("corrigendum");
KIND_CLASSES["ish"] = iecSupplementClass("interpretation-sheet");
const SHEET_CLASS = iecSheetClass();
const VAP_CLASS = iecVapClass();
const CONSOLIDATED_CLASS = iecConsolidatedClass();
const FRAGMENT_CLASS = iecFragmentClass();

export const IEC_CLASSES = {
  KIND_CLASSES,
  SHEET_CLASS,
  VAP_CLASS,
  CONSOLIDATED_CLASS,
  FRAGMENT_CLASS,
} as const;
