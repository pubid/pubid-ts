import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue, type FieldMapping } from "../../model/attribute.js";
import { PubidDate } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { Component } from "../../model/component.js";

/**
 * Port of lib/pubid/itu/identifiers/* + components/{code,designation}.rb.
 * The wire hash is FLAT (StandardSerialization / the Supplement block):
 * sector/series/number/parts/… are bare top-level scalars read through
 * the ItuCode component; publisher ("ITU") is never serialized
 * (reconstructed on render).
 */

/** Long-form ↔ single-letter language map (Identifiers::Base::LANGUAGES). */
export const ITU_LANGUAGES: Record<string, string> = {
  fr: "F", es: "S", ru: "R", ar: "A", zh: "C", en: "E",
  F: "F", S: "S", R: "R", A: "A", C: "C", E: "E",
};

/** The ITU Code component (Components::Code): [Imp]NUMBER[suffix][.subseries][-parts][qualifier]. */
export class ItuCode extends Component {
  readonly imp_marker?: string | undefined;
  readonly number?: string | undefined;
  readonly series_suffix?: string | undefined;
  readonly series_suffix_spaced: boolean;
  readonly subseries?: string | undefined;
  readonly parts: string[];
  readonly qualifier?: string | undefined;
  readonly qualifier_glued: boolean;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.imp_marker = attrs["imp_marker"] as string | undefined;
    this.number = attrs["number"] as string | undefined;
    this.series_suffix = attrs["series_suffix"] as string | undefined;
    this.series_suffix_spaced = attrs["series_suffix_spaced"] === true;
    this.subseries = attrs["subseries"] as string | undefined;
    this.parts = Array.isArray(attrs["parts"]) ? (attrs["parts"] as string[]) : [];
    this.qualifier = attrs["qualifier"] as string | undefined;
    this.qualifier_glued = attrs["qualifier_glued"] === true;
  }

  render(): string {
    let result = `${this.imp_marker ?? ""}${this.number ?? ""}`;
    if (this.series_suffix !== undefined && !this.series_suffix_spaced) result += this.series_suffix;
    if (this.subseries !== undefined) result += `.${this.subseries}`;
    if (this.parts.length > 0) result += this.parts.map((p) => `-${p}`).join("");
    if (this.qualifier !== undefined && this.qualifier_glued) result += this.qualifier;
    if (this.series_suffix !== undefined && this.series_suffix_spaced) result += ` ${this.series_suffix}`;
    if (this.qualifier !== undefined && !this.qualifier_glued) result += ` ${this.qualifier}`;
    return result;
  }

  /** Space-free form for URN/MR — keeps "D.200" and "D.200 R" distinct. */
  compactS(): string {
    return this.render().replaceAll(" ", "");
  }

  toWire(): Record<string, unknown> {
    return {
      ...(this.imp_marker !== undefined ? { imp_marker: this.imp_marker } : {}),
      ...(this.number !== undefined ? { number: this.number } : {}),
      ...(this.series_suffix !== undefined ? { series_suffix: this.series_suffix } : {}),
      ...(this.series_suffix_spaced ? { series_suffix_spaced: true } : {}),
      ...(this.subseries !== undefined ? { subseries: this.subseries } : {}),
      ...(this.parts.length > 0 ? { parts: this.parts } : {}),
      ...(this.qualifier !== undefined ? { qualifier: this.qualifier } : {}),
      ...(this.qualifier_glued ? { qualifier_glued: true } : {}),
    };
  }
}

/** One "/SERIES.CODE" joint designation (Components::Designation). */
export class ItuDesignation extends Component {
  readonly series?: string | undefined;
  readonly code: ItuCode;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.series = attrs["series"] as string | undefined;
    this.code =
      attrs["code"] instanceof ItuCode
        ? (attrs["code"] as ItuCode)
        : new ItuCode((attrs["code"] as Record<string, unknown>) ?? {});
  }

  render(): string {
    return `${this.series ?? ""}.${this.code.render()}`;
  }

  toWire(): Record<string, unknown> {
    return { series: this.series, code: this.code.toWire() };
  }
}

export abstract class ItuIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    sector: { type: "string" },
    series: { type: "string" },
    code: { type: ItuCode },
    date: { type: PubidDate },
    language: { type: "string" },
    version: { type: "string" },
    series_word: { type: "boolean", default: false },
    series_dash: { type: "boolean", default: false },
    attachment: { type: "boolean", default: false },
    range_end: { type: "string" },
    common_text_twin: { type: "string" },
  });

  declare readonly sector: string | undefined;
  declare readonly series: string | undefined;
  declare readonly code: ItuCode | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly language: string | undefined;
  declare readonly version: string | undefined;
  declare readonly series_word: boolean | undefined;
  declare readonly series_dash: boolean | undefined;
  declare readonly attachment: boolean | undefined;
  declare readonly range_end: string | undefined;
  declare readonly common_text_twin: string | undefined;

  /** Walks `base` to the origin document (Pubid::Identifier#root). */
  root(): ItuIdentifier {
    const base = (this as Record<string, unknown>)["base"];
    return base instanceof ItuIdentifier ? base.root() : this;
  }

  /** " (M/YYYY)" / " (YYYY)" / "" — shared by every dated ITU type. */
  dateSuffix(): string {
    if (!(this.date instanceof PubidDate)) return "";
    return this.date.month !== undefined
      ? ` (${this.date.month}/${this.date.year})`
      : ` (${this.date.year})`;
  }

  languageSuffix(): string {
    if (this.language === undefined) return "";
    return ITU_LANGUAGES[this.language] === undefined ? "" : `-${this.language}`;
  }

  twinSuffix(): string {
    return this.common_text_twin === undefined ? "" : ` | ${this.common_text_twin}`;
  }

  renderBase(): string {
    let result = `ITU-${this.sector}`;
    if (this.series !== undefined && this.code !== undefined) {
      result += ` ${this.series}${this.series_dash === true ? "-" : "."}${this.code.render()}`;
    } else if (this.series !== undefined) {
      result += ` ${this.series}`;
    } else {
      result += ` ${this.code?.render() ?? ""}`;
    }
    if (this.range_end !== undefined) result += `-${this.range_end}`;
    if (this.series_word === true) result += " series";
    if (this.attachment === true) result += " attachment";
    if (this.version !== undefined) result += ` (V${this.version})`;
    return result + this.dateSuffix();
  }

  render(): string {
    return this.renderBase() + this.languageSuffix() + this.twinSuffix();
  }
}

// ---------------------------------------------------------------------------
// Flat converters (Identifiers::Base's shared *_to_kv/*_from_kv helpers).
// ---------------------------------------------------------------------------

const codeOf = (m: Record<string, unknown>): ItuCode | undefined => m["code"] as ItuCode | undefined;

/** One converter constructs the whole ItuCode from its sibling wire keys. */
function ituCodeFromHash(h: Record<string, unknown>): ItuCode | undefined {
  if (h["number"] === undefined || h["number"] === null) return undefined;
  return new ItuCode({
    imp_marker: h["imp_marker"],
    number: h["number"],
    series_suffix: h["series_suffix"],
    series_suffix_spaced: h["series_suffix_spaced"] === true,
    subseries: h["subseries"],
    parts: h["parts"],
    qualifier: h["qualifier"],
    qualifier_glued: h["qualifier_glued"] === true,
  });
}

const codeKey = (wire: string, read: (c: ItuCode) => unknown): FieldMapping => ({
  wire,
  to: "code",
  toWire: (m) => {
    const code = codeOf(m);
    return code === undefined ? undefined : read(code);
  },
  fromWire: () => undefined,
});

const yearMapping = (): FieldMapping => ({
  wire: "year",
  to: "date",
  toWire: (m) => (m["date"] as PubidDate | undefined)?.year,
  fromWire: (h) =>
    h["year"] === undefined || h["year"] === null
      ? undefined
      : new PubidDate({
          year: String(h["year"]),
          month: h["month"] === undefined || h["month"] === null ? undefined : String(h["month"]),
        }),
});

const monthMapping = (): FieldMapping => ({
  wire: "month",
  to: "date",
  toWire: (m) => (m["date"] as PubidDate | undefined)?.month,
  fromWire: () => undefined,
});

/** StandardSerialization — the single-document whitelist. */
const STANDARD_MAPPINGS = keyValue(
  { wire: "sector", to: "sector" },
  { wire: "series", to: "series" },
  codeKey("imp_marker", (c) => c.imp_marker),
  {
    wire: "number",
    to: "code",
    toWire: (m) => codeOf(m)?.number,
    fromWire: (h) => ituCodeFromHash(h),
  },
  codeKey("series_suffix", (c) => c.series_suffix),
  codeKey("series_suffix_spaced", (c) => (c.series_suffix_spaced ? true : undefined)),
  codeKey("subseries", (c) => c.subseries),
  codeKey("parts", (c) => (c.parts.length > 0 ? c.parts : undefined)),
  codeKey("qualifier", (c) => c.qualifier),
  codeKey("qualifier_glued", (c) => (c.qualifier_glued ? true : undefined)),
  { wire: "series_word", to: "series_word" },
  { wire: "series_dash", to: "series_dash" },
  { wire: "attachment", to: "attachment" },
  { wire: "range_end", to: "range_end" },
  { wire: "version", to: "version" },
  yearMapping(),
  monthMapping(),
  { wire: "language", to: "language" },
  { wire: "common_text_twin", to: "common_text_twin" },
);

/**
 * The Supplement block: sector/series/series_word are emitted ONLY for
 * the base-less series-only form; with a base they are redundant
 * copies of the base's (supplement_sector_to_kv's base-nil guard).
 */
const SUPPLEMENT_MAPPINGS = keyValue(
  { wire: "sector", to: "sector", toWire: (m) => (m["base"] === undefined ? m["sector"] : undefined) },
  { wire: "series", to: "series", toWire: (m) => (m["base"] === undefined ? m["series"] : undefined) },
  {
    wire: "series_word",
    to: "series_word",
    toWire: (m) => (m["base"] === undefined && m["series_word"] === true ? true : undefined),
  },
  { wire: "number", to: "number" },
  { wire: "number_glued", to: "number_glued" },
  { wire: "slash_joined", to: "slash_joined" },
  yearMapping(),
  monthMapping(),
  { wire: "base", to: "base" },
  { wire: "common_text_twin", to: "common_text_twin" },
);

// ---------------------------------------------------------------------------
// URN generation (lib/pubid/itu/urn_generator.rb) — declared before the
// concrete classes so the attachUrn statements below it are initialized;
// its bodies reference the classes only at call time.
// ---------------------------------------------------------------------------

function urnDateSegment(id: ItuIdentifier): string | undefined {
  if (!(id.date instanceof PubidDate)) return undefined;
  // Only an Operational Bulletin's printed date carries a day
  // ("15.III.2016"); it is in `==`, so it must reach the URN too.
  if (id.date.day !== undefined && id.date.month !== undefined) {
    return `${id.date.day}/${id.date.month}/${id.date.year}`;
  }
  return id.date.month !== undefined ? `${id.date.month}/${id.date.year}` : id.date.year;
}

export class ItuUrnGenerator extends BaseUrnGenerator<ItuIdentifier> {
  generate(): string {
    const id = this.identifier;
    if (id instanceof ItuAnnex) {
      const baseUrn = id.base?.toUrn();
      return baseUrn === undefined ? "urn:itu:annex" : `${baseUrn}:annex`;
    }
    if (id instanceof ItuAnnexOfRecommendation || id instanceof ItuAppendixOfRecommendation) {
      const segments = [
        id.base?.toUrn() ?? "urn:itu",
        id instanceof ItuAnnexOfRecommendation ? "annex" : "appendix",
        id.number?.toLowerCase(),
      ];
      if (id instanceof ItuAppendixOfRecommendation && id.material !== undefined) {
        segments.push(id.material.toLowerCase().replace(/[^a-z0-9]/g, ""));
      }
      segments.push(urnDateSegment(id));
      return segments.filter((s) => s !== undefined).join(":");
    }
    if (id instanceof ItuSupplement) return this.generateSupplementUrn(id);
    return this.generateBaseUrn(id);
  }

  generateBaseUrn(id: ItuIdentifier): string {
    const parts = ["urn", "itu"];
    // An Operational Bulletin is cross-bureau: its sector is a spelling,
    // not identity (see ItuSpecialPublication), so it stays out of the URN.
    if (id.sector !== undefined && !(id instanceof ItuSpecialPublication)) {
      parts.push(id.sector.toLowerCase());
    } else {
      parts.push("itu");
    }
    // Reports number independently of Recommendations — the marker must
    // reach the URN or the two same-numbered documents collide.
    if (id instanceof ItuReport) parts.push("report");
    if (id.series !== undefined) {
      if (id.code !== undefined) {
        const join = id.series_dash === true ? "-" : ".";
        parts.push(`${id.series}${join}${id.code.compactS()}`);
      } else {
        parts.push(id.series);
      }
    } else if (id.code !== undefined) {
      parts.push(id.code.compactS());
    }
    if (id.series_word === true) parts.push("series");
    if (id.attachment === true) parts.push("attachment");
    if (id.range_end !== undefined) parts.push(`to-${id.range_end}`);
    const segment = urnDateSegment(id);
    if (segment !== undefined) parts.push(segment);
    if (id.language !== undefined) parts.push(id.language.toLowerCase());
    return parts.join(":");
  }

  generateSupplementUrn(id: ItuSupplement): string {
    const parts = ["urn", "itu"];
    if (id.base !== undefined) {
      // An annex/appendix base holds its identity in ITS own base —
      // go through its to_urn instead (the nested_wrapper branch).
      const nestedWrapper =
        id.base instanceof ItuAnnexOfRecommendation || id.base instanceof ItuAppendixOfRecommendation;
      const baseUrn = nestedWrapper ? id.base.toUrn() : this.generateBaseUrn(id.base);
      parts.push(...baseUrn.replace(/^urn:itu:/, "").split(":"));
    } else {
      if (id.sector !== undefined) parts.push(id.sector.toLowerCase());
      if (id.series !== undefined) {
        if (id.code !== undefined) parts.push(`${id.series}.${id.code.compactS()}`);
        else parts.push(id.series);
      }
      // The base-less supplement's whole identity is sector + series.
      if (id.series_word === true) parts.push("series");
    }
    if (id.number !== undefined) parts.push(id.number);
    const segment = urnDateSegment(id);
    if (segment !== undefined) parts.push(segment);
    return parts.join(":");
  }
}

function attachUrn(klass: object): void {
  (klass as unknown as Record<string, unknown>)["urnGenerator"] = ItuUrnGenerator;
}

// ---------------------------------------------------------------------------
// The concrete classes.
// ---------------------------------------------------------------------------

export class ItuRecommendation extends ItuIdentifier {
  static polymorphicName = "pubid:itu:recommendation";
  static mappings = STANDARD_MAPPINGS;
}
registerType(ItuRecommendation as unknown as IdentifierStatic);
attachUrn(ItuRecommendation);

export class ItuReport extends ItuIdentifier {
  static polymorphicName = "pubid:itu:report";
  static mappings = STANDARD_MAPPINGS;
  renderBase(): string {
    return `Report ${super.renderBase()}`;
  }
}
registerType(ItuReport as unknown as IdentifierStatic);
attachUrn(ItuReport);

export class ItuHandbook extends ItuIdentifier {
  static polymorphicName = "pubid:itu:handbook";
  static mappings = STANDARD_MAPPINGS;
  renderBase(): string {
    return `ITU-${this.sector} ${this.code?.number ?? ""}.HDB${this.dateSuffix()}`;
  }
}
registerType(ItuHandbook as unknown as IdentifierStatic);
attachUrn(ItuHandbook);

export class ItuSpecialPublication extends ItuIdentifier {
  static polymorphicName = "pubid:itu:special-publication";
  static mappings = STANDARD_MAPPINGS;

  static ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

  renderBase(): string {
    const number = this.code?.number ?? "";
    const result = this.sector !== undefined
      ? `ITU-${this.sector} ${this.series}.${number}`
      : `ITU ${this.series} No. ${number}`;
    return result + this.renderObDate();
  }

  private renderObDate(): string {
    if (!(this.date instanceof PubidDate)) return "";
    if (this.date.day !== undefined && this.date.month !== undefined) {
      const roman = ItuSpecialPublication.ROMAN_MONTHS[Number(this.date.month) - 1] ?? "";
      return ` - ${this.date.day.padStart(2, "0")}.${roman}.${this.date.year}`;
    }
    if (this.date.month !== undefined) {
      return ` (${this.date.month.padStart(2, "0")}/${this.date.year})`;
    }
    return ` (${this.date.year})`;
  }
}
registerType(ItuSpecialPublication as unknown as IdentifierStatic);
attachUrn(ItuSpecialPublication);

// The ITU Radio Regulations — the treaty text revised by each World
// Radiocommunication Conference (hand-off itu-relaton-query-forms).
// It has no document number: "RR" is the whole designation, stored as
// the series; "ITU-R RR-2020" (URL spelling) normalizes to
// "ITU-R RR (2020)".
export class ItuRadioRegulations extends ItuIdentifier {
  static polymorphicName = "pubid:itu:radio-regulations";
  static mappings = STANDARD_MAPPINGS;
  renderBase(): string {
    return `ITU-${this.sector} ${this.series}${this.dateSuffix()}`;
  }
}
registerType(ItuRadioRegulations as unknown as IdentifierStatic);
attachUrn(ItuRadioRegulations);

export class ItuContribution extends ItuIdentifier {
  static polymorphicName = "pubid:itu:contribution";
  static mappings = STANDARD_MAPPINGS;
  renderBase(): string {
    return `ITU-${this.sector} ${this.series}-C${this.code?.number ?? ""}`;
  }
}
registerType(ItuContribution as unknown as IdentifierStatic);
attachUrn(ItuContribution);

export class ItuQuestion extends ItuIdentifier {
  static polymorphicName = "pubid:itu:question";
  static attributes = extendAttributes(ItuIdentifier, {
    study_group: { type: "string" },
    has_bl: { type: "boolean", default: false },
    bracketed: { type: "boolean", default: false },
    has_colon: { type: "boolean", default: false },
  });
  static mappings = keyValue(
    ...STANDARD_MAPPINGS,
    { wire: "study_group", to: "study_group" },
    { wire: "has_bl", to: "has_bl" },
    { wire: "bracketed", to: "bracketed" },
    { wire: "has_colon", to: "has_colon" },
  );

  declare readonly study_group: string | undefined;
  declare readonly has_bl: boolean | undefined;
  declare readonly bracketed: boolean | undefined;
  declare readonly has_colon: boolean | undefined;

  renderBase(): string {
    let result = `ITU-${this.sector}`;
    result += this.series !== undefined ? ` ${this.series}.` : " ";
    if (this.bracketed === true) result += "[";
    result += this.code?.render() ?? "";
    if (this.has_bl === true) result += "/BL";
    result += `/${this.study_group}`;
    if (this.bracketed === true) result += "]";
    if (this.has_colon === true) result += ":";
    return result;
  }
}
registerType(ItuQuestion as unknown as IdentifierStatic);
attachUrn(ItuQuestion);

export class ItuCombinedIdentifier extends ItuIdentifier {
  static polymorphicName = "pubid:itu:combined-identifier";
  static attributes = extendAttributes(ItuIdentifier, {
    combined: { type: ItuDesignation, collection: true, initializeEmpty: true },
  });
  static mappings = keyValue(
    ...STANDARD_MAPPINGS,
    {
      wire: "combined",
      to: "combined",
      toWire: (m) => {
        const list = m["combined"] as ItuDesignation[] | undefined;
        if (list === undefined || list.length === 0) return undefined;
        return list.map((d) => {
          const row: Record<string, unknown> = {
            series: d.series,
            number: d.code.number,
          };
          if (d.code.subseries !== undefined) row["subseries"] = d.code.subseries;
          if (d.code.parts.length > 0) row["parts"] = d.code.parts;
          if (d.code.series_suffix !== undefined) {
            row["series_suffix"] = d.code.series_suffix;
            if (d.code.series_suffix_spaced) row["series_suffix_spaced"] = true;
          }
          if (d.code.qualifier !== undefined) {
            row["qualifier"] = d.code.qualifier;
            if (d.code.qualifier_glued) row["qualifier_glued"] = true;
          }
          return row;
        });
      },
      fromWire: (h) => {
        const rows = h["combined"];
        if (!Array.isArray(rows)) return undefined;
        return rows.map((row) => {
          const r = row as Record<string, unknown>;
          return new ItuDesignation({
            series: r["series"],
            code: new ItuCode({
              number: r["number"],
              series_suffix: r["series_suffix"],
              series_suffix_spaced: r["series_suffix_spaced"] === true,
              subseries: r["subseries"],
              parts: r["parts"],
              qualifier: r["qualifier"],
              qualifier_glued: r["qualifier_glued"] === true,
            }),
          });
        });
      },
    },
  );

  declare readonly combined: ItuDesignation[];

  renderBase(): string {
    let result = `ITU-${this.sector}`;
    result +=
      this.series !== undefined
        ? ` ${this.series}${this.series_dash === true ? "-" : "."}${this.code?.render() ?? ""}`
        : ` ${this.code?.render() ?? ""}`;
    if (this.range_end !== undefined) result += `-${this.range_end}`;
    if (this.combined.length > 0) {
      result += `/${this.combined.map((d) => d.render()).join("/")}`;
    }
    if (this.series_word === true) result += " series";
    if (this.attachment === true) result += " attachment";
    if (this.version !== undefined) result += ` (V${this.version})`;
    return result + this.dateSuffix();
  }
}
registerType(ItuCombinedIdentifier as unknown as IdentifierStatic);
attachUrn(ItuCombinedIdentifier);

// --- Supplements -----------------------------------------------------------

export abstract class ItuSupplement extends ItuIdentifier {
  static attributes = extendAttributes(ItuIdentifier, {
    base: { type: ItuIdentifier as unknown as IdentifierStatic },
    number: { type: "string" },
    number_glued: { type: "boolean", default: false },
    slash_joined: { type: "boolean", default: false },
  });

  declare readonly base: ItuIdentifier | undefined;
  declare readonly number: string | undefined;
  declare readonly number_glued: boolean | undefined;
  declare readonly slash_joined: boolean | undefined;

  renderSupplement(label: string): string {
    let result = this.base !== undefined ? this.base.toHuman() : `ITU-${this.sector}`;
    if (this.base === undefined && this.series !== undefined) {
      result += ` ${this.series}`;
      if (this.series_word === true) result += " series";
    }
    result += this.slash_joined === true ? "/" : " ";
    result += label;
    if (this.number_glued !== true) result += " ";
    result += `${this.number ?? ""}`;
    return result + this.dateSuffix();
  }
}

export class ItuSupplementSuppl extends ItuSupplement {
  static polymorphicName = "pubid:itu:supplement";
  static mappings = SUPPLEMENT_MAPPINGS;
  render(): string {
    return this.renderSupplement("Suppl.");
  }
}
registerType(ItuSupplementSuppl as unknown as IdentifierStatic);
attachUrn(ItuSupplementSuppl);

export class ItuAmendment extends ItuSupplement {
  static polymorphicName = "pubid:itu:amendment";
  static mappings = SUPPLEMENT_MAPPINGS;
  render(): string {
    return this.renderSupplement("Amd.");
  }
}
registerType(ItuAmendment as unknown as IdentifierStatic);
attachUrn(ItuAmendment);

export class ItuAddendum extends ItuSupplement {
  static polymorphicName = "pubid:itu:addendum";
  static mappings = SUPPLEMENT_MAPPINGS;
  render(): string {
    return this.renderSupplement("Add.");
  }
}
registerType(ItuAddendum as unknown as IdentifierStatic);
attachUrn(ItuAddendum);

export class ItuErrata extends ItuSupplement {
  static polymorphicName = "pubid:itu:errata";
  static mappings = SUPPLEMENT_MAPPINGS;
  render(): string {
    return this.renderSupplement("Err.");
  }
}
registerType(ItuErrata as unknown as IdentifierStatic);
attachUrn(ItuErrata);

export class ItuCorrigendum extends ItuSupplement {
  static polymorphicName = "pubid:itu:corrigendum";
  static attributes = extendAttributes(ItuSupplement, {
    technical: { type: "boolean", default: false },
  });
  static mappings = keyValue(...SUPPLEMENT_MAPPINGS, { wire: "technical", to: "technical" });

  declare readonly technical: boolean | undefined;

  render(): string {
    return this.renderSupplement(this.technical === true ? "Technical Cor." : "Cor.");
  }
}
registerType(ItuCorrigendum as unknown as IdentifierStatic);
attachUrn(ItuCorrigendum);

// --- Wrappers (annex / appendix of a Recommendation, Annex to OB) ----------

export class ItuAnnexOfRecommendation extends ItuIdentifier {
  static polymorphicName = "pubid:itu:annex-of-recommendation";
  static attributes = extendAttributes(ItuIdentifier, {
    base: { type: ItuIdentifier as unknown as IdentifierStatic },
    number: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "number", to: "number" },
    yearMapping(),
    monthMapping(),
    { wire: "base", to: "base" },
    { wire: "language", to: "language" },
    { wire: "common_text_twin", to: "common_text_twin" },
  );

  declare readonly base: ItuIdentifier | undefined;
  declare readonly number: string | undefined;

  renderBase(): string {
    const head = this.base !== undefined ? this.base.renderBase() : `ITU-${this.sector}`;
    return `${head} Annex ${this.number}${this.dateSuffix()}`;
  }
}
registerType(ItuAnnexOfRecommendation as unknown as IdentifierStatic);
attachUrn(ItuAnnexOfRecommendation);

export class ItuAppendixOfRecommendation extends ItuIdentifier {
  static polymorphicName = "pubid:itu:appendix-of-recommendation";
  static attributes = extendAttributes(ItuIdentifier, {
    base: { type: ItuIdentifier as unknown as IdentifierStatic },
    number: { type: "string" },
    material: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "material", to: "material" },
    yearMapping(),
    monthMapping(),
    { wire: "base", to: "base" },
    { wire: "language", to: "language" },
    { wire: "common_text_twin", to: "common_text_twin" },
  );

  declare readonly base: ItuIdentifier | undefined;
  declare readonly number: string | undefined;
  declare readonly material: string | undefined;

  renderBase(): string {
    const head = this.base !== undefined ? this.base.renderBase() : `ITU-${this.sector}`;
    let result = `${head} App. ${this.number}`;
    if (this.material !== undefined) result += ` ${this.material}`;
    return result + this.dateSuffix();
  }
}
registerType(ItuAppendixOfRecommendation as unknown as IdentifierStatic);
attachUrn(ItuAppendixOfRecommendation);

export class ItuAnnex extends ItuIdentifier {
  static polymorphicName = "pubid:itu:annex";
  static attributes = extendAttributes(ItuIdentifier, {
    base: { type: ItuIdentifier as unknown as IdentifierStatic },
  });
  static mappings = keyValue(
    { wire: "base", to: "base" },
    { wire: "language", to: "language" },
    { wire: "common_text_twin", to: "common_text_twin" },
  );

  declare readonly base: ItuIdentifier | undefined;

  renderBase(): string {
    return `Annex to ${this.base?.renderBase() ?? ""}`;
  }
}
registerType(ItuAnnex as unknown as IdentifierStatic);
attachUrn(ItuAnnex);

/** The builder's class table (kind token → class). */
export const ITU_CLASSES = {
  recommendation: ItuRecommendation,
  report: ItuReport,
  handbook: ItuHandbook,
  special_publication: ItuSpecialPublication,
  radio_regulations: ItuRadioRegulations,
  contribution: ItuContribution,
  question: ItuQuestion,
  combined: ItuCombinedIdentifier,
  supplement: ItuSupplementSuppl,
  amendment: ItuAmendment,
  addendum: ItuAddendum,
  errata: ItuErrata,
  corrigendum: ItuCorrigendum,
  annex_of: ItuAnnexOfRecommendation,
  appendix_of: ItuAppendixOfRecommendation,
  annex_to: ItuAnnex,
} as const;

export type ItuKind = keyof typeof ITU_CLASSES;
