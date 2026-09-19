import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue, type AttributeTable, type FieldMapping } from "../../model/attribute.js";
import { Language, PubidDate } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/idf: the typed-stage registry (is/rm/amd/cor), the
 * nested Type/Stage/TypedStage wire objects, supplements carrying a base,
 * the renderer and the URN generator.
 */

export interface IdfTypedStage {
  name: string;
  code: string;
  type_code: string;
  stage_code?: string;
  abbr: string[];
  harmonized_stages?: string[];
  short_abbr?: string;
  long_abbr?: string;
}

export const IS_STAGES: IdfTypedStage[] = [
  { name: "Proposed Work Item for International Standard", code: "pwiis", type_code: "is", stage_code: "pwi", abbr: ["PWI"], harmonized_stages: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"] },
  { name: "New Work Item Proposal for International Standard", code: "isnp", type_code: "is", stage_code: "np", abbr: ["NP", "NWIP"], harmonized_stages: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"] },
  { name: "Approved Work Item for International Standard", code: "awiis", type_code: "is", stage_code: "awi", abbr: ["AWI"], harmonized_stages: ["10.99", "20.00"] },
  { name: "Working Draft for International Standard", code: "wdis", type_code: "is", stage_code: "wd", abbr: ["WD"], harmonized_stages: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"] },
  { name: "Committee Draft for International Standard", code: "cdis", type_code: "is", stage_code: "cd", abbr: ["CD"], harmonized_stages: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"] },
  { name: "Final Committee Draft for International Standard", code: "fcdis", type_code: "is", stage_code: "fcd", abbr: ["FCD"], harmonized_stages: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"] },
  { name: "Draft International Standard", code: "dis", type_code: "is", stage_code: "dis", abbr: ["DIS", "FPD"], harmonized_stages: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"] },
  { name: "Final Draft International Standard", code: "fdis", type_code: "is", stage_code: "fdis", abbr: ["FDIS"], harmonized_stages: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"] },
  { name: "Proof International Standard", code: "prfis", type_code: "is", stage_code: "prf", abbr: ["PRF", "Fpr"], harmonized_stages: ["60.00"] },
  { name: "International Standard", code: "is", type_code: "is", stage_code: "published", abbr: [""], harmonized_stages: ["60.00", "60.60"] },
  { name: "Proposed for Withdrawal", code: "wdr", type_code: "is", stage_code: "wdr", abbr: ["WDR"], harmonized_stages: ["90.92"] },
  { name: "Withdrawal Approved", code: "wda", type_code: "is", stage_code: "wda", abbr: ["WDA"], harmonized_stages: ["90.93"] },
  { name: "Withdrawal Archived", code: "wdar", type_code: "is", stage_code: "wdar", abbr: ["WDAR"], harmonized_stages: ["95.99"] },
];

export const RM_STAGES: IdfTypedStage[] = [
  { name: "Proposed Work Item for Reviewed Method", code: "pwirm", type_code: "rm", stage_code: "pwi", abbr: ["PWI RM"], harmonized_stages: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"] },
  { name: "New Work Item Proposal for Reviewed Method", code: "nprm", type_code: "rm", stage_code: "np", abbr: ["NP RM"], harmonized_stages: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"] },
  { name: "Approved Work Item for Reviewed Method", code: "awirm", type_code: "rm", stage_code: "awi", abbr: ["AWI RM"], harmonized_stages: ["10.99", "20.00"] },
  { name: "Working Draft Reviewed Method", code: "wdrm", type_code: "rm", stage_code: "wd", abbr: ["WD RM"], harmonized_stages: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"] },
  { name: "Committee Draft Reviewed Method", code: "cdrm", type_code: "rm", stage_code: "cd", abbr: ["CD RM"], harmonized_stages: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"] },
  { name: "Proposed Draft Reviewed Method", code: "pdrm", type_code: "rm", stage_code: "cd", abbr: ["PDRM"], harmonized_stages: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"] },
  { name: "Draft Reviewed Method", code: "drm", type_code: "rm", abbr: ["DRM"], harmonized_stages: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"] },
  { name: "Final Draft Reviewed Method", code: "fdrm", type_code: "rm", abbr: ["FDRM"], harmonized_stages: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"] },
  { name: "Proof Reviewed Method", code: "prfrm", type_code: "rm", stage_code: "prf", abbr: ["PRF RM"], harmonized_stages: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"] },
  { name: "Published Reviewed Method", code: "pubrm", type_code: "rm", stage_code: "published", abbr: ["RM"], harmonized_stages: ["60.00", "60.60"] },
];

export const AMD_STAGE: IdfTypedStage = {
  name: "Amendment", code: "published", type_code: "amd", stage_code: "published",
  abbr: ["AMD"], short_abbr: "AMD", long_abbr: "AMD",
};

export const COR_STAGE: IdfTypedStage = {
  name: "Corrigendum", code: "published", type_code: "cor", stage_code: "published",
  abbr: ["COR"], short_abbr: "COR", long_abbr: "COR",
};

const ALL_STAGES = [...IS_STAGES, ...RM_STAGES, AMD_STAGE, COR_STAGE];

export function locateStage(abbr: string): IdfTypedStage | undefined {
  const needle = abbr.trim();
  if (needle === "") return IS_STAGES.find((s) => s.code === "is");
  return ALL_STAGES.find((s) => s.abbr.some((a) => a === needle));
}

export function locateStageByTypeCode(typeCode: string): IdfTypedStage | undefined {
  return ALL_STAGES.find((s) => s.type_code === typeCode && s.stage_code === "published")
    ?? ALL_STAGES.find((s) => s.type_code === typeCode);
}

// --- Wire shapes -------------------------------------------------------------------

export class IdfTypedStageComponent {
  constructor(readonly record: IdfTypedStage) {}

  get abbrFirst(): string {
    return this.record.abbr[0] ?? "";
  }

  /** abbreviation: short/long override else abbr[0]. */
  abbreviation(formatLong = true): string {
    if (formatLong && this.record.long_abbr !== undefined) return this.record.long_abbr;
    if (!formatLong && this.record.short_abbr !== undefined) return this.record.short_abbr;
    return this.abbrFirst;
  }

  typeWire(): Record<string, unknown> {
    const out: Record<string, unknown> = { name: this.record.name, type_code: this.record.type_code };
    if (this.abbrFirst !== "") out["abbr"] = this.abbrFirst;
    return out;
  }

  stageWire(): Record<string, unknown> {
    const out: Record<string, unknown> = { name: this.record.name };
    if (this.record.stage_code !== undefined) out["stage_code"] = this.record.stage_code;
    if (this.abbrFirst !== "") out["abbr"] = this.abbrFirst;
    if (this.record.harmonized_stages !== undefined) out["harmonized_stages"] = this.record.harmonized_stages;
    return out;
  }

  toWire(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      name: this.record.name,
      code: this.record.code,
      type_code: this.record.type_code,
      ...(this.record.stage_code !== undefined ? { stage_code: this.record.stage_code } : {}),
      abbr: this.record.abbr,
    };
    if (this.record.harmonized_stages !== undefined) out["harmonized_stages"] = this.record.harmonized_stages;
    if (this.record.short_abbr !== undefined) out["short_abbr"] = this.record.short_abbr;
    if (this.record.long_abbr !== undefined) out["long_abbr"] = this.record.long_abbr;
    return out;
  }

  static fromWire(hash: Record<string, unknown>): IdfTypedStageComponent | undefined {
    const abbr = Array.isArray(hash["abbr"]) ? (hash["abbr"] as string[]).map(String) : [];
    const match = ALL_STAGES.find(
      (s) => s.abbr.length === abbr.length && s.abbr.every((a, i) => a === abbr[i]) && s.code === hash["code"],
    );
    return match === undefined ? undefined : new IdfTypedStageComponent(match);
  }
}

const publisherWire: FieldMapping = {
  wire: "publisher",
  to: "publisherBody",
  toWire: (model) => {
    const body = model["publisherBody"];
    return body === undefined ? undefined : { body };
  },
  fromWire: (hash) => {
    const value = hash["publisher"];
    if (value === undefined || typeof value !== "object") return undefined;
    return String((value as Record<string, unknown>)["body"] ?? "");
  },
};

const typedStageObjWire: FieldMapping = {
  wire: "typed_stage",
  to: "typedStage",
  toWire: (model) => {
    const stage = model["typedStage"];
    return stage instanceof IdfTypedStageComponent ? stage.toWire() : undefined;
  },
  fromWire: (hash) => {
    const value = hash["typed_stage"];
    if (value === undefined || typeof value !== "object" || Array.isArray(value)) return undefined;
    return IdfTypedStageComponent.fromWire(value as Record<string, unknown>);
  },
};

// --- The identifier base --------------------------------------------------------

export abstract class IdfIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    publisherBody: { type: "string" },
    number: { type: "string" },
    part: { type: "string" },
    subpart: { type: "string" },
    date: { type: PubidDate },
    languages: { type: Language, collection: true },
    all_parts: { type: "boolean", default: false },
  });
  static mappings: FieldMapping[] = keyValue(
    publisherWire,
    { wire: "number", to: "number" },
    { wire: "part", to: "part" },
    { wire: "subpart", to: "subpart" },
    {
      wire: "date",
      to: "date",
      toWire: (model) => {
        const date = model["date"] as PubidDate | undefined;
        if (date === undefined) return undefined;
        if (date.month === undefined) return { year: date.year };
        return { year: date.year, month: date.month };
      },
      fromWire: (hash) => {
        const nested = hash["date"];
        if (nested !== undefined && typeof nested === "object" && nested !== null) {
          const rec = nested as Record<string, unknown>;
          return new PubidDate({ year: rec["year"], month: rec["month"] });
        }
        const year = hash["year"];
        if (typeof year === "string" && year !== "") return new PubidDate({ year });
        return undefined;
      },
    },
    { wire: "languages", to: "languages" },
    { wire: "all_parts", to: "all_parts" },
  );

  declare readonly publisherBody: string;
  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly subpart: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly languages: Language[] | undefined;
  declare readonly all_parts: boolean | undefined;

  root(): IdfIdentifier {
    return this;
  }
}

function languagePortion(id: IdfIdentifier): string {
  if (id.languages === undefined || id.languages.length === 0) return "";
  return `(${id.languages.map((l) => l.code).join(",")})`;
}

function numberPortion(id: IdfIdentifier): string {
  const self = id as unknown as Record<string, unknown>;
  const iter = self["stageIteration"];
  return [
    id.number !== undefined ? ` ${id.number}` : "",
    id.part !== undefined ? `-${id.part}` : "",
    id.subpart !== undefined ? `-${id.subpart}` : "",
    iter !== undefined ? `.${iter}` : "",
    id.date?.present() ? `:${id.date.render()}` : "",
    languagePortion(id),
  ].join("");
}

function renderSingle(id: IdfIdentifier): string {
  const stage = (id as unknown as Record<string, unknown>)["typedStage"] as IdfTypedStageComponent | undefined;
  const abbr = stage === undefined ? "" : stage.abbreviation();
  return ["IDF", abbr === "" ? "" : `/${abbr}`].join("") + numberPortion(id);
}

// --- URN generator ---------------------------------------------------------------

class IdfUrnGenerator extends BaseUrnGenerator<IdfIdentifier> {
  generate(): string {
    const id = this.identifier;
    const self = id as unknown as Record<string, unknown>;
    const stage = self["typedStage"] as IdfTypedStageComponent | undefined;
    const typeAbbr = stage === undefined ? "" : stage.abbrFirst;
    const parts = ["urn", "idf"];
    if (id.number !== undefined) parts.push(id.number);
    // The URN keeps each part's leading dash (UrnGenerator::Base urn_part).
    if (id.part !== undefined) parts.push(`-${id.part}`);
    if (id.subpart !== undefined) parts.push(`-${id.subpart}`);
    if (id.date?.year !== undefined) parts.push(id.date.year);
    // urn_type: the type abbreviation lowercased, "" when absent (the
    // published IS keeps an empty trailing segment).
    parts.push(typeAbbr.toLowerCase());
    if (id.languages !== undefined && id.languages.length > 0) {
      parts.push(id.languages.map((l) => l.code).join(","));
    }
    if (self["base"] !== undefined) {
      if (stage !== undefined) parts.push(stage.record.type_code);
      if (id.number !== undefined) parts.push(id.number);
    }
    return parts.join(":");
  }
}

// --- Class family ----------------------------------------------------------------

interface DocSpec {
  kind: string;
  typeCode: string;
}

function documentClass(spec: DocSpec): IdentifierStatic {
  class IdfConcrete extends IdfIdentifier {
    static polymorphicName = `pubid:idf:${spec.kind}`;
    static urnGenerator = IdfUrnGenerator;
    static get attributes() {
      return extendAttributes(IdfIdentifier, {
        typedStage: { type: "string" },
      });
    }
    static get mappings() {
      const stage = locateStageByTypeCode(spec.typeCode)!;
      return [
        ...IdfIdentifier.mappings,
        {
          wire: "type",
          to: "typedStage",
          toWire: (model: Record<string, unknown>) => {
            const s = model["typedStage"];
            return s instanceof IdfTypedStageComponent ? s.typeWire() : undefined;
          },
          fromWire: () => undefined,
        } as FieldMapping,
        {
          wire: "stage",
          to: "typedStage",
          toWire: (model: Record<string, unknown>) => {
            const s = model["typedStage"];
            return s instanceof IdfTypedStageComponent ? s.stageWire() : undefined;
          },
          fromWire: () => undefined,
        } as FieldMapping,
        typedStageObjWire,
      ];
    }

    declare readonly typedStage: IdfTypedStageComponent | undefined;

    constructor(attrs: Record<string, unknown> = {}) {
      super(attrs);
      const self = this as unknown as Record<string, unknown>;
      // The publisher body defaults to IDF on the instance (NOT via a
      // spec default — a default-equal scalar would drop off the wire,
      // but the nested publisher object always serializes).
      if (self["publisherBody"] === undefined) self["publisherBody"] = "IDF";
      if (self["typedStage"] === undefined) {
        self["typedStage"] = new IdfTypedStageComponent(locateStageByTypeCode(spec.typeCode)!);
      }
    }

    render(): string {
      return renderSingle(this);
    }

    toUrn(): string {
      return new IdfUrnGenerator(this).generate();
    }
  }
  void spec;
  registerType(IdfConcrete as unknown as IdentifierStatic);
  return IdfConcrete as unknown as IdentifierStatic;
}

export const InternationalStandardClass = documentClass({ kind: "international-standard", typeCode: "is" });
export const ReviewedMethodClass = documentClass({ kind: "reviewed-method", typeCode: "rm" });

function supplementClass(spec: DocSpec, stage: IdfTypedStage): IdentifierStatic {
  class IdfSupplement extends IdfIdentifier {
    static polymorphicName = `pubid:idf:${spec.kind}`;
    static urnGenerator = IdfUrnGenerator;
    static get attributes() {
      return extendAttributes(IdfIdentifier, {
        base: { type: IdfIdentifier as unknown as IdentifierStatic },
        typedStage: { type: "string" },
      });
    }
    static get mappings() {
      // Supplements carry no publisher of their own (Ruby Supplement
      // Identifier delegates to base; the wire drops it).
      return [
        ...IdfIdentifier.mappings.filter((m) => m.wire !== "publisher"),
        { wire: "base", to: "base" } as FieldMapping,
        {
          wire: "type",
          to: "typedStage",
          toWire: (model: Record<string, unknown>) => {
            const s = model["typedStage"];
            return s instanceof IdfTypedStageComponent ? s.typeWire() : undefined;
          },
          fromWire: () => undefined,
        } as FieldMapping,
        {
          wire: "stage",
          to: "typedStage",
          toWire: (model: Record<string, unknown>) => {
            const s = model["typedStage"];
            return s instanceof IdfTypedStageComponent ? s.stageWire() : undefined;
          },
          fromWire: () => undefined,
        } as FieldMapping,
        typedStageObjWire,
      ];
    }

    declare readonly base: IdfIdentifier | undefined;
    declare readonly typedStage: IdfTypedStageComponent | undefined;

    constructor(attrs: Record<string, unknown> = {}) {
      super(attrs);
      const self = this as unknown as Record<string, unknown>;
      if (self["publisherBody"] === undefined) self["publisherBody"] = "IDF";
      if (self["typedStage"] === undefined) {
        self["typedStage"] = new IdfTypedStageComponent(stage);
      }
    }

    render(): string {
      return [
        this.base?.toHuman() ?? "",
        "/",
        this.typedStage!.abbreviation(),
        " ",
        this.number ?? "",
        this.date?.present() ? `:${this.date.render()}` : "",
      ].join("");
    }

    toUrn(): string {
      return new IdfUrnGenerator(this).generate();
    }

    root(): IdfIdentifier {
      return this.base?.root() ?? this;
    }
  }
  registerType(IdfSupplement as unknown as IdentifierStatic);
  return IdfSupplement as unknown as IdentifierStatic;
}

export const AmendmentClass = supplementClass({ kind: "amendment", typeCode: "amd" }, AMD_STAGE);
export const CorrigendumClass = supplementClass({ kind: "corrigendum", typeCode: "cor" }, COR_STAGE);

export const IDF_TYPE_CLASSES: Record<string, IdentifierStatic> = {
  is: InternationalStandardClass,
  rm: ReviewedMethodClass,
  amd: AmendmentClass,
  cor: CorrigendumClass,
};

export const IDF_ATTRIBUTES: AttributeTable = IdfIdentifier.attributes;
