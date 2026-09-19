import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue, type FieldMapping } from "../../model/attribute.js";
import { PubidDate } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/cen_cenelec: the flat wire shape (publisher and
 * copublishers as bare strings, a supplement's number/year/month on the
 * same keys as a document, a draft stage as one code), the class family
 * (documents, supplements, consolidated, adopted) and the renderer/URN.
 */

export interface CenTypedStage {
  code: string;
  stage_code: string;
  type_code: string;
  abbr: string;
}

export const TYPED_STAGES: CenTypedStage[] = [
  { code: "pwien", stage_code: "preliminary", type_code: "en", abbr: "pWI EN" },
  { code: "pren", stage_code: "proposal", type_code: "en", abbr: "prEN" },
  { code: "fpren", stage_code: "final_proposal", type_code: "en", abbr: "FprEN" },
  { code: "fven", stage_code: "formal_vote", type_code: "en", abbr: "FV prEN" },
  { code: "ven", stage_code: "vote", type_code: "en", abbr: "vEN" },
  { code: "puben", stage_code: "published", type_code: "en", abbr: "EN" },
  { code: "rven", stage_code: "review", type_code: "en", abbr: "rvEN" },
  { code: "racen", stage_code: "reactivation", type_code: "en", abbr: "racEN" },
  { code: "wden", stage_code: "withdrawn", type_code: "en", abbr: "wdEN" },
  { code: "pubts", stage_code: "published", type_code: "ts", abbr: "TS" },
  { code: "prts", stage_code: "proposal", type_code: "ts", abbr: "prTS" },
  { code: "pubtr", stage_code: "published", type_code: "tr", abbr: "TR" },
  { code: "pubcwa", stage_code: "published", type_code: "cwa", abbr: "CWA" },
  { code: "pubguide", stage_code: "published", type_code: "guide", abbr: "Guide" },
  { code: "pubhd", stage_code: "published", type_code: "hd", abbr: "HD" },
  { code: "pubes", stage_code: "published", type_code: "es", abbr: "ES" },
  { code: "pubcr", stage_code: "published", type_code: "cr", abbr: "CR" },
  { code: "pubenv", stage_code: "published", type_code: "env", abbr: "ENV" },
];

export const DEFAULT_TYPED_STAGE = TYPED_STAGES.find((s) => s.code === "puben")!;

export function locateStage(abbr: string): CenTypedStage | undefined {
  const up = abbr.toUpperCase();
  return TYPED_STAGES.find((s) => s.abbr.toUpperCase() === up);
}

export function locateStageByCode(code: string): CenTypedStage | undefined {
  return TYPED_STAGES.find((s) => s.code === code);
}

export const PUBLISHER_TYPES = ["CWA", "HD", "ES", "CR", "ENV"];

export type TypeKey =
  | "en" | "ts" | "tr" | "guide" | "cwa" | "hd" | "es" | "cr" | "env";

const TYPE_CLASS: Record<TypeKey, string> = {
  en: "european-norm",
  ts: "technical-specification",
  tr: "technical-report",
  guide: "guide",
  cwa: "cen-workshop-agreement",
  hd: "harmonization-document",
  es: "european-specification",
  cr: "cen-report",
  env: "european-prestandard",
};

const CLASS_SHORT: Record<string, string> = {
  "european-norm": "EN",
  "technical-specification": "TS",
  "technical-report": "TR",
  guide: "Guide",
  "cen-workshop-agreement": "CWA",
  "harmonization-document": "HD",
  "cenelec-harmonization-document": "HD",
  "european-specification": "ES",
  "cen-report": "CR",
  "european-prestandard": "ENV",
};

export function locateTypeClass(typeCode: string): TypeKey | undefined {
  const key = typeCode as TypeKey;
  return key in TYPE_CLASS ? key : undefined;
}

const dateWire: FieldMapping = {
  wire: "date",
  to: "date",
  toWire: (model) => {
    const date = model["date"] as PubidDate | undefined;
    if (date === undefined) return undefined;
    // The shared flattener turns a single-field date into the bare "year"
    // scalar; a month keeps the nested form.
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
};

const stageWire: FieldMapping = {
  wire: "stage",
  to: "typedStage",
  toWire: (model) => {
    const stage = model["typedStage"] as CenTypedStage | undefined;
    return stage?.code;
  },
  fromWire: (hash) => {
    const code = hash["stage"];
    if (typeof code !== "string") return undefined;
    return locateStageByCode(code);
  },
};

export abstract class CenIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    number: { type: "string" },
    part: { type: "string" },
    date: { type: PubidDate },
    typedStage: { type: "string" },
    type: { type: "string" },
    publisher: { type: "string" },
    copublishers: { type: "string", collection: true },
  });
  static mappings: FieldMapping[] = keyValue(
    { wire: "number", to: "number" },
    { wire: "part", to: "part" },
    dateWire,
    stageWire,
    { wire: "publisher", to: "publisher" },
    { wire: "copublishers", to: "copublishers" },
  );

  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly typedStage: CenTypedStage | undefined;
  declare readonly type: string | undefined;
  declare readonly publisher: string | undefined;
  declare readonly copublishers: string[] | undefined;

  root(): CenIdentifier {
    return this;
  }

  toUrn(): string {
    return new CenUrnGenerator(this).generate();
  }
}

function draftAbbr(id: CenIdentifier): string | undefined {
  const abbr = id.typedStage?.abbr;
  return abbr === "prEN" || abbr === "FprEN" ? abbr : undefined;
}

function supplementToken(id: CenIdentifier): string {
  const self = id as unknown as Record<string, unknown>;
  const prefix = self["_supplement"] === "corrigendum" ? "AC" : "A";
  let result = `${prefix}${self["number"] ?? ""}`;
  if (self["year"] !== undefined && self["year"] !== "") {
    result += `:${self["year"]}`;
    if (self["month"] !== undefined && self["month"] !== "") result += `-${self["month"]}`;
  }
  return result;
}

function renderSingle(id: CenIdentifier, classShort: string): string {
  const parts: string[] = [];
  const isDraftStage = draftAbbr(id) !== undefined;
  const typeShort = isDraftStage
    ? id.typedStage!.type_code.toUpperCase()
    : id.type ?? classShort ?? "EN";

  let useSlashBeforeType = false;
  if (PUBLISHER_TYPES.includes(typeShort)) {
    parts.push(id.typedStage !== undefined && id.typedStage.abbr !== typeShort
      ? id.typedStage.abbr
      : typeShort);
  } else if (isDraftStage) {
    parts.push(id.typedStage!.abbr);
  } else if (id.publisher !== undefined) {
    parts.push(id.publisher);
    useSlashBeforeType = true;
  }

  if (id.copublishers !== undefined && id.copublishers.length > 0) {
    const copubStr = id.copublishers.join("/");
    if (parts.length > 0) {
      parts[parts.length - 1] = `${parts[parts.length - 1]}/${copubStr}`;
    } else {
      parts.push(copubStr);
    }
  }

  if (typeShort !== "EN" && typeShort !== "Guide" && !PUBLISHER_TYPES.includes(typeShort)) {
    parts.push(useSlashBeforeType && parts.length > 0 ? `/${typeShort}` : typeShort);
  } else if (typeShort === "Guide") {
    parts.push("Guide");
  }

  if (id.number !== undefined) {
    parts.push(id.part !== undefined ? `${id.number}-${id.part}` : id.number);
  }

  let result = "";
  parts.forEach((part, idx) => {
    if (idx > 0 && !part.startsWith("/")) result += " ";
    result += part;
  });

  if (id.date !== undefined && id.date.present()) {
    result += `:${id.date.render()}`;
  }
  return result;
}

function renderAdopted(id: CenIdentifier): string {
  const publishers = [id.publisher, ...(id.copublishers ?? [])].filter(
    (p): p is string => p !== undefined && p !== "",
  );
  const draft = draftAbbr(id);
  if (draft !== undefined && publishers.length > 0) publishers[0] = draft;
  let result = publishers.join("/");
  const adopted = (id as unknown as Record<string, unknown>)["adopted"];
  if (adopted !== undefined) result += ` ${(adopted as CenIdentifier).toHuman()}`;
  return result;
}

const ISO_TYPE_SEGMENT: Record<string, string> = {
  "technical-specification": "ts",
  "technical-report": "tr",
  guide: "guide",
};

/** MR string of a nested iso/iec document read from its wire hash. */
function mrFromHash(hash: Record<string, unknown>): string {
  const type = String(hash["_type"] ?? "");
  const segments: string[] = [];
  if (type.startsWith("pubid:iso")) segments.push("iso");
  else if (type.startsWith("pubid:iec")) segments.push("iec");
  const typeSuffix = type.split(":")[2] ?? "";
  const typeSegment = ISO_TYPE_SEGMENT[typeSuffix];
  if (typeSegment !== undefined) segments.push(typeSegment);
  const identity = [hash["number"], hash["part"], hash["subpart"]]
    .map((s) => String(s ?? ""))
    .filter((s) => s !== "")
    .join("-");
  if (identity !== "") segments.push(identity);
  if (hash["year"] !== undefined) segments.push(String(hash["year"]));

  const base = hash["base"];
  if (base !== undefined && typeof base === "object" && !Array.isArray(base)) {
    const baseMr = mrFromHash(base as Record<string, unknown>);
    const suffixTag = typeSuffix.endsWith("amendment") ? "amd" : "cor";
    const suffix = [hash["number"], hash["year"]]
      .map((s) => String(s ?? ""))
      .filter((s) => s !== "")
      .map((s, i) => (i === 0 ? s : `.${s}`))
      .join("");
    return suffix === "" ? `${baseMr}_${suffixTag}` : `${baseMr}_${suffixTag}.${suffix}`;
  }
  return segments.join(".");
}

// --- URN -----------------------------------------------------------------------

class CenUrnGenerator extends BaseUrnGenerator<CenIdentifier> {
  generate(): string {
    return this.urnFor(this.identifier);
  }

  private urnFor(id: CenIdentifier): string {
    const self = id as unknown as Record<string, unknown>;
    const base = self["base"] as CenIdentifier | undefined;
    if (base !== undefined) {
      return [this.urnFor(base), ...this.supplementSegments(id)].join(":");
    }
    const identifiers = self["identifiers"] as CenIdentifier[] | undefined;
    if (identifiers !== undefined) {
      const [first, ...rest] = identifiers;
      return [
        this.urnFor(first!),
        ...rest.flatMap((s) => ["plus", ...this.supplementSegments(s)]),
      ].join(":");
    }
    const adopted = self["adopted"] as CenIdentifier | undefined;
    if (adopted !== undefined) {
      const body = [this.mrPublisher(id), this.adoptedMr(adopted)]
        .filter((s) => s !== undefined && s !== "")
        .join(".")
        .replaceAll(".", ":")
        .replaceAll("_", ":");
      const segments = [`urn:cen:${body}`];
      const code = id.typedStage?.stage_code;
      if (code !== undefined && code !== "published") segments.push(`stage.${code}`);
      return segments.join(":");
    }
    return this.baseUrn(id);
  }

  private supplementSegments(id: CenIdentifier): string[] {
    const self = id as unknown as Record<string, unknown>;
    if (self["_supplement"] === "fragment") {
      return ["frag", String(self["number"] ?? "")].filter((s) => s !== "");
    }
    if (self["_supplement"] === "corrigendum") {
      const segments = ["cor", self["number"], this.supplementDate(self)];
      return segments.map((s) => String(s ?? "")).filter((s) => s !== "");
    }
    const segments = ["amd", self["number"], self["year"]];
    return segments.map((s) => String(s ?? "")).filter((s) => s !== "");
  }

  private supplementDate(id: Record<string, unknown>): string | undefined {
    const year = id["year"];
    if (year === undefined || year === "") return undefined;
    return [year, id["month"]].filter((m) => m !== undefined && m !== "").join("-");
  }

  private mrPublisher(id: CenIdentifier): string {
    return (id.publisher ?? "en").toLowerCase();
  }

  /** The adopted document's MR string (iso/iec supplement recursion). */
  private adoptedMr(adopted: CenIdentifier): string {
    return mrFromHash(adopted.toHash());
  }

  private baseUrn(id: CenIdentifier): string {
    const parts = ["urn", "cen", (id.publisher ?? "en").toLowerCase()];
    if (id.copublishers !== undefined && id.copublishers.length > 0) {
      parts[2] = `${parts[2]}-${id.copublishers.map((c) => c.toLowerCase()).join("-")}`;
    }
    if (id.number !== undefined) {
      parts.push(id.part !== undefined ? `${id.number}-${id.part}` : id.number);
    }
    if (id.date !== undefined && id.date.present()) {
      parts.push(id.date.render("urn") as string);
    }
    const code = id.typedStage?.stage_code;
    if (code !== undefined && code !== "published") parts.push(`stage.${code}`);
    return parts.join(":");
  }
}

// --- Class family --------------------------------------------------------------

interface DocSpec {
  kind: string;
  short: string;
}

function documentClass(spec: DocSpec): IdentifierStatic {
  const defaultPublisher = PUBLISHER_TYPES.includes(spec.short) ? spec.short : "EN";
  class CenConcrete extends CenIdentifier {
    static polymorphicName = `pubid:cencenelec:${spec.kind}`;
    static urnGenerator = CenUrnGenerator;
    static get attributes() {
      return extendAttributes(CenIdentifier, {
        publisher: { type: "string", default: defaultPublisher },
        type: { type: "string", default: spec.short },
        adopted: { type: CenIdentifier as unknown as IdentifierStatic },
      });
    }
    static get mappings() {
      return [...CenIdentifier.mappings, { wire: "adopted", to: "adopted" } as FieldMapping];
    }

    declare readonly adopted: CenIdentifier | undefined;

    constructor(attrs: Record<string, unknown> = {}) {
      super(attrs);
      // An ENV adoption renders "ENV <adopted>" (render_european_prestandard).
      if (this.adopted !== undefined) {
        (this as unknown as Record<string, unknown>)["_envAdopted"] = true;
      }
    }

    render(): string {
      if (this.adopted !== undefined) {
        return `${spec.short} ${this.adopted.toHuman()}`;
      }
      return renderSingle(this, spec.short);
    }

    root(): CenIdentifier {
      return this;
    }

    toUrn(): string {
      if (this.adopted !== undefined) {
        const body = [spec.short.toLowerCase(), this.adoptedUrnBody()]
          .filter((s) => s !== "")
          .join(":");
        return `urn:cen:${body}`;
      }
      
      return super.toUrn();
    }

    private adoptedUrnBody(): string {
      const adopted = this.adopted as unknown as Record<string, unknown>;
      const rawPub = adopted["publisher"];
      const pub = (
        typeof rawPub === "string"
          ? rawPub
          : typeof (rawPub as { publisher?: string })?.publisher === "string"
            ? (rawPub as { publisher: string }).publisher
            : String((rawPub as { body?: string })?.body ?? "")
      ).toLowerCase();
      const rawType = adopted["type"];
      const typeKey = (this.adopted!.constructor as unknown as { typeKey?: string }).typeKey;
      const type = typeKey !== undefined && typeKey !== "is"
        ? typeKey
        : (
            typeof rawType === "string" ? rawType : String((rawType as { abbr?: string })?.abbr ?? "")
          ).toLowerCase();
      const segments = [
        pub,
        type,
        [adopted["number"], adopted["part"], adopted["subpart"]]
          .map((s) => String(s ?? ""))
          .filter((s) => s !== "")
          .join("-"),
        adopted["year"] ?? this.adopted?.date?.year,
      ]
        .map((s) => String(s ?? ""))
        .filter((s) => s !== "");
      return segments.join(":");
    }
  }
  registerType(CenConcrete as unknown as IdentifierStatic);
  return CenConcrete as unknown as IdentifierStatic;
}

export const CEN_DOCUMENT_CLASSES = new Map<string, IdentifierStatic>(
  (Object.keys(TYPE_CLASS) as TypeKey[]).map((key) => [
    key,
    documentClass({ kind: TYPE_CLASS[key], short: CLASS_SHORT[TYPE_CLASS[key]]! }),
  ]),
);
// The CENELEC HD variant has its own _type; the builder routes plain HD to
// the CEN class (Ruby's registry finds it first).
export const CenelecHarmonizationDocumentClass = documentClass({
  kind: "cenelec-harmonization-document",
  short: "HD",
});

function supplementClass(
  kind: "amendment" | "corrigendum" | "fragment",
  extraDefs: Record<string, unknown>,
): IdentifierStatic {
  class CenSupplement extends CenIdentifier {
    static polymorphicName = `pubid:cencenelec:${kind}`;
    static urnGenerator = CenUrnGenerator;
    static get attributes() {
      return extendAttributes(CenIdentifier, {
        base: { type: CenIdentifier as unknown as IdentifierStatic },
        ...extraDefs,
      });
    }
    static get mappings() {
      return [
        ...CenIdentifier.mappings.filter((m) => m.wire !== "publisher" && m.wire !== "copublishers" && m.wire !== "date" && m.wire !== "stage" && m.wire !== "type"),
        { wire: "base", to: "base" },
        { wire: "number", to: "number" },
        { wire: "year", to: "year" },
        ...(kind === "corrigendum" ? [{ wire: "month", to: "month" } as FieldMapping] : []),
      ];
    }

    declare readonly base: CenIdentifier | undefined;
    declare readonly year: string | undefined;
    declare readonly month: string | undefined;

    constructor(attrs: Record<string, unknown> = {}) {
      super(attrs);
      (this as unknown as Record<string, unknown>)["_supplement"] = kind;
    }

    render(): string {
      const self = this as unknown as Record<string, unknown>;
      self["_supplement"] = kind;
      if (kind === "fragment") {
        return `${this.base?.toHuman() ?? ""} FRAG${this.number ?? ""}`;
      }
      return `${this.base?.toHuman() ?? ""}/${supplementToken(this)}`;
    }

    root(): CenIdentifier {
      return this.base?.root() ?? this;
    }
  }
  registerType(CenSupplement as unknown as IdentifierStatic);
  return CenSupplement as unknown as IdentifierStatic;
}

export const AmendmentClass = supplementClass("amendment", { year: { type: "string" } });
export const CorrigendumClass = supplementClass(
  "corrigendum",
  { year: { type: "string" }, month: { type: "string" } },
);
export const FragmentClass = supplementClass("fragment", {});

export const ConsolidatedIdentifierClass = (() => {
  class CenConsolidated extends CenIdentifier {
    static polymorphicName = "pubid:cencenelec:consolidated-identifier";
    static urnGenerator = CenUrnGenerator;
    static get attributes() {
      return extendAttributes(CenIdentifier, {
        identifiers: { type: CenIdentifier as unknown as IdentifierStatic, collection: true },
      });
    }
    static get mappings() {
      return [{ wire: "identifiers", to: "identifiers" } as FieldMapping];
    }

    declare readonly identifiers: CenIdentifier[];

    render(): string {
      const [base, ...supplements] = this.identifiers;
      return (
        (base?.toHuman() ?? "") +
        supplements
          .map((sub) => {
            const self = sub as unknown as Record<string, unknown>;
            return `+${supplementToken(sub)}`;
          })
          .join("")
      );
    }

    root(): CenIdentifier {
      return this.identifiers[0]?.root() ?? this;
    }
  }
  registerType(CenConsolidated as unknown as IdentifierStatic);
  return CenConsolidated as unknown as IdentifierStatic;
})();

export const AdoptedEuropeanNormClass = (() => {
  class CenAdopted extends CenIdentifier {
    static polymorphicName = "pubid:cencenelec:adopted-european-norm";
    static urnGenerator = CenUrnGenerator;
    static get attributes() {
      return extendAttributes(CenIdentifier, {
        publisher: { type: "string", default: "EN" },
        adopted: { type: CenIdentifier as unknown as IdentifierStatic },
      });
    }
    static get mappings() {
      return [
        { wire: "publisher", to: "publisher" } as FieldMapping,
        { wire: "copublishers", to: "copublishers" } as FieldMapping,
        stageWire,
        { wire: "adopted", to: "adopted" } as FieldMapping,
      ];
    }

    declare readonly adopted: CenIdentifier | undefined;

    render(): string {
      return renderAdopted(this);
    }

    root(): CenIdentifier {
      return this;
    }
  }
  registerType(CenAdopted as unknown as IdentifierStatic);
  return CenAdopted as unknown as IdentifierStatic;
})();

export const EuropeanPrestandardClass = CEN_DOCUMENT_CLASSES.get("env")!;

export const EuropeanNormClass = CEN_DOCUMENT_CLASSES.get("en")!;
