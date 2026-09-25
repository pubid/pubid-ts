import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue, type FieldMapping } from "../../model/attribute.js";
import { Component } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/nist/identifiers/base.rb + components/*. The wire
 * hash mirrors the Ruby compact shape: series/subseries/volume are bare
 * scalars, first/second_number are dropped (build artifacts), and the
 * components serialize as their plain field hashes.
 */

// --- Components ---------------------------------------------------------------

export class NistCode extends Component {
  readonly value: string;
  constructor(attrs: Record<string, unknown>) {
    super();
    this.value = String(attrs["value"] ?? "");
  }
  render(): string {
    return this.value;
  }
  toWire(): Record<string, unknown> {
    return { value: this.value };
  }
}

export class NistPart {
  readonly type: string;
  readonly value: string;
  constructor(attrs: Record<string, unknown>) {
    this.type = String(attrs["type"] ?? "");
    this.value = String(attrs["value"] ?? "");
  }
  toWire(): Record<string, unknown> {
    return this.type === "" ? { value: this.value } : { type: this.type, value: this.value };
  }
  render(notation?: string): string {
    if (notation !== undefined) return notation === "" ? this.value : `${notation}${this.value}`;
    if (this.type === "pt") return `pt${this.value}`;
    if (this.type === "n") return `n${this.value}`;
    if (this.type === "") return this.value;
    return `n${this.value}`;
  }
}

export class NistVolume {
  readonly value: string;
  constructor(attrs: Record<string, unknown>) {
    this.value = String(attrs["value"] ?? "");
  }
  toWire(): Record<string, unknown> {
    return { value: this.value };
  }
  render(): string {
    return `v${this.value}`;
  }
}

export class NistIssueNumber {
  readonly number: string;
  constructor(attrs: Record<string, unknown>) {
    this.number = String(attrs["number"] ?? "");
  }
  toWire(): Record<string, unknown> {
    return { number: this.number };
  }
  render(): string {
    return `n${this.number}`;
  }
}

export class NistEdition {
  readonly type: string | undefined;
  readonly id: string | undefined;
  readonly additional_text: string | undefined;
  readonly original_prefix: string | undefined;
  constructor(attrs: Record<string, unknown>) {
    this.type = attrs["type"] as string | undefined;
    this.id = attrs["id"] as string | undefined;
    this.additional_text = attrs["additional_text"] as string | undefined;
    this.original_prefix = attrs["original_prefix"] as string | undefined;
  }
  toWire(): Record<string, unknown> {
    return {
      ...(this.type !== undefined && this.type !== "" ? { type: this.type } : {}),
      ...(this.id !== undefined && this.id !== "" ? { id: this.id } : {}),
      ...(this.additional_text !== undefined && this.additional_text !== "" ? { additional_text: this.additional_text } : {}),
      ...(this.original_prefix !== undefined && this.original_prefix !== "" ? { original_prefix: this.original_prefix } : {}),
    };
  }
  render(): string {
    if (this.type === "r" && this.original_prefix !== undefined && this.original_prefix !== "") {
      let result = `${this.original_prefix}${this.id ?? ""}`;
      if (this.additional_text !== undefined && this.additional_text !== "") {
        result += /^[A-Za-z]$/.test(this.additional_text) ? this.additional_text.toUpperCase() : `.${this.additional_text}`;
      }
      return result;
    }
    if (this.type === "e" && this.original_prefix === "-" && this.id !== undefined && /^\d{4}$/.test(this.id)) {
      return `-${this.id}`;
    }
    let result = `${this.type ?? ""}${this.id ?? ""}`;
    if (this.additional_text !== undefined && this.additional_text !== "") {
      if (this.type === "-" && /^[A-Z][a-z]+\d{4}$/.test(this.additional_text)) {
        result = `-${this.additional_text}`;
      } else if (/^[A-Za-z]$/.test(this.additional_text)) {
        result += this.additional_text.toUpperCase();
      } else {
        result += `.${this.additional_text}`;
      }
    }
    return result;
  }
}

export class NistUpdate {
  readonly number: string | undefined;
  readonly year: string | undefined;
  readonly month: string | undefined;
  readonly prefix: string | undefined;
  constructor(attrs: Record<string, unknown>) {
    this.number = attrs["number"] as string | undefined;
    this.year = attrs["year"] as string | undefined;
    this.month = attrs["month"] as string | undefined;
    this.prefix = attrs["prefix"] as string | undefined;
  }
  toWire(): Record<string, unknown> {
    return {
      ...(this.number !== undefined ? { number: this.number } : {}),
      ...(this.year !== undefined ? { year: this.year } : {}),
      ...(this.month !== undefined ? { month: this.month } : {}),
      ...(this.prefix !== undefined ? { prefix: this.prefix } : {}),
    };
  }
  render(format: "short" | "mr" = "short"): string {
    if (this.prefix === "dash") {
      return this.year !== undefined ? `-upd${this.number ?? ""}-${this.yearMonth()}` : `-upd${this.number ?? ""}`;
    }
    if (format === "mr") {
      if (this.number === undefined && this.year === undefined) return "-upd";
      return this.year !== undefined ? `-upd${this.number ?? ""}-${this.yearMonth()}` : `-upd${this.number ?? ""}`;
    }
    return this.year !== undefined ? `/Upd${this.number ?? ""}-${this.yearMonth()}` : `/Upd${this.number ?? ""}`;
  }
  private yearMonth(): string {
    if (this.year === undefined) return "";
    return this.month !== undefined ? `${this.year}${this.month.padStart(2, "0")}` : this.year;
  }
}

export class NistTranslation {
  readonly code: string;
  constructor(attrs: Record<string, unknown>) {
    this.code = String(attrs["code"] ?? "");
  }
  toWire(): Record<string, unknown> {
    return { code: this.code };
  }
  render(format: "short" | "mr" = "short"): string {
    return format === "mr" ? `.${this.code}` : ` ${this.code}`;
  }
}

export class NistStage {
  readonly id: string;
  readonly type: string;
  constructor(attrs: Record<string, unknown>) {
    this.id = String(attrs["id"] ?? "");
    this.type = String(attrs["type"] ?? "");
  }
  toWire(): Record<string, unknown> {
    return { id: this.id, type: this.type };
  }
  render(): string {
    if (this.id === "" || this.type === "") return "";
    return `${this.id}${this.type}`;
  }
}

export class NistVersion {
  readonly value: string;
  constructor(attrs: Record<string, unknown>) {
    this.value = String(attrs["value"] ?? "");
  }
  toWire(): Record<string, unknown> {
    return { value: this.value };
  }
  render(): string {
    return `ver${this.value}`;
  }
}

export class NistSupplement {
  readonly number: string | undefined;
  readonly year: string | undefined;
  readonly month: string | undefined;
  readonly month_end: string | undefined;
  readonly year_end: string | undefined;
  readonly has_revision: boolean;
  readonly suffix: string | undefined;

  constructor(attrs: Record<string, unknown>) {
    this.number = attrs["number"] as string | undefined;
    this.year = attrs["year"] as string | undefined;
    this.month = attrs["month"] as string | undefined;
    this.month_end = attrs["month_end"] as string | undefined;
    this.year_end = attrs["year_end"] as string | undefined;
    this.has_revision = attrs["has_revision"] === true;
    this.suffix = attrs["suffix"] as string | undefined;
  }

  toWire(): Record<string, unknown> | undefined {
    const empty =
      this.number === undefined && this.year === undefined && this.month === undefined &&
      this.month_end === undefined && this.year_end === undefined && !this.has_revision &&
      this.suffix === undefined;
    if (empty) return undefined;
    return {
      ...(this.number !== undefined ? { number: this.number } : {}),
      ...(this.year !== undefined ? { year: this.year } : {}),
      ...(this.month !== undefined ? { month: this.month } : {}),
      ...(this.month_end !== undefined ? { month_end: this.month_end } : {}),
      ...(this.year_end !== undefined ? { year_end: this.year_end } : {}),
      ...(this.has_revision ? { has_revision: true } : {}),
      ...(this.suffix !== undefined ? { suffix: this.suffix } : {}),
    };
  }

  static fromRaw(value: string | undefined, hasRevision = false): NistSupplement {
    const supp: Record<string, unknown> = {};
    if (hasRevision) {
      supp["has_revision"] = true;
    } else if (value === undefined || value === "") {
      // empty
    } else {
      const m = /^([A-Za-z]{3,9})(\d{4})$/.exec(value);
      if (m !== null) {
        supp["month"] = m[1];
        supp["year"] = m[2];
      } else if (/^(18|19|20)\d{2}$/.test(value)) {
        supp["year"] = value;
      } else if (/^\d+$/.test(value)) {
        supp["number"] = value;
      } else {
        supp["suffix"] = value;
      }
    }
    return new NistSupplement(supp);
  }

  isRange(): boolean {
    return this.year !== undefined && this.year_end !== undefined;
  }

  valueString(): string {
    if (this.has_revision || this.isRange()) return "";
    if (this.suffix !== undefined) return this.suffix;
    if (this.month !== undefined && this.year !== undefined) return `${this.month}${this.year}`;
    if (this.number !== undefined && this.year !== undefined) return `${this.number}/${this.year}`;
    if (this.year !== undefined) return this.year;
    if (this.number !== undefined) return this.number;
    return "";
  }

  render(): string {
    if (
      this.number === undefined && this.year === undefined && this.month === undefined &&
      !this.has_revision && this.suffix === undefined && this.month_end === undefined && this.year_end === undefined
    ) {
      return "";
    }
    if (this.has_revision) return "suprev";
    if (this.suffix !== undefined) return `sup${this.suffix}`;
    if (this.isRange()) return `sup${this.month ?? ""}${this.year}-${this.month_end ?? ""}${this.year_end}`;
    if (this.month !== undefined && this.year !== undefined) return `sup${this.month}${this.year}`;
    if (this.number !== undefined && this.year !== undefined) return `sup${this.number}/${this.year}`;
    if (this.year !== undefined) return `sup${this.year}`;
    if (this.number !== undefined) return `sup${this.number}`;
    return "";
  }
}

// --- Series registry (lib/pubid/nist/series.rb) --------------------------------

export type SeriesPolicy = {
  preserveLetterSuffix: boolean;
  modernEditionDate: boolean;
  partNumAsComponent: boolean;
};

const LETTER_PRESERVING: SeriesPolicy = {
  preserveLetterSuffix: true,
  modernEditionDate: false,
  partNumAsComponent: false,
};
const BASE_POLICY: SeriesPolicy = {
  preserveLetterSuffix: false,
  modernEditionDate: false,
  partNumAsComponent: false,
};
const IR_POLICY: SeriesPolicy = { ...LETTER_PRESERVING, partNumAsComponent: true };
const FIPS_POLICY: SeriesPolicy = { ...LETTER_PRESERVING, modernEditionDate: true };

const SERIES_REGISTRY: [string, SeriesPolicy][] = [
  ["LCIRC", LETTER_PRESERVING],
  ["FIPS", FIPS_POLICY],
  ["CRPL", LETTER_PRESERVING],
  ["NCSTAR", BASE_POLICY],
  ["MONO", LETTER_PRESERVING],
  ["IR", IR_POLICY],
  ["MP", LETTER_PRESERVING],
  ["RPT", LETTER_PRESERVING],
  ["LC", LETTER_PRESERVING],
];

export function seriesPolicy(series: string | undefined): SeriesPolicy {
  if (series === undefined) return BASE_POLICY;
  const up = series.toUpperCase();
  for (const [code, policy] of SERIES_REGISTRY) {
    if (up.includes(code)) return policy;
  }
  return BASE_POLICY;
}

// --- Identifier base ------------------------------------------------------------

const componentWire = (componentName: string): FieldMapping[] => [
  {
    wire: componentName,
    to: componentName,
    toWire: (m) => {
      const value = m[componentName];
      return value === undefined ? undefined : (value as { toWire(): Record<string, unknown> }).toWire();
    },
    fromWire: () => undefined,
  },
];

const scalarCode = (name: string, ctor: new (attrs: Record<string, unknown>) => unknown): FieldMapping => ({
  wire: name,
  to: name,
  toWire: (m) => (m[name] as { value?: string } | undefined)?.value,
  fromWire: (h) => {
    const v = h[name];
    return v === undefined || v === null ? undefined : new ctor({ value: v });
  },
});

export abstract class NistIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: "string" },
    series: { type: NistCode },
    subseries: { type: NistCode },
    number: { type: "string" },
    subpart: { type: "string" },
    edition: { type: NistEdition },
    volume: { type: NistVolume },
    part: { type: NistPart },
    stage: { type: NistStage },
    version_component: { type: NistVersion },
    update_component: { type: NistUpdate },
    translation_component: { type: NistTranslation },
    issue_number: { type: NistIssueNumber },
    parsed_format: { type: "string" },
    publisher_was_parsed: { type: "boolean", default: true },
    parts: { type: "string", collection: true },
    revision_year: { type: "string" },
    revision_month: { type: "string" },
    edition_year: { type: "string" },
    version: { type: "string" },
    update: { type: NistUpdate },
    year: { type: "integer" },
    month: { type: "integer" },
    first_number: { type: "string" },
    second_number: { type: "string" },
    update_number: { type: "string" },
    update_year: { type: "string" },
    addendum: { type: "string" },
    addendum_number: { type: "string" },
    supplement: { type: NistSupplement },
    errata: { type: "string" },
    index: { type: "string" },
    insert: { type: "string" },
    section: { type: "string" },
    appendix: { type: "string" },
    translation: { type: "string" },
    draft: { type: "string" },
    draft_number: { type: "string" },
    date_year: { type: "string" },
    date_month: { type: "string" },
    date_day: { type: "string" },
    dated_seq: { type: "string" },
    public_draft: { type: "string" },
  });

  static mappings = keyValue(
    scalarCode("series", NistCode),
    scalarCode("subseries", NistCode),
    { wire: "publisher", to: "publisher" },
    {
      wire: "number",
      to: "number",
      toWire: (m) => {
        const v = m["number"];
        if (
          typeof v === "string" &&
          (/^\d+E-\d+$/.test(v) || /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(v))
        ) {
          return Number(v);
        }
        return v;
      },
      fromWire: (h) => {
        const v = h["number"];
        if (v === undefined || v === null) return undefined;
        // A numeric value came from the exporter's YAML float coercion —
        // keep it so the round trip stays idempotent.
        return typeof v === "number" ? v : String(v);
      },
    },
    { wire: "parsed_format", to: "parsed_format" },
    { wire: "publisher_was_parsed", to: "publisher_was_parsed" },
    ...componentWire("edition"),
    ...componentWire("part"),
    ...componentWire("supplement"),
    ...componentWire("stage"),
    ...componentWire("version_component"),
    ...componentWire("update_component"),
    ...componentWire("update"),
    ...componentWire("translation_component"),
    ...componentWire("issue_number"),
    {
      wire: "volume",
      to: "volume",
      toWire: (m) => (m["volume"] as NistVolume | undefined)?.value,
      fromWire: (h) => (h["volume"] === undefined || h["volume"] === null ? undefined : new NistVolume({ value: String(h["volume"]) })),
    },
    { wire: "section", to: "section" },
    { wire: "index", to: "index" },
    { wire: "insert", to: "insert" },
    { wire: "appendix", to: "appendix" },
    { wire: "errata", to: "errata" },
    { wire: "addendum", to: "addendum" },
    { wire: "translation", to: "translation" },
    { wire: "edition_year", to: "edition_year" },
    { wire: "dated_seq", to: "dated_seq" },
    { wire: "date_year", to: "date_year" },
    { wire: "date_month", to: "date_month" },
    { wire: "date_day", to: "date_day" },
    { wire: "revised_date", to: "revised_date" },
    { wire: "range_notation", to: "range_notation" },
    { wire: "prefix", to: "prefix" },
  );

  declare readonly publisher: string | undefined;
  declare readonly series: NistCode | undefined;
  declare readonly subseries: NistCode | undefined;
  declare readonly number: string | undefined;
  declare readonly edition: NistEdition | undefined;
  declare readonly volume: NistVolume | undefined;
  declare readonly part: NistPart | undefined;
  declare readonly stage: NistStage | undefined;
  declare readonly version_component: NistVersion | undefined;
  declare readonly update_component: NistUpdate | undefined;
  declare readonly update: NistUpdate | undefined;
  declare readonly translation_component: NistTranslation | undefined;
  declare readonly translation: string | undefined;
  declare readonly issue_number: NistIssueNumber | undefined;
  declare readonly parsed_format: string | undefined;
  declare readonly publisher_was_parsed: boolean | undefined;
  declare readonly parts: string[] | undefined;
  declare readonly revision_year: string | undefined;
  declare readonly revision_month: string | undefined;
  declare readonly edition_year: string | undefined;
  declare readonly version: string | undefined;
  declare readonly year: number | undefined;
  declare readonly supplement: NistSupplement | undefined;
  declare readonly errata: string | undefined;
  declare readonly index: string | undefined;
  declare readonly insert: string | undefined;
  declare readonly section: string | undefined;
  declare readonly appendix: string | undefined;
  declare readonly addendum: string | undefined;
  declare readonly addendum_number: string | undefined;
  declare readonly draft: string | undefined;
  declare readonly draft_number: string | undefined;
  declare readonly date_year: string | undefined;
  declare readonly date_month: string | undefined;
  declare readonly date_day: string | undefined;
  declare readonly dated_seq: string | undefined;

  seriesCode(): string | undefined {
    return undefined;
  }

  defaultPublisher(): string {
    return "NIST";
  }

  revision(): string | undefined {
    return this.edition !== undefined && this.edition.type !== undefined && this.edition.id !== undefined
      ? `${this.edition.type}${this.edition.id}`
      : undefined;
  }

  supplementShort(): string {
    if (this.supplement === undefined) return "";
    const prefix = this.supplement.isRange() && this.number === undefined ? " " : "";
    const rendered = this.supplement.render();
    return prefix + (rendered === "" ? "sup" : rendered);
  }

  appendShortComponents(skipPart = false): string {
    let result = "";
    const effectivePart = skipPart ? undefined : this.part;

    if (this.volume !== undefined && effectivePart instanceof NistPart) {
      result += ` ${this.volume.render()}${effectivePart.render()}`;
    } else if (effectivePart instanceof NistPart) {
      result += effectivePart.render();
    } else if (this.volume !== undefined && this.issue_number === undefined && effectivePart === undefined) {
      result += this.volume.render();
    } else if (this.volume !== undefined && this.issue_number !== undefined) {
      result += `${this.volume.render()}n${this.issue_number.number}`;
    }

    if (this.edition !== undefined) {
      if (this.edition.original_prefix !== undefined && this.edition.original_prefix !== "") {
        result += this.edition.render();
      } else if (this.number !== undefined) {
        result += this.edition.render();
      } else {
        result += ` ${this.edition.render()}`;
      }
    }

    if (this.version_component !== undefined) {
      result += this.version_component.render();
    } else if (this.version !== undefined) {
      result += `ver${this.version}`;
    }

    result += this.supplementShort();

    if (this.errata !== undefined) result += this.errata;
    if (this.index !== undefined) result += "index";
    if (this.insert !== undefined) result += "insert";
    if (this.section !== undefined) result += `sec${this.section}`;
    if (this.appendix !== undefined) result += "app";
    if (this.addendum !== undefined || this.addendum_number !== undefined) result += " Add.";

    if (this.update_component !== undefined) {
      result += this.update_component.render("short");
    } else if (this.update !== undefined) {
      result += `-upd${this.update.number ?? ""}`;
    }

    if (this.draft_number !== undefined) {
      result += ` ${this.draft_number}pd`;
    } else if (this.draft !== undefined && this.draft.includes("draft") && !this.draft.includes("Draft)")) {
      result += "-draft";
    }

    if (this.stage !== undefined) {
      const rendered = this.stage.render();
      if (rendered !== "") result += ` ${rendered}`;
    }

    if (this.translation_component !== undefined) {
      result += this.translation_component.render("short");
    } else if (this.translation !== undefined) {
      result += ` ${this.translation}`;
    }

    return result;
  }

  appendMrComponents(skipPart = false): string {
    let result = "";
    const effectivePart = skipPart ? undefined : this.part;

    if (this.volume !== undefined && effectivePart instanceof NistPart) {
      result += `${this.volume.render()}${effectivePart.render()}`;
    } else if (effectivePart instanceof NistPart) {
      result += effectivePart.render();
    } else if (this.volume !== undefined && this.issue_number === undefined && effectivePart === undefined) {
      result += this.volume.render();
    } else if (this.volume !== undefined && this.issue_number !== undefined) {
      result += `${this.volume.render()}n${this.issue_number.number}`;
    }

    // With a number the edition glues per the NIST spec ("800-53r5");
    // series-only editions take a dot separator ("NBS.CIRC.e2" — the
    // attested raw spelling; testsuite#5 C4/C5).
    if (this.edition !== undefined) {
      result += this.number !== undefined ? this.edition.render() : `.${this.edition.render()}`;
    }
    if (this.version_component !== undefined) result += this.version_component.render();
    // A series-only supplement takes the dot itself ("NBS.CIRC.sup").
    if (this.supplement !== undefined) {
      result += this.number !== undefined ? this.supplementShort() : `.${this.supplementShort()}`;
    }
    if (this.update_component !== undefined) result += this.update_component.render("mr");
    if (this.stage !== undefined) {
      const rendered = this.stage.render();
      if (rendered !== "") result += `.${rendered}`;
    }
    if (this.addendum !== undefined || this.addendum_number !== undefined) result += ".Add.";
    if (this.translation_component !== undefined) result += this.translation_component.render("mr");
    return result;
  }

  effectiveSeries(): string | undefined {
    return this.seriesCode() ?? this.series?.value;
  }

  shortRenderPublisher(): string | undefined {
    return this.publisher !== undefined && this.publisher_was_parsed !== false ? this.publisher : undefined;
  }

  renderShort(): string {
    let result = "";
    const effectivePublisher = this.shortRenderPublisher();
    const effectiveSeries = this.effectiveSeries();

    if (effectiveSeries?.startsWith("NBS ") === true) {
      result += effectiveSeries;
    } else if (effectivePublisher !== undefined && effectiveSeries !== undefined) {
      result += `${effectivePublisher} ${effectiveSeries}`;
    } else if (effectiveSeries !== undefined && this.publisher_was_parsed === true) {
      result += `NIST ${effectiveSeries}`;
    } else if (effectiveSeries !== undefined) {
      result += effectiveSeries;
    }

    if (this.number !== undefined) result += ` ${this.number}`;
    if (this.parts !== undefined && this.parts.length > 0) {
      result += this.parts.map((p) => `-${p}`).join("");
    }
    if (this.year !== undefined && this.number === undefined) result += ` (${this.year})`;
    result += this.appendShortComponents();
    return result;
  }

  renderMr(): string {
    let result = (this.publisher ?? "NIST").toString();
    const effectiveSeries = this.effectiveSeries();
    if (effectiveSeries !== undefined) result += `.${effectiveSeries}`;
    if (this.number !== undefined) result += `.${this.number}`;
    if (this.parts !== undefined && this.parts.length > 0) {
      result += this.parts.map((p) => `-${p}`).join("");
    }
    result += this.appendMrComponents();
    return result;
  }

  render(): string {
    if (this.parsed_format === "mr") return this.renderMr();
    return this.renderShort();
  }
}

class NistUrnGenerator extends BaseUrnGenerator<NistIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "nist"];
    const urnSeries = id.series?.value ?? id.seriesCode() ?? "sp";
    parts.push(urnSeries.toLowerCase());

    const identifierParts: string[] = [];
    if (id.number !== undefined) identifierParts.push(id.number);
    if (id.parts !== undefined && id.parts.length > 0) {
      identifierParts.push(...id.parts.map((p) => `-${p}`));
    }
    if (id.edition !== undefined) identifierParts.push(id.edition.render());
    if (id.volume !== undefined) identifierParts.push(id.volume.render());
    if (id.part instanceof NistPart) identifierParts.push(id.part.render());
    if (id.volume !== undefined && id.issue_number !== undefined) {
      identifierParts.push(`${id.volume.render()}n${id.issue_number.number}`);
    }
    if (id.version_component !== undefined) {
      identifierParts.push(id.version_component.render());
    } else if (id.version !== undefined) {
      identifierParts.push(`ver.${id.version}`);
    }
    if (id.update_component !== undefined) {
      identifierParts.push(id.update_component.render("short"));
    } else if (id.update !== undefined) {
      identifierParts.push(`-upd${id.update.number ?? ""}`);
    }
    if (id.stage !== undefined) {
      const rendered = id.stage.render();
      if (rendered !== "") identifierParts.push(rendered);
    }

    // The nil supplement still emits "supp" (quirk retained from Ruby).
    const supp = id.supplement;
    if (supp?.isRange() === true) {
      identifierParts.push(`supp${supp.month ?? ""}${supp.year}-${supp.month_end ?? ""}${supp.year_end}`);
    } else if (supp?.has_revision === true) {
      identifierParts.push("supprev");
    } else if (supp !== undefined && supp.valueString() !== "") {
      const value = supp.valueString();
      identifierParts.push(/^[A-Z]/.test(value) ? `supp${value}` : `supp-${value}`);
    } else if (supp === undefined) {
      identifierParts.push("supp");
    }

    if (id.errata !== undefined) identifierParts.push(id.errata);
    if (id.addendum !== undefined || id.addendum_number !== undefined) identifierParts.push("add.");
    if (id.draft_number !== undefined) {
      identifierParts.push(`${id.draft_number}pd`);
    } else if (id.draft !== undefined && id.draft.includes("draft")) {
      identifierParts.push("-draft");
    }
    if (id.index !== undefined) identifierParts.push("index");
    if (id.insert !== undefined) identifierParts.push("insert");
    if (id.section !== undefined) identifierParts.push(`sec${id.section}`);
    if (id.appendix !== undefined) identifierParts.push("app");

    if (identifierParts.length > 0) parts.push(identifierParts.join("."));

    if (id.translation_component !== undefined) {
      parts.push(id.translation_component.code.toLowerCase());
    } else if (id.translation !== undefined) {
      parts.push(id.translation.toLowerCase());
    }
    return parts.join(":");
  }
}

// --- The concrete classes ---------------------------------------------------------

interface TypeSpec {
  kind: string;
  seriesCode?: string;
  defaultPublisher?: string;
  supplementSeam?: boolean;
  /** "fips": MR form starts at the series; "crpl": the CRPL-F band form. */
  style?: "fips" | "crpl";
  /** Ruby classes whose to_s defaults to :short even for mr-parsed input. */
  forceShort?: boolean;
  /** Ruby to_short_style implementations that render default_publisher. */
  shortUsesDefaultPublisher?: boolean;
}

function nistClass(spec: TypeSpec): IdentifierStatic {
  class NistConcrete extends (spec.supplementSeam === true ? NistSupplementIdentifier : NistIdentifier) {
    static polymorphicName = `pubid:nist:${spec.kind}`;
    static urnGenerator = NistUrnGenerator;

    seriesCode(): string | undefined {
      return spec.seriesCode;
    }

    defaultPublisher(): string {
      return spec.defaultPublisher ?? "NIST";
    }

    renderMr(): string {
      if (spec.style === "fips") {
        let result = this.seriesCode() ?? "";
        if (this.number !== undefined) result += `.${this.number}`;
        if (this.part instanceof NistPart) result += `-${this.part.value}`;
        if (this.parts !== undefined && this.parts.length > 0) {
          result += this.parts.map((p) => `-${p}`).join("");
        }
        result += this.appendMrComponents(true);
        return result;
      }
      return super.renderMr();
    }

    renderShort(): string {
      if (spec.kind === "dated-document") {
        return `${this.publisher ?? "NIST"} ${this.date_year ?? ""}-${this.date_month ?? ""}-${this.date_day ?? ""} ${this.dated_seq ?? ""}`;
      }
      if (spec.style === "fips") {
        let result = this.publisher !== undefined ? `${this.publisher} ` : "";
        result += this.seriesCode() ?? "";
        let numberPart = this.number ?? "";
        const fy = /^(\d{1,3})-(\d{4})$/.exec(numberPart);
        if (fy !== null) {
          numberPart = `${fy[1]!}e${fy[2]!}`;
        }
        if (numberPart !== "") result += ` ${numberPart}`;
        if (this.part instanceof NistPart) result += `-${this.part.value}`;
        result += this.appendShortComponents(true);
        return result;
      }
      let result = super.renderShort();
      if (spec.style === "crpl") {
        const seriesValue = this.series?.value ?? "";
        const band = seriesValue.includes("CRPL-F-")
          ? seriesValue.replace("NBS ", "")
          : this.seriesCode();
        result = `${this.defaultPublisher()} ${band}`;
        let numValue = this.number ?? "";
        if (/^c\d/.test(numValue)) numValue = numValue.slice(1);
        numValue = numValue.replace(/-m-/, "-M-").replace(/^m-/, "M-");
        if (this.number !== undefined) {
          if ((this as unknown as { prefix?: string }).prefix !== undefined) {
            result += ` ${(this as unknown as { prefix?: string }).prefix}`;
          }
          result += ` ${numValue}`;
        }
        result += this.appendShortComponents();
      }
      return result;
    }

    shortRenderPublisher(): string | undefined {
      if (spec.shortUsesDefaultPublisher === true) return this.defaultPublisher();
      return super.shortRenderPublisher();
    }

    render(): string {
      if (spec.supplementSeam === true) {
        return NistSupplementIdentifier.prototype.render.call(this);
      }
      // Ruby classes whose to_s defaults to :short render that way even
      // for mr-parsed input.
      let rendered = this.parsed_format === "mr" && !spec.forceShort ? this.renderMr() : this.renderShort();
      // Handbook rewrites "e2.1955" to "e2-1955".
      if (
        spec.seriesCode === "HB" &&
        this.edition !== undefined &&
        this.edition.additional_text !== undefined &&
        this.edition.additional_text !== "" &&
        this.edition.type !== undefined &&
        this.edition.id !== undefined
      ) {
        const from = `${this.edition.type}${this.edition.id}.${this.edition.additional_text}`;
        const to = `${this.edition.type}${this.edition.id}-${this.edition.additional_text}`;
        rendered = rendered.split(from).join(to);
      }
      return rendered;
    }
  }
  registerType(NistConcrete as unknown as IdentifierStatic);
  return NistConcrete as unknown as IdentifierStatic;
}

export abstract class NistSupplementIdentifier extends NistIdentifier {
  static attributes = extendAttributes(NistIdentifier, {
    base: { type: NistIdentifier as unknown as IdentifierStatic },
    supplement_date_range_start: { type: "string" },
    supplement_date_range_end: { type: "string" },
    implicit_supplement: { type: "boolean" },
  });
  declare readonly base: NistIdentifier | undefined;
  declare readonly supplement_date_range_start: string | undefined;
  declare readonly supplement_date_range_end: string | undefined;
  declare readonly implicit_supplement: boolean | undefined;

  render(): string {
    if (this.supplement_date_range_start !== undefined && this.supplement_date_range_end !== undefined) {
      return `NBS CIRC sup${this.supplement_date_range_start}-${this.supplement_date_range_end}`;
    }
    const base = this.base;
    if (base === undefined) return super.render();
    let result = base.toHuman();
    if (this.update !== undefined) {
      const isImplicit = this.implicit_supplement === true;
      if (!isImplicit) result += "sup";
      result += this.update.render("short");
      return result;
    }
    result += "sup";
    if (this.edition?.id !== undefined) {
      result += /^[A-Z]/.test(this.edition.id) ? this.edition.id : `-${this.edition.id}`;
    }
    return result;
  }
}

const TYPE_SPECS: TypeSpec[] = [
  { kind: "special-publication", seriesCode: "SP" },
  { kind: "federal-information-processing-standards", seriesCode: "FIPS", defaultPublisher: "", style: "fips" },
  { kind: "interagency-report", seriesCode: "IR", forceShort: true },
  { kind: "handbook", seriesCode: "HB" },
  { kind: "technical-note", seriesCode: "TN" },
  { kind: "circular", seriesCode: "CIRC", defaultPublisher: "NBS" },
  { kind: "circular-supplement", seriesCode: "CIRC", defaultPublisher: "NBS", supplementSeam: true },
  { kind: "crpl-report", seriesCode: "CRPL", defaultPublisher: "NBS", style: "crpl", forceShort: true },
  { kind: "report", seriesCode: "RPT", defaultPublisher: "NBS", forceShort: true, shortUsesDefaultPublisher: true },
  { kind: "monograph", seriesCode: "MONO", forceShort: true },
  {
    kind: "miscellaneous-publication", seriesCode: "MP", defaultPublisher: "NBS",
    forceShort: true, shortUsesDefaultPublisher: true,
  },
  { kind: "grant-contractor-report", seriesCode: "GCR" },
  { kind: "ncstar", seriesCode: "NCSTAR" },
  { kind: "owmwp", seriesCode: "OWMWP" },
  { kind: "nsrds", seriesCode: "NSRDS", defaultPublisher: "NBS" },
  { kind: "letter-circular", seriesCode: "LC", defaultPublisher: "NBS" },
  { kind: "commercial-standard", seriesCode: "CS", defaultPublisher: "NBS" },
  { kind: "commercial-standard-emergency", seriesCode: "CS-E" },
  { kind: "commercial-standards-monthly", seriesCode: "CSM", defaultPublisher: "NBS", forceShort: true },
  { kind: "dated-document" },
  { kind: "identifier" },
];

export const NIST_CLASSES = new Map<string, IdentifierStatic>(TYPE_SPECS.map((spec) => [spec.kind, nistClass(spec)]));

export const SP_SUBSERIES = [
  "250", "260", "300", "400", "480", "500", "700", "800", "823", "960",
  "1190GB", "1200", "1500", "1800", "1900", "2000", "2100",
];
