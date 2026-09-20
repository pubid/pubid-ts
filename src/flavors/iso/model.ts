import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue, type FieldMapping } from "../../model/attribute.js";
import { PubidDate, Language, Iteration } from "../../model/component.js";
import { Component } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { ISO_TYPED_STAGES, type IsoTypedStage } from "./stages.generated.js";

/**
 * Port of lib/pubid/iso/identifiers/* on the unified model. The typed
 * stage is the single source of truth for stage and doctype; the wire
 * hash carries only the non-published stage CODE under "stage"
 * (identifier.rb's stage_to_kv). number/part/subpart are plain strings;
 * date is flat year/month/day; publisher serializes only when it is
 * not the class default.
 */

export function locateStage(abbr: string): IsoTypedStage | undefined {
  const needle = abbr.trim().toUpperCase();
  return ISO_TYPED_STAGES.find((s) => s.abbr.some((a) => a.toUpperCase() === needle));
}

export function locateType(typeKey: string): IsoTypedStage[] {
  return ISO_TYPED_STAGES.filter((s) => s.typeKey === typeKey);
}

export function locateStageByCode(code: string): IsoTypedStage | undefined {
  return ISO_TYPED_STAGES.find((s) => s.code === code);
}

export function publishedStage(typeKey: string): IsoTypedStage | undefined {
  return ISO_TYPED_STAGES.find((s) => s.typeKey === typeKey && s.stageCode === "published");
}

/** Tokens for the parser, longest first (array_to_str semantics). */
export function stageTokens(typeKeys?: string[]): string[] {
  const stages = typeKeys === undefined ? ISO_TYPED_STAGES : ISO_TYPED_STAGES.filter((s) => typeKeys.includes(s.typeKey));
  const tokens = stages.flatMap((s) => s.abbr.filter((a) => a !== ""));
  return [...new Set(tokens)].sort((a, b) => b.length - a.length);
}

/** TypedStage#abbreviation: long/short override, else abbr[0]; the
 * parsed spelling (originalAbbr) decides long vs short via context. */
export function stageAbbr(entry: IsoTypedStage, formatLong: boolean, originalAbbr?: string): string {
  if (formatLong && entry.longAbbr !== undefined) return entry.longAbbr;
  if (!formatLong && entry.shortAbbr !== undefined) return entry.shortAbbr;
  return entry.abbr[0] ?? "";
}

/** The runtime typed-stage state: the registry entry + parsed spelling. */
export interface TypedStageState {
  entry: IsoTypedStage;
  originalAbbr?: string | undefined;
}

export interface IsoLanguageState {
  code: string;
  originalCode: string;
}

/** The ISO Edition: number + original spelling ("Edition 13"). */
export class IsoEdition extends Component {
  readonly number: string | undefined;
  readonly original_text: string | undefined;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.number = attrs["number"] as string | undefined;
    this.original_text = attrs["original_text"] as string | undefined;
  }

  render(): string {
    return this.original_text ?? this.number ?? "";
  }

  toWire(): Record<string, unknown> {
    return {
      ...(this.number !== undefined ? { number: this.number } : {}),
      ...(this.original_text !== undefined ? { original_text: this.original_text } : {}),
    };
  }
}

export abstract class IsoIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    number: { type: "string" },
    part: { type: "string" },
    subpart: { type: "string" },
    stage_iteration: { type: Iteration },
    date: { type: PubidDate },
    edition: { type: IsoEdition },
    languages: { type: Language, collection: true, initializeEmpty: true },
    all_parts: { type: "boolean", default: false },
  });

  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly subpart: string | undefined;
  declare readonly stage_iteration: Iteration | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly edition: IsoEdition | undefined;
  declare readonly languages: Language[] | undefined;
  declare readonly all_parts: boolean | undefined;
  declare readonly typedStageState: TypedStageState | undefined;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    // Materialize the typed-stage state the way lutaml materializes
    // attribute defaults: from the hash, else the class's published
    // stage.
    const self = this as unknown as Record<string, unknown>;
    if (attrs["typedStageState"] !== undefined) {
      self["typedStageState"] = attrs["typedStageState"];
    } else if (self["typedStageState"] === undefined) {
      const pub = publishedStage(this.typeKey());
      if (pub !== undefined) self["typedStageState"] = { entry: pub, originalAbbr: pub.abbr[0] };
    }
  }

  /** The class's type key (drives URN type component + class identity). */
  typeKey(): string {
    return (this.constructor as unknown as { typeKey: string }).typeKey;
  }

  root(): IsoIdentifier {
    const base = (this as unknown as Record<string, unknown>)["base"];
    return base instanceof IsoIdentifier ? base.root() : this;
  }

  /** detect_stage_format_long: the parsed spelling picks long form. */
  protected stageFormatLong(): boolean {
    const ts = this.typedStageState;
    if (ts === undefined) return false;
    if (ts.entry.longAbbr !== undefined && ts.originalAbbr?.startsWith(ts.entry.longAbbr)) return true;
    if (ts.entry.longAbbr !== undefined && ts.originalAbbr?.includes("Directives")) return true;
    return false;
  }

  /** detect_language_code_format: single (E) vs iso (en). */
  protected languageSingle(): boolean {
    const first = this.languages?.[0];
    if (first === undefined) return false;
    return first.originalCode !== undefined && first.originalCode.length === 1;
  }

  protected stageString(): string {
    const ts = this.typedStageState;
    if (ts === undefined) return "";
    return stageAbbr(ts.entry, this.stageFormatLong(), ts.originalAbbr);
  }

  /** Render with an EXPLICIT long-format flag (the supplement
   * renderer propagates its own context to the base). */
  renderWithFormat(formatLong: boolean): string {
    let result = "";
    if (this.typeKey() === "iwa") {
      const stage = this.typedStageState === undefined ? "" : stageAbbr(this.typedStageState.entry, formatLong);
      if (stage !== "") result += stage;
    } else {
      const pub = (this as unknown as { publisher?: IsoPublisher }).publisher;
      if (pub !== undefined) {
        result += pub.render();
        const stage = this.stageStringFor(formatLong);
        if (stage !== "") {
          const isGuide = this.typeKey() === "guide" && !(this instanceof IsoSupplementIdentifier);
          const sep = isGuide || (pub.copublisher?.length ?? 0) > 0 ? " " : "/";
          result += `${sep}${stage}`;
        }
      }
    }
    const num = this.numberPortion(true);
    if (num !== "") result += result === "" ? num : ` ${num}`;
    result += this.languagePortion(this.languageSingle());
    if (this.all_parts === true) result += " (all parts)";
    return result;
  }

  /** Ruby SupplementRenderer renders the base with the wrapper's
   * detected context (stage_format_long propagates down the chain;
   * with_date being non-nil pins it against re-detection — a nested
   * amendment renders "AMD" under a "CD Cor" top but "Amd" under a
   * "Cor." top). */
  renderAsSupplementBase(long: boolean): string {
    return this.renderWithFormat(long);
  }

  private stageStringFor(formatLong: boolean): string {
    const ts = this.typedStageState;
    if (ts === undefined) return "";
    return stageAbbr(ts.entry, formatLong, ts.originalAbbr);
  }

  protected numberPortion(withDate: boolean): string {
    let result = this.number ?? "";
    if (this.part !== undefined) result += `-${this.part}`;
    if (this.subpart !== undefined) result += `-${this.subpart}`;
    if (this.stage_iteration !== undefined) result += `.${this.stage_iteration.render() ?? ""}`;
    if (withDate && this.date !== undefined && this.date.present()) {
      result += `:${this.date.render()}`;
    }
    return result;
  }

  protected languagePortion(single: boolean): string {
    if (this.languages === undefined || this.languages.length === 0) return "";
    const rendered = this.languages.map((l) => (single ? l.originalCode ?? l.code : l.code));
    return `(${rendered.join(single ? "/" : ",")})`;
  }
}

const dateTrio = (): FieldMapping[] => [
  {
    wire: "year",
    to: "date",
    toWire: (m) => (m["date"] as PubidDate | undefined)?.year,
    fromWire: (h) =>
      h["year"] === undefined || h["year"] === null
        ? undefined
        : new PubidDate({
            year: String(h["year"]),
            month: h["month"] === undefined || h["month"] === null ? undefined : String(h["month"]),
            day: h["day"] === undefined || h["day"] === null ? undefined : String(h["day"]),
          }),
  },
  { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
  { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
  {
    wire: "undated",
    to: "date",
    toWire: (m) => ((m["date"] as PubidDate | undefined)?.undated === true ? true : undefined),
    fromWire: (h) => (h["undated"] === true ? new PubidDate({ undated: true }) : undefined),
  },
];

/** identifier.rb's base key_value block (the single-document whitelist). */
export const ISO_MAPPINGS = keyValue(
  { wire: "number", to: "number" },
  { wire: "part", to: "part" },
  { wire: "subpart", to: "subpart" },
  {
    wire: "stage_iteration",
    to: "stage_iteration",
    toWire: (m) => (m["stage_iteration"] as Iteration | undefined)?.string,
    fromWire: (h) => (h["stage_iteration"] === undefined || h["stage_iteration"] === null ? undefined : new Iteration({ string: String(h["stage_iteration"]) })),
  },
  ...dateTrio(),
  { wire: "edition", to: "edition" },
  { wire: "languages", to: "languages" },
  { wire: "all_parts", to: "all_parts" },
);

/** publisher/copublishers for publisher-carrying leaves. */
const publisherMappings = (): FieldMapping[] => [
  {
    wire: "publisher",
    to: "publisher",
    toWire: (m) => {
      const pub = m["publisher"] as IsoPublisher | undefined;
      if (pub === undefined) return undefined;
      if (pub.publisher === "ISO") return undefined;
      return pub.publisher;
    },
    fromWire: (h) => {
      if ((h["publisher"] === undefined || h["publisher"] === null) && h["copublishers"] === undefined) return undefined;
      const cps = Array.isArray(h["copublishers"]) ? h["copublishers"].map(String) : [];
      return new IsoPublisher({ publisher: h["publisher"] === undefined || h["publisher"] === null ? "ISO" : String(h["publisher"]), copublisher: cps });
    },
  },
  {
    wire: "copublishers",
    to: "publisher",
    toWire: (m) => {
      const pub = m["publisher"] as IsoPublisher | undefined;
      const cp = pub?.copublisher;
      return cp === undefined || cp.length === 0 ? undefined : cp;
    },
    // The "publisher" wire key is absent for the ISO default, so this
    // mapping rebuilds the whole publisher (copublishers_from_kv
    // mirrors Builder#parse on the Ruby side).
    fromWire: (h) => {
      if (h["copublishers"] === undefined || h["copublishers"] === null) return undefined;
      const cps = Array.isArray(h["copublishers"]) ? h["copublishers"].map(String) : [];
      return new IsoPublisher({ publisher: h["publisher"] === undefined || h["publisher"] === null ? "ISO" : String(h["publisher"]), copublisher: cps });
    },
  },
];

const stageMapping = (): FieldMapping => ({
  wire: "stage",
  to: "typedStageState",
  toWire: (m) => {
    const ts = m["typedStageState"] as TypedStageState | undefined;
    if (ts === undefined) return undefined;
    if (ts.entry.stageCode === "published") return undefined;
    return ts.entry.code;
  },
  fromWire: (h) => {
    const code = h["stage"];
    if (code === undefined || code === null || code === "") return undefined;
    const entry = locateStageByCode(String(code));
    if (entry === undefined) return undefined;
    return { entry, originalAbbr: entry.abbr[0] };
  },
});


/** The ISO Publisher component: "ISO/IEC/IEEE". */
export class IsoPublisher {
  readonly publisher: string;
  readonly copublisher: string[] | undefined;

  constructor(attrs: { publisher?: unknown; copublisher?: unknown }) {
    this.publisher = attrs.publisher === undefined || attrs.publisher === null ? "ISO" : String(attrs.publisher);
    this.copublisher = Array.isArray(attrs.copublisher) ? attrs.copublisher.map(String) : [];
  }

  render(): string {
    if (this.copublisher === undefined || this.copublisher.length === 0) return this.publisher;
    return this.publisher + this.copublisher.map((cp) => `/${cp}`).join("");
  }
}

/** Single documents (everything except supplements, TcDocument, Bundled). */
export abstract class IsoSingleIdentifier extends IsoIdentifier {
  static attributes = extendAttributes(IsoIdentifier, {
    publisher: { type: IsoPublisher },
    copublishers: { type: IsoPublisher, collection: true, initializeEmpty: true },
  });

  declare readonly publisher: IsoPublisher | undefined;
  declare readonly copublishers: IsoPublisher[] | undefined;
  declare readonly typedStageState: TypedStageState | undefined;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    // The gem's default_publisher is nil on the IWA leaf ("IWA 1",
    // not "ISO IWA 1"), so no publisher is materialized there.
    const self = this as unknown as Record<string, unknown>;
    if (self["publisher"] === undefined && this.typeKey() !== "iwa") {
      self["publisher"] = new IsoPublisher({});
    }
  }

  render(): string {
    let result = "";
    if (this.typeKey() === "iwa") {
      const stage = this.stageString();
      if (stage !== "") result += stage;
    } else if (this.publisher !== undefined) {
      result += this.publisher.render();
      const stage = this.stageString();
      if (stage !== "") {
        const isGuide = this.typeKey() === "guide" && !(this instanceof IsoSupplementIdentifier);
        const sep = isGuide || (this.publisher.copublisher?.length ?? 0) > 0 ? " " : "/";
        result += `${sep}${stage}`;
      }
    }
    const num = this.numberPortion(true);
    if (num !== "") result += result === "" ? num : ` ${num}`;
    result += this.languagePortion(this.languageSingle());
    if (this.all_parts === true) result += " (all parts)";
    return result;
  }
}

// ---------------------------------------------------------------------------
// The concrete classes.
// ---------------------------------------------------------------------------

interface LeafSpec {
  kind: string;
  typeKey: string;
  supplement?: boolean;
  tc?: boolean;
  bundled?: boolean;
}

// IWA identifiers have no implied publisher ("IWA 1", not "ISO IWA
// 1"), so an explicitly parsed "ISO" still emits on the wire — the
// leaf's default publisher is nil on the Ruby side. Built lazily:
// SINGLE_MAPPINGS is declared below.
let iwaMappings: FieldMapping[] | undefined;

function isoClass(spec: LeafSpec): IdentifierStatic {
  const base = spec.supplement === true ? IsoSupplementIdentifier : spec.bundled === true ? IsoBundledBase : IsoSingleIdentifier;
  class IsoConcrete extends base {
    static polymorphicName = `pubid:iso:${spec.kind}`;
    static typeKey = spec.typeKey;
    static attributes = extendAttributes(base, {});
    static mappings = spec.typeKey === "iwa"
      ? (iwaMappings ??= SINGLE_MAPPINGS.map((m) => {
        if (m.wire !== "publisher") return m;
        return {
          wire: "publisher",
          to: "publisher",
          toWire: (mm: Record<string, unknown>) => (mm["publisher"] as IsoPublisher | undefined)?.publisher,
          fromWire: (h: Record<string, unknown>) => {
            if ((h["publisher"] === undefined || h["publisher"] === null) && h["copublishers"] === undefined) return undefined;
            const cps = Array.isArray(h["copublishers"]) ? h["copublishers"].map(String) : [];
            return new IsoPublisher({ publisher: h["publisher"] === undefined || h["publisher"] === null ? "ISO" : String(h["publisher"]), copublisher: cps });
          },
        };
      }))
      : (spec.supplement === true ? SUPPLEMENT_MAPPINGS : SINGLE_MAPPINGS);
    static urnGenerator = IsoUrnGenerator;
  }
  registerType(IsoConcrete as unknown as IdentifierStatic);
  return IsoConcrete as unknown as IdentifierStatic;
}

class IsoUrnGenerator extends BaseUrnGenerator<IsoIdentifier> {
  generate(): string {
    const id = this.identifier;
    if (id instanceof IsoDirectivesSupplement) {
      if (id.base === undefined) {
        const parts = ["urn", "iso", "doc"];
        if (id.supplement_publisher !== undefined) parts.push(id.supplement_publisher.toLowerCase());
        parts.push("sup");
        const d = urnDate(id);
        if (d !== undefined) parts.push(d);
        return parts.join(":");
      }
      const parts = id.base.toUrn().split(":");
      const sp = id.supplement_publisher ?? "";
      if (/^JTC\s+(\d+)$/i.test(sp)) {
        parts.push(...sp.toLowerCase().split(/\s+/));
        parts.push("sup");
      } else {
        parts.push("sup");
        if (sp !== "") parts.push(sp.toLowerCase());
      }
      const d = urnDate(id);
      if (d !== undefined) parts.push(d);
      if (id.edition !== undefined && id.edition.number !== undefined) parts.push(`ed-${id.edition.number}`);
      return parts.join(":");
    }
    if (id instanceof IsoSupplementIdentifier) return this.generateSupplementUrn(id);
    if (id instanceof IsoTcDocument) {
      const parts = ["urn:iso:doc"];
      if (id.publisher !== undefined) parts.push(id.publisher.publisher.toLowerCase());
      if (id.tc_number !== undefined) parts.push(`tc:${id.tc_number}`);
      if (id.sc_number !== undefined) parts.push(`sc-${id.sc_number}`);
      if (id.wg_number !== undefined) parts.push(`wg-${id.wg_number}`);
      if (id.number !== undefined) parts.push(id.number);
      return parts.join(":");
    }
    if (id instanceof IsoDirectives) {
      const parts = ["urn", "iso", "doc"];
      const pubs = [id.publisher?.publisher ?? "ISO", ...(id.publisher?.copublisher ?? [])].map((p) => p.toLowerCase());
      parts.push(pubs.join("-"));
      if (id.subgroup !== undefined) {
        const subgroupParts = id.subgroup.split(/\s+/);
        if (subgroupParts[0] !== undefined) parts.push(subgroupParts[0].toLowerCase());
        if (subgroupParts[1] !== undefined) parts.push(subgroupParts[1]);
      }
      parts.push("dir");
      if (id.number !== undefined) parts.push(id.number);
      if (id.part !== undefined) parts.push(id.part.toLowerCase());
      if (id.date?.year !== undefined) parts.push(id.date.year);
      return parts.join(":");
    }
    if (id instanceof IsoBundledIdentifier) {
      const parts = ["urn", ...(id.base_document?.toUrn() ?? "urn:iso:std:iso").split(":").slice(1)];
      for (const supplement of id.supplements) {
        parts.push(...supplement.toUrn().split(":").slice(3));
      }
      return parts.join(":");
    }
    return this.generateBaseUrn(id);
  }

  private originator(id: IsoIdentifier & { publisher?: IsoPublisher }): string {
    if (id.publisher === undefined) return "iso";
    const publishers = [id.publisher.publisher, ...(id.publisher.copublisher ?? [])];
    return publishers.map((p) => p.toLowerCase()).join("-");
  }

  private typeComponent(id: IsoIdentifier): string | undefined {
    const ts = id.typedStageState;
    if (ts === undefined) return undefined;
    const typeKey = id.typeKey();
    if (typeKey === "is") return undefined;
    const extended = TYPE_CODE_MAP[typeKey];
    if (extended !== undefined) return extended;
    if (typeKey === "rec") return "r";
    return typeKey;
  }

  private stageComponent(id: IsoIdentifier): string | undefined {
    const ts = id.typedStageState;
    if (ts === undefined) return undefined;
    const stageCode = ts.entry.stageCode;
    if (stageCode === "published") return undefined;
    const typeKey = id.typeKey();
    const combinedKey = typeKey !== "is" ? `${stageCode}${typeKey}` : stageCode;
    const stageAbbrUrn = TYPED_STAGE_MAP[combinedKey] ?? TYPED_STAGE_MAP[stageCode];
    if (stageAbbrUrn !== undefined) {
      if (id.stage_iteration !== undefined) return `${stageAbbrUrn}.${id.stage_iteration.render() ?? ""}`;
      return stageAbbrUrn;
    }
    const harmonized = ts.entry.harmonized;
    if (harmonized === undefined || harmonized.length === 0) return undefined;
    const first = harmonized[0]!;
    if (first.startsWith("60.") && stageCode !== "prf") return undefined;
    let stagePart = stageCode === "prf" && id.stage_iteration !== undefined ? "stage-draft" : `stage-${first}`;
    if (id.stage_iteration !== undefined && !(id instanceof IsoSupplementIdentifier)) {
      stagePart += `.v${id.stage_iteration.render() ?? ""}`;
    }
    return stagePart;
  }

  private generateBaseUrn(id: IsoIdentifier): string {
    const parts = ["urn", "iso", "std", this.originator(id as IsoIdentifier & { publisher?: IsoPublisher })];
    const typeComp = this.typeComponent(id);
    if (typeComp !== undefined) parts.push(typeComp);
    if (id.number !== undefined) parts.push(id.number);
    if (id.part !== undefined) {
      let partComp = `-${id.part}`;
      if (id.subpart !== undefined) partComp += `-${id.subpart}`;
      parts.push(partComp);
    }
    const stageComp = this.stageComponent(id);
    if (stageComp !== undefined && id.all_parts !== true) parts.push(stageComp);
    if (id.edition !== undefined && id.edition.number !== undefined) parts.push(`ed-${id.edition.number}`);
    if (id.languages !== undefined && id.languages.length > 0) {
      parts.push(id.languages.map((l) => l.code).join(","));
    }
    if (id.all_parts === true) parts.push("ser");
    return parts.join(":");
  }

  private generateSupplementUrn(id: IsoSupplementIdentifier): string {
    const chain: IsoSupplementIdentifier[] = [];
    let current: IsoIdentifier | undefined = id;
    while (current instanceof IsoSupplementIdentifier) {
      chain.unshift(current);
      current = current.base;
    }
    const baseId = current;
    const parts = ["urn", "iso", "std"];
    if (baseId !== undefined) {
      parts.push(this.originator(baseId as IsoIdentifier & { publisher?: IsoPublisher }));
      const typeComp = this.typeComponent(baseId);
      if (typeComp !== undefined) parts.push(typeComp);
      if (baseId.number !== undefined) parts.push(baseId.number);
      if (baseId.part !== undefined) {
        let partComp = `-${baseId.part}`;
        if (baseId.subpart !== undefined) partComp += `-${baseId.subpart}`;
        parts.push(partComp);
      }
      const editions: string[] = [];
      if (baseId.edition?.number !== undefined) editions.push(`ed-${baseId.edition.number}`);
      for (const supp of chain) {
        if (supp.edition?.number !== undefined) editions.push(`ed-${supp.edition.number}`);
      }
      parts.push(...editions);
      const baseStageComp = this.stageComponent(baseId);
      if (baseStageComp !== undefined) {
        const supplementStages = chain.map((s) => this.stageComponent(s)).filter((s): s is string => s !== undefined);
        if (supplementStages.length === 0) parts.push(baseStageComp);
        else if (baseStageComp.startsWith("stage-10.") && !supplementStages.includes(baseStageComp)) parts.push(baseStageComp);
      }
      if (baseId.languages !== undefined && baseId.languages.length > 0) {
        parts.push(baseId.languages.map((l) => l.code).join(","));
      }
    }
    for (const supp of chain) {
      const stageComp = this.stageComponent(supp);
      if (stageComp !== undefined) parts.push(stageComp);
      parts.push(supp.typeKey() === "suppl" || supp.typeKey() === "add" ? "sup" : supp.typeKey());
      const iter = supp.typeKey() === "suppl" || supp.stage_iteration === undefined ? undefined : supp.stage_iteration.render();
      const d = urnDate(supp);
      if (d !== undefined) {
        parts.push(d);
        if (supp.number !== undefined) parts.push(iter !== undefined ? `v${supp.number}.${iter}` : `v${supp.number}`);
      } else {
        if (supp.number !== undefined) parts.push(supp.number);
        parts.push(iter !== undefined ? `v1.${iter}` : "v1");
      }
      if (supp.languages !== undefined && supp.languages.length > 0) {
        parts.push(supp.languages.map((l) => l.code).join(","));
      }
    }
    if (id.all_parts === true) parts.push("ser");
    return parts.join(":");
  }
}


const SINGLE_MAPPINGS = keyValue(
  ...ISO_MAPPINGS,
  ...publisherMappings(),
  stageMapping(),
);

/** Supplements carry the publisher of the document they supplement
 * (SupplementIdentifier#publisher delegates to root). */
const supplementPublisherMappings = (): FieldMapping[] => [
  {
    wire: "publisher",
    to: "publisher",
    toWire: (m) => {
      const root = (m as unknown as { root?(): IsoIdentifier & { publisher?: IsoPublisher } }).root?.();
      const publisher = m["base"] !== undefined ? root?.publisher : (m["publisher"] as IsoPublisher | undefined);
      if (publisher === undefined || publisher.publisher === "ISO") return undefined;
      return publisher.publisher;
    },
    fromWire: (h) => {
      if ((h["publisher"] === undefined || h["publisher"] === null) && h["copublishers"] === undefined) return undefined;
      const cps = Array.isArray(h["copublishers"]) ? h["copublishers"].map(String) : [];
      return new IsoPublisher({ publisher: h["publisher"] === undefined || h["publisher"] === null ? "ISO" : String(h["publisher"]), copublisher: cps });
    },
  },
  {
    wire: "copublishers",
    to: "publisher",
    toWire: (m) => {
      const root = (m as unknown as { root?(): IsoIdentifier & { publisher?: IsoPublisher } }).root?.();
      const publisher = m["base"] !== undefined ? root?.publisher : (m["publisher"] as IsoPublisher | undefined);
      const cp = publisher?.copublisher;
      return cp === undefined || cp.length === 0 ? undefined : cp;
    },
    fromWire: (h) => {
      if (h["copublishers"] === undefined || h["copublishers"] === null) return undefined;
      const cps = Array.isArray(h["copublishers"]) ? h["copublishers"].map(String) : [];
      return new IsoPublisher({ publisher: h["publisher"] === undefined || h["publisher"] === null ? "ISO" : String(h["publisher"]), copublisher: cps });
    },
  },
];

const SUPPLEMENT_MAPPINGS = keyValue(
  ...ISO_MAPPINGS,
  ...supplementPublisherMappings(),
  stageMapping(),
  { wire: "base", to: "base" },
);

export abstract class IsoSupplementIdentifier extends IsoSingleIdentifier {
  static attributes = extendAttributes(IsoSingleIdentifier, {
    base: { type: IsoIdentifier as unknown as IdentifierStatic },
  });
  static mappings = SUPPLEMENT_MAPPINGS;

  declare readonly base: IsoIdentifier | undefined;

  render(): string {
    return this.renderSupplement(this.stageFormatLong());
  }

  renderAsSupplementBase(long: boolean): string {
    return this.renderSupplement(long);
  }

  private renderSupplement(long: boolean): string {
    const base = this.base;
    const baseStr = base === undefined ? "" : base.renderAsSupplementBase(long);
    const ts = this.typedStageState;
    const stage = ts === undefined ? "" : stageAbbr(ts.entry, long, ts.originalAbbr);
    let result = `${baseStr}/${stage}`;
    const num = this.numberPortion(true);
    if (num !== "") {
      if (!num.startsWith(":") && !stage.endsWith(".")) result += " ";
      result += num;
    }
    result += this.languagePortion(this.languageSingle());
    return result;
  }
}

export abstract class IsoBundledBase extends IsoSingleIdentifier {}

// The 18 type-keyed leaves (bundled-identifier is separate).
const LEAF_SPECS: LeafSpec[] = [
  { kind: "international-standard", typeKey: "is" },
  { kind: "international-standardized-profile", typeKey: "isp" },
  { kind: "international-workshop-agreement", typeKey: "iwa" },
  { kind: "technical-report", typeKey: "tr" },
  { kind: "technical-specification", typeKey: "ts" },
  { kind: "pas", typeKey: "pas" },
  { kind: "guide", typeKey: "guide" },
  { kind: "recommendation", typeKey: "rec" },
  { kind: "amendment", typeKey: "amd", supplement: true },
  { kind: "corrigendum", typeKey: "cor", supplement: true },
  { kind: "supplement", typeKey: "suppl", supplement: true },
  { kind: "addendum", typeKey: "add", supplement: true },
  { kind: "extract", typeKey: "ext", supplement: true },
  { kind: "data", typeKey: "data" },
  { kind: "technology-trends-assessments", typeKey: "tta" },
];

const LEAF_CLASSES = new Map<string, IdentifierStatic>(LEAF_SPECS.map((spec) => [spec.typeKey, isoClass(spec)]));

export function isoClassForType(typeKey: string): IdentifierStatic | undefined {
  return LEAF_CLASSES.get(typeKey);
}

// --- Directives (+ subgroup) -------------------------------------------------

export class IsoDirectives extends IsoSingleIdentifier {
  static polymorphicName = "pubid:iso:directives";
  static typeKey = "dir";
  static attributes = extendAttributes(IsoSingleIdentifier, {
    subgroup: { type: "string" },
  });
  static mappings = keyValue(
    ...SINGLE_MAPPINGS,
    {
      wire: "subgroup",
      to: "subgroup",
      fromWire: (h) => {
        const v = h["subgroup"];
        if (v === undefined || v === null) return undefined;
        // The wire is a flat scalar since the gem flattened the
        // { value: X } nesting; keep reading the old shape defensively.
        if (typeof v === "object") return String((v as Record<string, unknown>)["value"] ?? "");
        return String(v);
      },
    },
  );
  static urnGenerator = IsoUrnGenerator;

  declare readonly subgroup: string | undefined;

  render(): string {
    let head = this.publisher === undefined ? "" : this.publisher.render();
    if (this.subgroup !== undefined) head += ` ${this.subgroup}`;
    // DirectivesRenderer pins the SHORT abbreviation regardless of the
    // parsed spelling.
    const abbr = this.typedStageState === undefined ? "" : stageAbbr(this.typedStageState.entry, false);
    if (abbr !== "") head += ` ${abbr}`;
    let num = this.number ?? "";
    if (this.part !== undefined) num += ` ${this.part}`;
    if (this.subpart !== undefined) num += `-${this.subpart}`;
    if (this.stage_iteration !== undefined) num += `.${this.stage_iteration.render() ?? ""}`;
    if (this.date !== undefined && this.date.present()) num += `:${this.date.render()}`;
    if (num === "") return head;
    if (num.startsWith(":")) return head + num;
    return `${head} ${num}`;
  }
}
registerType(IsoDirectives as unknown as IdentifierStatic);

// --- Directives Supplement (+ supplement_publisher) --------------------------

export class IsoDirectivesSupplement extends IsoSupplementIdentifier {
  static polymorphicName = "pubid:iso:directives-supplement";
  static typeKey = "dir-sup";
  static attributes = extendAttributes(IsoSupplementIdentifier, {
    supplement_publisher: { type: "string" },
  });
  static mappings = keyValue(
    ...ISO_MAPPINGS,
    stageMapping(),
    { wire: "base", to: "base" },
    { wire: "publisher", to: "supplement_publisher" },
  );
  static urnGenerator = IsoUrnGenerator;

  declare readonly supplement_publisher: string | undefined;
  declare readonly base: IsoIdentifier | undefined;

  render(): string {
    if (this.base !== undefined) {
      let result = this.base.toHuman();
      result += ` ${this.supplement_publisher ?? ""} SUP`;
      if (this.date !== undefined && this.date.present()) result += `:${this.date.render()}`;
      if (this.edition !== undefined && this.edition.number !== undefined) result += ` Edition ${this.edition.number}`;
      return result;
    }
    return `${this.supplement_publisher ?? ""} SUP${this.date !== undefined && this.date.present() ? `:${this.date.render()}` : ""}`;
  }
}
registerType(IsoDirectivesSupplement as unknown as IdentifierStatic);

// --- TC documents -------------------------------------------------------------

export class IsoTcDocument extends IsoIdentifier {
  static polymorphicName = "pubid:iso:tc-document";
  static typeKey = "tc";
  static attributes = extendAttributes(IsoIdentifier, {
    publisher: { type: IsoPublisher },
    tc_type: { type: "string" },
    tc_number: { type: "string" },
    sc_type: { type: "string" },
    sc_number: { type: "string" },
    wg_type: { type: "string" },
    wg_number: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "tc_type", to: "tc_type" },
    { wire: "tc_number", to: "tc_number" },
    { wire: "sc_type", to: "sc_type" },
    { wire: "sc_number", to: "sc_number" },
    { wire: "wg_type", to: "wg_type" },
    { wire: "wg_number", to: "wg_number" },
    { wire: "number", to: "number" },
    ...dateTrio(),
    { wire: "publisher", to: "publisher" },
  );
  static urnGenerator = IsoUrnGenerator;

  declare readonly publisher: IsoPublisher | undefined;
  declare readonly tc_type: string | undefined;
  declare readonly tc_number: string | undefined;
  declare readonly sc_type: string | undefined;
  declare readonly sc_number: string | undefined;
  declare readonly wg_type: string | undefined;
  declare readonly wg_number: string | undefined;

  render(): string {
    let result = this.publisher === undefined ? "" : this.publisher.render();
    if (this.tc_type !== undefined && this.tc_type !== "") result += `/${this.tc_type} `;
    if (this.tc_number !== undefined) result += this.tc_number;
    if (this.sc_type !== undefined && this.sc_number !== undefined) result += `/${this.sc_type} ${this.sc_number}`;
    if (this.wg_type !== undefined && this.wg_number !== undefined) result += `/${this.wg_type} ${this.wg_number}`;
    if (this.number !== undefined && this.number !== "") result += ` N ${this.number}`;
    if (this.date?.year !== undefined) result += `:${this.date.render()}`;
    return result;
  }
}
registerType(IsoTcDocument as unknown as IdentifierStatic);

// --- Bundled identifier ---------------------------------------------------------

export class IsoBundledIdentifier extends IsoIdentifier {
  static polymorphicName = "pubid:iso:bundled-identifier";
  static typeKey = "bundled";
  static attributes = extendAttributes(IsoIdentifier, {
    base_document: { type: IsoIdentifier as unknown as IdentifierStatic },
    supplements: { type: IsoIdentifier as unknown as IdentifierStatic, collection: true, initializeEmpty: true },
  });
  static mappings = keyValue(
    { wire: "base", to: "base_document" },
    { wire: "supplements", to: "supplements" },
  );
  static urnGenerator = IsoUrnGenerator;

  declare readonly base_document: IsoIdentifier | undefined;
  declare readonly supplements: IsoIdentifier[];

  render(): string {
    const parts = [this.base_document?.toHuman() ?? ""];
    for (const supplement of this.supplements) {
      parts.push(`+ ${supplement.toHuman()}`);
    }
    return parts.join(" ");
  }
}
registerType(IsoBundledIdentifier as unknown as IdentifierStatic);

// ---------------------------------------------------------------------------
// URN generation (lib/pubid/iso/urn_generator.rb).
// ---------------------------------------------------------------------------

const TYPED_STAGE_MAP: Record<string, string> = {
  wd: "WD", wds: "WDS", cd: "CD", cdv: "CDV", dis: "DIS", fdis: "FDIS",
  pdam: "PDAM", dam: "DAM", fdamd: "FDAM", dcor: "DCOR", fdcor: "FDCOR",
  cdts: "CDTS", dts: "DTS", fdts: "FDTS",
};

const TYPE_CODE_MAP: Record<string, string> = { dir: "dir", "dir-sup": "dir-sup", "iwa-sup": "iwa-sup" };

function urnDate(id: IsoIdentifier): string | undefined {
  if (id.date === undefined || !id.date.present() || id.date.undated === true) return undefined;
  return id.date.year;
}

