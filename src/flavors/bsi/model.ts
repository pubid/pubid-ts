import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type AttributeTable, type FieldMapping } from "../../model/attribute.js";
import { PubidDate, Publisher } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/bsi: the shared base (single_identifier.rb), the
 * typed-stage registry (bsi.rb TYPED_STAGES_REGISTRY), the ~25 concrete
 * identifier classes, the renderer (renderer.rb) and the URN generator
 * (urn_generator.rb).
 */

// --- Code component (components/code.rb — wire {value}) ---------------------------

export class BsiCode {
  readonly value: string;

  constructor(attrs: Record<string, unknown>) {
    this.value = attrs["value"] as string;
  }

  render(): string {
    return this.value;
  }

  toWire(): Record<string, unknown> {
    return { value: this.value };
  }
}

// --- Typed-stage registry ----------------------------------------------------------

export interface BsiTypedStage {
  code: string;
  stageCode: string;
  typeCode: string;
  abbr: string[];
}

export const TYPED_STAGES_REGISTRY: BsiTypedStage[] = [
  { code: "pubbs", stageCode: "published", typeCode: "bs", abbr: ["BS"] },
  { code: "drbs", stageCode: "draft", typeCode: "bs", abbr: ["Draft BS", "DBS"] },
  { code: "pubpd", stageCode: "published", typeCode: "pd", abbr: ["PD"] },
  { code: "pubpas", stageCode: "published", typeCode: "pas", abbr: ["PAS"] },
  { code: "pubna", stageCode: "published", typeCode: "na", abbr: ["NA"] },
  { code: "pubdd", stageCode: "published", typeCode: "dd", abbr: ["DD"] },
  { code: "pubflex", stageCode: "published", typeCode: "flex", abbr: ["Flex", "BSI Flex"] },
  { code: "pubhb", stageCode: "published", typeCode: "handbook", abbr: ["Handbook", "HB"] },
  { code: "pubpp", stageCode: "published", typeCode: "pp", abbr: ["PP"] },
  { code: "pubbip", stageCode: "published", typeCode: "bip", abbr: ["BIP"] },
  { code: "pubas", stageCode: "published", typeCode: "aerospace", abbr: ["BS A", "BS AU", "BS C", "BS M", "BS S", "BS L", "BS TA", "BS MA", "BS PL", "BS QC", "BS G", "BS HC", "BS F", "BS X", "BS B"] },
  { code: "pubidx", stageCode: "published", typeCode: "index", abbr: ["Index"] },
  { code: "pubmet", stageCode: "published", typeCode: "method", abbr: ["Method", "Methods"] },
  { code: "pubsec", stageCode: "published", typeCode: "section", abbr: ["Section"] },
  { code: "pubdisc", stageCode: "published", typeCode: "disc", abbr: ["DISC"] },
  { code: "pubds", stageCode: "published", typeCode: "detailed_specification", abbr: ["DETAILED SPEC"] },
  { code: "pubamd", stageCode: "published", typeCode: "amendment", abbr: ["AMD"] },
  { code: "pubts", stageCode: "published", typeCode: "ts", abbr: ["TS"] },
];

export const DEFAULT_TYPED_STAGE = TYPED_STAGES_REGISTRY[0]!;

export function locateStage(abbr: string): BsiTypedStage | undefined {
  const needle = abbr.trim().toUpperCase();
  return TYPED_STAGES_REGISTRY.find((s) => s.abbr.some((a) => a.toUpperCase() === needle));
}

export const TYPE_CLASSES: Record<string, IdentifierStatic> = {};

function locateTypeClass(typeCode: string): IdentifierStatic | undefined {
  return TYPE_CLASSES[typeCode];
}

class BsiUrnGenerator extends BaseUrnGenerator<BsiIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "bsi"];

    if (id.publisher !== undefined) {
      parts.push(id.publisher.render("urn"));
    } else {
      parts.push("bs");
    }
    if (id.prefix !== undefined) parts.push(id.prefix.toLowerCase());
    if (id.flex_prefix !== undefined) parts.push(id.flex_prefix.toLowerCase());

    // Identity reads walk to the wrapped document (root) when the
    // wrapper has none of its own.
    const root = id.root();
    const urnNumber = id.number ?? (root !== id ? root.number : undefined);
    if (urnNumber !== undefined) {
      let number = urnNumber;
      if (id.iteration !== undefined && id.iteration !== "") {
        number += `[${id.iteration}]`;
      }
      parts.push(number);
    }

    const urnPart = id.part ?? (root !== id ? root.part : undefined);
    if (urnPart !== undefined) parts.push(`-${urnPart}`);
    const urnSubpart = id.subpart ?? (root !== id ? root.subpart : undefined);
    if (urnSubpart !== undefined) parts.push(`-${urnSubpart}`);

    if (id.second_number !== undefined) parts.push(`/${id.second_number.render()}`);

    const urnDate = id.date ?? (root !== id ? root.date : undefined);
    if (urnDate?.present()) {
      parts.push(urnDate.render("urn")!);
    } else {
      const urnYear = (id as unknown as { year?: string }).year
        ?? (root !== id ? (root as unknown as { year?: string }).year : undefined);
      if (urnYear !== undefined) parts.push(urnYear);
    }

    if (id.month !== undefined) parts.push(pad2(id.month));
    if (id.edition !== undefined) parts.push(`v${id.edition}`);
    if (id.translation_lang !== undefined) parts.push(id.translation_lang.toLowerCase());
    else if (id.translation_upper !== undefined) parts.push(id.translation_upper.toLowerCase());

    const type = (id as unknown as { typeAbbr?: string }).typeAbbr;
    if (type !== undefined && type !== "BS") parts.push(type.toLowerCase());

    const typedStage = (id as unknown as { typedStage?: BsiTypedStage }).typedStage;
    if (typedStage !== undefined && typedStage.stageCode !== "published") {
      parts.push(`stage.${typedStage.stageCode}`);
    }

    return parts.join(":");
  }
}

// --- The base class ----------------------------------------------------------------

export class BsiIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:bsi:identifier";
  static urnGenerator = BsiUrnGenerator;
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: Publisher, default: new Publisher({ body: "BS" }) },
    prefix: { type: "string" },
    flex_prefix: { type: "string" },
    number: { type: "string" },
    iteration: { type: "string" },
    part: { type: "string" },
    subpart: { type: "string" },
    second_number: { type: BsiCode },
    date: { type: PubidDate },
    edition: { type: "string" },
    month: { type: "integer" },
    translation_lang: { type: "string" },
    translation_upper: { type: "string" },
    explicit_prefix: { type: "boolean", default: false },
    explicit_publisher: { type: "boolean", default: false },
    space_separated_part: { type: "boolean", default: false },
  });
  // type/stage/typed_stage/original_abbr are runtime-only (never wire).
  static mappings: FieldMapping[] = keyValue(
    { wire: "publisher", to: "publisher" },
    { wire: "prefix", to: "prefix" },
    { wire: "flex_prefix", to: "flex_prefix" },
    { wire: "number", to: "number" },
    { wire: "iteration", to: "iteration" },
    { wire: "part", to: "part" },
    { wire: "subpart", to: "subpart" },
    { wire: "second_number", to: "second_number" },
    { wire: "date", to: "date" },
    { wire: "edition", to: "edition" },
    { wire: "month", to: "month" },
    { wire: "translation_lang", to: "translation_lang" },
    { wire: "translation_upper", to: "translation_upper" },
    { wire: "explicit_prefix", to: "explicit_prefix" },
    { wire: "explicit_publisher", to: "explicit_publisher" },
    { wire: "space_separated_part", to: "space_separated_part" },
  );

  declare readonly publisher: Publisher | undefined;
  declare readonly prefix: string | undefined;
  declare readonly flex_prefix: string | undefined;
  declare readonly number: string | undefined;
  declare readonly iteration: string | undefined;
  declare readonly part: string | undefined;
  declare readonly subpart: string | undefined;
  declare readonly second_number: BsiCode | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly edition: string | undefined;
  declare readonly month: number | undefined;
  declare readonly translation_lang: string | undefined;
  declare readonly translation_upper: string | undefined;
  declare readonly explicit_prefix: boolean | undefined;
  declare readonly explicit_publisher: boolean | undefined;
  declare readonly space_separated_part: boolean | undefined;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    const self = this as unknown as Record<string, unknown>;
    if (self["publisher"] === undefined) self["publisher"] = new Publisher({ body: "BS" });
  }

  root(): BsiIdentifier {
    return this;
  }

  render(): string {
    return renderSingleIdentifier(this);
  }
}

// --- Renderer helpers --------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function renderSingleIdentifier(id: BsiIdentifier): string {
  const parts: string[] = [];
  if (id.publisher !== undefined) parts.push(id.publisher.render());
  if (id.flex_prefix !== undefined) parts.push(id.flex_prefix);
  else if (id.prefix !== undefined) parts.push(id.prefix);

  if (id.number !== undefined) {
    let numberStr = id.number;
    if (id.second_number !== undefined) {
      numberStr += `/${id.second_number.render()}`;
    }
    if (id.part !== undefined) {
      numberStr += `${id.space_separated_part ? " " : "-"}${id.part.trim()}`;
    }
    if (id.subpart !== undefined) {
      numberStr += `-${id.subpart.trim()}`;
    }
    if (id.iteration !== undefined && id.iteration !== "") {
      numberStr += `[${id.iteration}]`;
    }
    parts.push(numberStr);
  }

  let result = parts.join(" ");
  if (id.date?.present()) {
    result += `:${id.date.render()}`;
    if (id.month !== undefined) result += `-${pad2(id.month)}`;
  }
  if (id.edition !== undefined) result += ` v${id.edition}`;
  if (id.translation_lang !== undefined) result += ` (${id.translation_lang})`;
  else if (id.translation_upper !== undefined) result += ` (${id.translation_upper})`;
  return result;
}

function renderNumberWithParts(id: BsiIdentifier): string {
  let numberStr = id.number ?? "";
  if (id.second_number !== undefined) numberStr += `/${id.second_number.render()}`;
  if (id.part !== undefined) numberStr += `-${id.part.trim()}`;
  if (id.subpart !== undefined) numberStr += `-${id.subpart.trim()}`;
  return numberStr;
}

// --- The URN generator -------------------------------------------------------------

// --- Concrete classes --------------------------------------------------------------

interface TypeSpec {
  kind: string;
  typeCode?: string;
  typeAbbr?: string;
  rootKind?: "base" | "first";
}

function bsiClass(spec: TypeSpec, render: (id: BsiIdentifier) => string): IdentifierStatic {
  class BsiConcrete extends BsiIdentifier {
    static polymorphicName = `pubid:bsi:${spec.kind}`;
    static urnGenerator = BsiUrnGenerator;

    render(): string {
      return render(this);
    }
  }
  void spec;
  registerType(BsiConcrete as unknown as IdentifierStatic);
  const klass = BsiConcrete as unknown as IdentifierStatic;
  if (spec.typeCode !== undefined) TYPE_CLASSES[spec.typeCode] = klass;
  return klass;
}

function renderWithTypeAbbr(abbr: string) {
  return (id: BsiIdentifier): string => {
    let result = [abbr, id.number !== undefined ? renderNumberWithParts(id) : ""]
      .filter((s) => s !== "").join(" ");
    if (id.date?.present()) {
      result += `:${id.date.render()}`;
      if (id.month !== undefined) result += `-${pad2(id.month)}`;
    }
    if (id.edition !== undefined) result += ` v${id.edition}`;
    if (id.translation_lang !== undefined) result += ` (${id.translation_lang})`;
    else if (id.translation_upper !== undefined) result += ` (${id.translation_upper})`;
    return result;
  };
}

export const BritishStandardClass = bsiClass({ kind: "british-standard", typeCode: "bs" }, (id) => renderSingleIdentifier(id));
export const DraftDocumentClass = bsiClass({ kind: "draft-document", typeCode: "dd" }, renderWithTypeAbbr("DD"));
export const PublishedDocumentClass = bsiClass({ kind: "published-document", typeCode: "pd" }, renderWithTypeAbbr("PD"));
export const PubliclyAvailableSpecificationClass = bsiClass({ kind: "publicly-available-specification", typeCode: "pas" }, renderWithTypeAbbr("PAS"));
export const TechnicalSpecificationClass = bsiClass({ kind: "technical-specification", typeCode: "ts" }, renderWithTypeAbbr("TS"));
export const ElectronicBookClass = bsiClass({ kind: "electronic-book", typeCode: "ep" }, (id) => {
  let result = ["EP", id.number !== undefined ? renderNumberWithParts(id) : ""]
    .filter((s) => s !== "").join(" ");
  if (id.date?.present()) result += `:${id.date.render()}`;
  if (id.edition !== undefined) result += ` Version ${id.edition}`;
  return result;
});
export const AerospaceStandardClass = bsiClass({ kind: "aerospace-standard", typeCode: "aerospace" }, (id) => {
  const parts = ["BS"];
  if (id.prefix !== undefined) parts.push(id.prefix);
  if (id.number !== undefined) parts.push(renderNumberWithParts(id));
  let result = parts.join(" ");
  if (id.edition !== undefined && /^[a-zA-Z]$/.test(id.edition)) result += id.edition;
  if (id.date?.present()) {
    result += `:${id.date.render()}`;
    if (id.month !== undefined) result += `-${pad2(id.month)}`;
  }
  if (id.edition !== undefined && !/^[a-zA-Z]$/.test(id.edition)) result += ` v${id.edition}`;
  if (id.translation_lang !== undefined) result += ` (${id.translation_lang})`;
  else if (id.translation_upper !== undefined) result += ` (${id.translation_upper})`;
  return result;
});
export const FlexClass = bsiClass({ kind: "flex", typeCode: "flex" }, (id) => {
  const parts = ["BSI Flex"];
  if (id.number !== undefined) parts.push(renderNumberWithParts(id));
  let result = parts.join(" ");
  if (id.edition !== undefined) result += ` v${id.edition}`;
  if (id.date?.present()) {
    result += `:${id.date.render()}`;
    if (id.month !== undefined) result += `-${pad2(id.month)}`;
  }
  return result;
});

registerType(BsiIdentifier as unknown as IdentifierStatic);

// --- Suffix-type classes -------------------------------------------------------------

class ConsolidatedUrnGenerator extends BaseUrnGenerator<BsiIdentifier> {
  generate(): string {
    return consolidatedUrn(this.identifier as unknown as ConsolidatedLike) ?? "";
  }
}

function bsiClassWith(spec: TypeSpec, extraAttrs: AttributeTable, render: (id: never) => string): IdentifierStatic {
  // 'base' wrappers root through their base document; 'first' through
  // the first member of their identifiers collection.
  const rootKind = spec.rootKind;
  class BsiConcrete extends BsiIdentifier {
    static polymorphicName = `pubid:bsi:${spec.kind}`;
    static urnGenerator = spec.kind === "consolidated-identifier" ? ConsolidatedUrnGenerator : BsiUrnGenerator;
    static attributes = extendAttributes(BsiIdentifier, extraAttrs);
    static mappings: FieldMapping[] = [
      ...BsiIdentifier.mappings,
      ...Object.keys(extraAttrs).map((k) => ({ wire: k, to: k })) as FieldMapping[],
    ];

    root(): BsiIdentifier {
      if (rootKind === "base") {
        return (this as unknown as { base?: BsiIdentifier }).base?.root() ?? this;
      }
      if (rootKind === "first") {
        const first = (this as unknown as { identifiers?: BsiIdentifier[] }).identifiers?.[0];
        return first !== undefined ? first.root() : this;
      }
      return this;
    }

    render(): string {
      return render(this as never);
    }
  }
  registerType(BsiConcrete as unknown as IdentifierStatic);
  const klass = BsiConcrete as unknown as IdentifierStatic;
  if (spec.typeCode !== undefined) TYPE_CLASSES[spec.typeCode] = klass;
  return klass;
}



interface IndexLike extends BsiIdentifier {
  issue_number: string | undefined;
  index_format: string | undefined;
}

export const IndexClass = bsiClassWith(
  { kind: "index", typeCode: "index" },
  { issue_number: { type: "string" }, index_format: { type: "string" } },
  (id: IndexLike) => {
    const parts: string[] = [];
    if (id.publisher !== undefined) parts.push(id.publisher.render());
    if (id.number !== undefined) parts.push(id.number);
    let result = parts.join(" ");
    if (id.issue_number !== undefined) {
      result += ` Index Issue ${id.issue_number}`;
    } else if (id.index_format === "colon") {
      result += ":Index";
    } else {
      result += " Index";
    }
    if (id.date?.present()) result += `:${id.date.render()}`;
    return result;
  },
);

export const SupplementaryIndexClass = bsiClassWith(
  { kind: "supplementary-index" },
  {},
  (id: BsiIdentifier) => {
    let result = ["BS", id.number !== undefined ? renderNumberWithParts(id) : ""]
      .filter((x) => x !== "").join(" ");
    if (id.date?.present()) {
      result += ` Supplementary Index:${id.date.render()}`;
      if (id.month !== undefined) result += `-${pad2(id.month)}`;
    }
    return result;
  },
);

export const ExplanatorySupplementClass = bsiClassWith(
  { kind: "explanatory-supplement" },
  {},
  (id: BsiIdentifier) => {
    let result = ["BS", id.number !== undefined ? renderNumberWithParts(id) : ""]
      .filter((x) => x !== "").join(" ");
    if (id.date?.present()) {
      result += `:Explanatory Supplement:${id.date.render()}`;
      if (id.month !== undefined) result += `-${pad2(id.month)}`;
    }
    return result;
  },
);

interface MethodLike extends BsiIdentifier {
  method_code: string | undefined;
  method_to: string | undefined;
  method_and: string | undefined;
  is_plural: boolean | undefined;
}

export const MethodClass = bsiClassWith(
  { kind: "method", typeCode: "method" },
  { method_code: { type: "string" }, method_to: { type: "string" }, method_and: { type: "string" }, is_plural: { type: "boolean" } },
  (id: MethodLike) => {
    const parts: string[] = [];
    if (id.publisher !== undefined) parts.push(id.publisher.render());
    if (id.number !== undefined) {
      parts.push(id.part !== undefined ? `${id.number}-${id.part}` : id.number);
    }
    let result = parts.join(" ");
    if (id.method_to !== undefined) {
      result += `:Methods ${id.method_code} to ${id.method_to}`;
    } else if (id.method_and !== undefined) {
      result += `:Methods ${id.method_code} and ${id.method_and}`;
    } else {
      result += `:${id.is_plural ? "Methods" : "Method"} ${id.method_code}`;
    }
    if (id.date?.present()) result += `:${id.date.render()}`;
    return result;
  },
);

interface TestMethodLike extends BsiIdentifier {
  test_series: string | undefined;
  test_id: string | undefined;
}

export const TestMethodClass = bsiClassWith(
  { kind: "test-method", typeCode: "test_method" },
  { test_series: { type: "string" }, test_id: { type: "string" } },
  (id: TestMethodLike) => {
    let result = ["BS", id.number ?? ""].join(" ");
    if (id.test_series !== undefined && id.test_id !== undefined) {
      result += `:${id.test_series}:${id.test_id}`;
    }
    if (id.date?.present()) result += `:${id.date.render()}`;
    return result;
  },
);

interface SectionLike extends BsiIdentifier {
  section_id: string | undefined;
  section_format: string | undefined;
}

export const SectionClass = bsiClassWith(
  { kind: "section", typeCode: "section" },
  { section_id: { type: "string" }, section_format: { type: "string" } },
  (id: SectionLike) => {
    const parts: string[] = [];
    if (id.publisher !== undefined) parts.push(id.publisher.render());
    if (id.number !== undefined) parts.push(id.number);
    let result = parts.join(" ");
    result += id.section_format === "colon"
      ? `:Section ${id.section_id}`
      : ` Section ${id.section_id}`;
    if (id.date?.present()) result += `:${id.date.render()}`;
    return result;
  },
);

interface DetailedSpecLike extends BsiIdentifier {
  spec_code: BsiCode | undefined;
}

export const DetailedSpecificationClass = bsiClassWith(
  { kind: "detailed-specification", typeCode: "detailed_specification" },
  { spec_code: { type: BsiCode } },
  (id: DetailedSpecLike) => {
    let result = ["BS", id.number ?? ""].join(" ");
    if (id.spec_code !== undefined) result += ` ${id.spec_code.render()}`;
    if (id.date?.present()) result += `:${id.date.render()}`;
    return result;
  },
);

export const DiscClass = bsiClassWith(
  { kind: "disc", typeCode: "disc" },
  {},
  (id: BsiIdentifier) => {
    let numberStr = id.number ?? "";
    if (id.part !== undefined) numberStr += `-${id.part.trim()}`;
    let result = ["DISC", numberStr !== "" ? `PD ${numberStr}` : ""].filter((x) => x !== "").join(" ");
    if (id.date?.present()) result += `:${id.date.render()}`;
    return result;
  },
);

interface StandaloneAmdLike extends BsiIdentifier {
  corrigendum: boolean | undefined;
  parenthesized: boolean | undefined;
}

export const StandaloneAmendmentClass = bsiClassWith(
  { kind: "standalone-amendment", typeCode: "amendment" },
  { corrigendum: { type: "boolean", default: false }, parenthesized: { type: "boolean", default: false } },
  (id: StandaloneAmdLike) => {
    const base = id.corrigendum
      ? `AMD Corrigendum ${id.number}`
      : `AMD ${id.number}`;
    return id.parenthesized ? `(${base})` : base;
  },
);

export const CommitteeDocumentClass = bsiClassWith(
  { kind: "committee-document", typeCode: "committee_document" },
  {},
  (id: BsiIdentifier) => {
    const yearStr = id.date?.present() ? id.date.render()!.slice(-2) : "00";
    return `${yearStr}/${id.number} DC`;
  },
);

// --- Wrapper classes ----------------------------------------------------------------

interface SupplementLike extends BsiIdentifier {
  base: BsiIdentifier | undefined;
  year: string | undefined;
  separator: string | undefined;
  amd_suffix_form: boolean | undefined;
}

export class Amendment extends BsiIdentifier {
  static polymorphicName = "pubid:bsi:amendment";
  static urnGenerator = BsiUrnGenerator;
  static attributes = extendAttributes(BsiIdentifier, {
    base: { type: BsiIdentifier as unknown as IdentifierStatic },
    year: { type: "string" },
    separator: { type: "string", default: "+" },
    amd_suffix_form: { type: "boolean", default: false },
  });
  static mappings: FieldMapping[] = [
    ...BsiIdentifier.mappings.filter((m) => m.wire !== "publisher" && m.wire !== "date"),
    { wire: "base", to: "base" },
    { wire: "year", to: "year" },
    { wire: "separator", to: "separator" },
    { wire: "amd_suffix_form", to: "amd_suffix_form" },
  ];

  declare readonly base: BsiIdentifier | undefined;
  declare readonly year: string | undefined;
  declare readonly separator: string | undefined;
  declare readonly amd_suffix_form: boolean | undefined;

  root(): BsiIdentifier {
    return this.base?.root() ?? this;
  }

  render(): string {
    const base = this.base?.toHuman() ?? "";
    if (this.amd_suffix_form) {
      const suffix = this.number !== undefined && /^[A-Z]+$/.test(this.number)
        ? ` AMD ${this.number}`
        : ` AMD${this.number ?? ""}`;
      return base === "" ? suffix.trimStart() : `${base}${suffix}`;
    }
    let compact = `${this.separator ?? "+"}A${this.number ?? ""}`;
    if (this.year !== undefined) compact += `:${this.year}`;
    return `${base}${compact}`;
  }
}

export class Corrigendum extends BsiIdentifier {
  static polymorphicName = "pubid:bsi:corrigendum";
  static urnGenerator = BsiUrnGenerator;
  static attributes = extendAttributes(BsiIdentifier, {
    base: { type: BsiIdentifier as unknown as IdentifierStatic },
    year: { type: "string" },
    separator: { type: "string", default: "+" },
  });
  static mappings: FieldMapping[] = [
    ...BsiIdentifier.mappings.filter((m) => m.wire !== "publisher" && m.wire !== "date"),
    { wire: "base", to: "base" },
    { wire: "year", to: "year" },
    { wire: "separator", to: "separator" },
  ];

  declare readonly base: BsiIdentifier | undefined;
  declare readonly year: string | undefined;
  declare readonly separator: string | undefined;

  root(): BsiIdentifier {
    return this.base?.root() ?? this;
  }

  render(): string {
    let result = this.base?.toHuman() ?? "";
    result += `${this.separator ?? "+"}C`;
    if (this.number !== undefined) result += this.number;
    if (this.year !== undefined) result += `:${this.year}`;
    return result;
  }
}

interface SuppDocLike extends BsiIdentifier {
  base: BsiIdentifier | undefined;
  supplement_number: string | undefined;
  supplement_year: number | undefined;
  supplement_type: string | undefined;
  reverse_format: boolean | undefined;
  separator: string | undefined;
}

export const SupplementDocumentClass = bsiClassWith(
  { kind: "supplement-document", rootKind: "base" },
  {
    base: { type: BsiIdentifier as unknown as IdentifierStatic },
    supplement_number: { type: "string" },
    supplement_year: { type: "integer" },
    supplement_type: { type: "string", default: "No." },
    reverse_format: { type: "boolean", default: false },
    separator: { type: "string", default: ":" },
  },
  (id: SuppDocLike) => {
    const baseStr = id.base?.toHuman() ?? "";
    if (id.reverse_format) {
      const no = id.supplement_type === "No." ? "No. " : "";
      return `Supplement ${no}${id.supplement_number} (${id.supplement_year}) to ${baseStr}`;
    }
    const no = id.supplement_type === "No." ? "No. " : "";
    return `${baseStr}${id.separator ?? ":"}Supplement ${no}${id.supplement_number}:${id.supplement_year}`;
  },
);

interface AddendumDocLike extends BsiIdentifier {
  base: BsiIdentifier | undefined;
  addendum_number: string | undefined;
  addendum_year: number | undefined;
  addendum_type: string | undefined;
  separator: string | undefined;
}

export const AddendumDocumentClass = bsiClassWith(
  { kind: "addendum-document", rootKind: "base" },
  {
    base: { type: BsiIdentifier as unknown as IdentifierStatic },
    addendum_number: { type: "string" },
    addendum_year: { type: "integer" },
    addendum_type: { type: "string", default: "No." },
    separator: { type: "string", default: ":" },
  },
  (id: AddendumDocLike) => {
    const baseStr = id.base?.toHuman() ?? "";
    const baseHasYear = /:(\d{4})$/.test(baseStr);
    const sep = id.separator === ":"
      ? ":"
      : baseHasYear && !/\d{4}:/.test(baseStr)
        ? " "
        : id.separator ?? ":";
    const no = id.addendum_type === "" ? "" : ` ${id.addendum_type}`;
    return `${baseStr}${sep}Addendum${no} ${id.addendum_number}:${id.addendum_year ?? ""}`;
  },
);

interface BundledLike extends BsiIdentifier {
  identifiers: BsiIdentifier[];
  separators: string[] | undefined;
  common_year: PubidDate | undefined;
  bundle_type: string | undefined;
}

export const BundledIdentifierClass = bsiClassWith(
  { kind: "bundled-identifier", rootKind: "first" },
  {
    identifiers: { type: BsiIdentifier as unknown as IdentifierStatic, collection: true },
    separators: { type: "string", collection: true },
    common_year: { type: PubidDate },
    bundle_type: { type: "string" },
  },
  (id: BundledLike) => {
    if (id.identifiers === undefined || id.identifiers.length === 0) return "";
    if (id.bundle_type !== undefined) {
      const baseId = id.identifiers[0]!;
      const partsList = id.identifiers.slice(1)
        .map((idd) => (idd as unknown as { part?: string }).part ?? idd.toHuman())
        .join(" and ");
      let result = `${baseId.toHuman().replace(/:.*$/, "")}:${id.bundle_type} ${partsList}`;
      if (id.common_year?.present()) result += `:${id.common_year.render()}`;
      return result;
    }
    const parts: string[] = [];
    id.identifiers.forEach((idd, i) => {
      const self = idd as unknown as Record<string, unknown>;
      if (i === 0 || self["explicit_publisher"] === true) {
        parts.push(idd.toHuman());
      } else if (self["explicit_prefix"] === true) {
        let abbrev = "";
        const prefix = self["prefix"] as string | undefined;
        if (prefix !== undefined && prefix !== "") abbrev = prefix;
        if (idd.number !== undefined) {
          abbrev += abbrev === "" ? "" : " ";
          abbrev += idd.number;
        }
        if (idd.part !== undefined) abbrev += `-${idd.part}`;
        parts.push(abbrev);
      } else {
        let abbrev = idd.number ?? "";
        if (idd.part !== undefined) abbrev += `-${idd.part}`;
        parts.push(abbrev);
      }
      if (i < id.identifiers.length - 1) {
        parts.push(id.separators?.[i] ?? " and ");
      }
    });
    let result = parts.join("");
    if (id.common_year?.present() && !result.endsWith(`:${id.common_year.render()}`)) {
      result += `:${id.common_year.render()}`;
    }
    return result;
  },
);

interface SetLike extends BsiIdentifier {
  identifiers: BsiIdentifier[];
}

export const SetClass = bsiClassWith(
  { kind: "set", rootKind: "first" },
  {
    identifiers: { type: BsiIdentifier as unknown as IdentifierStatic, collection: true },
    separators: { type: "string", collection: true },
  },
  (id: SetLike) => (id.identifiers ?? []).map((i) => i.toHuman()).join(" + "),
);

interface ExpertCommentaryLike extends BsiIdentifier {
  base: BsiIdentifier | undefined;
  format: string | undefined;
  topic: string | undefined;
}

export const ExpertCommentaryClass = bsiClassWith(
  { kind: "expert-commentary", rootKind: "base" },
  {
    base: { type: BsiIdentifier as unknown as IdentifierStatic },
    format: { type: "string" },
    topic: { type: "string" },
  },
  (id: ExpertCommentaryLike) => {
    let baseStr = id.base?.toHuman() ?? "";
    baseStr = baseStr.replace(/ (Expert Commentary|ExComm(\s*\(.*\))?)$/, "");
    if (id.format === "full") return `${baseStr} Expert Commentary`;
    if (id.format === "abbr_with_topic") return `${baseStr} ExComm (${id.topic})`;
    return `${baseStr} ExComm`;
  },
);

interface VapLike extends BsiIdentifier {
  base: BsiIdentifier | undefined;
  format: string | undefined;
}

export const ValueAddedPublicationClass = (() => {
  const klass = bsiClassWith(
    { kind: "value-added-publication", rootKind: "base" },
    {
      base: { type: BsiIdentifier as unknown as IdentifierStatic },
      format: { type: "string" },
    },
    (id: VapLike) => {
      const baseStr = id.base?.toHuman() ?? "";
      if (id.format === "TC") return `${baseStr} - TC`;
      if (id.format === "PDF") return `${baseStr} PDF`;
      if (id.format === "BOOK") return `${baseStr} BOOK`;
      return baseStr;
    },
  );
  // #number/#year/#date delegate to base (value_added_publication.rb),
  // so the wrapper's wire carries them.
  (klass as unknown as { compactHash: unknown }).compactHash = (model: BaseIdentifier, hash: Record<string, unknown>) => {
    const base = (model as unknown as { base?: BsiIdentifier }).base;
    if (base === undefined) return;
    if (base.number !== undefined) hash["number"] = base.number;
    if (base.date?.present()) hash["year"] = base.date.render();
  };
  return klass;
})();

interface NaLike extends BsiIdentifier {
  base: BsiIdentifier | undefined;
  na_supplements: BsiIdentifier[];
}

export const NationalAnnexClass = bsiClassWith(
  { kind: "national-annex", typeCode: "na", rootKind: "base" },
  {
    na_supplements: { type: BsiIdentifier as unknown as IdentifierStatic, collection: true },
    base: { type: BsiIdentifier as unknown as IdentifierStatic },
  },
  (id: NaLike) => {
    let result = "NA";
    for (const supp of id.na_supplements ?? []) {
      const self = supp as unknown as Record<string, unknown>;
      if (supp instanceof Amendment) {
        result += `+A${self["number"]}:${self["year"]}`;
      } else if (supp instanceof Corrigendum) {
        result += `+C${self["number"]}:${self["year"]}`;
      }
    }
    result += " to ";
    result += id.base !== undefined ? id.base.toHuman() : renderSingleIdentifier(id);
    return result;
  },
);

interface AdoptedLike extends BsiIdentifier {
  base: BsiIdentifier | undefined;
  edition: string | undefined;
  translation_lang: string | undefined;
  translation_upper: string | undefined;
  translation_suffix_type: string | undefined;
  reaffirmation_year: string | undefined;
  expert_commentary: boolean | undefined;
  expert_commentary_topic: string | undefined;
}

function renderAdopted(id: AdoptedLike): string {
  const prefix = id.publisher !== undefined ? id.publisher.render() : "BS";
  let result = prefix;
  if (id.base !== undefined) result += ` ${id.base.toHuman()}`;
  if (id.edition !== undefined) result += ` ED${id.edition}`;
  if (id.reaffirmation_year !== undefined) result += ` (R${id.reaffirmation_year})`;
  if (id.translation_lang !== undefined) {
    result += id.translation_suffix_type === "version"
      ? ` (${id.translation_lang} version)`
      : id.translation_suffix_type === "Translation"
        ? ` (${id.translation_lang} Translation)`
        : ` (${id.translation_lang})`;
  } else if (id.translation_upper !== undefined) {
    result += id.translation_suffix_type === "Translation"
      ? ` (${id.translation_upper} Translation)`
      : ` (${id.translation_upper})`;
  }
  if (id.expert_commentary !== undefined && id.expert_commentary) {
    result += id.expert_commentary_topic !== undefined
      ? ` ExComm (${id.expert_commentary_topic})`
      : " ExComm";
  }
  return result;
}

const adoptedAttrs: AttributeTable = {
  base: { type: BsiIdentifier as unknown as IdentifierStatic },
  edition: { type: "string" },
  translation_lang: { type: "string" },
  translation_upper: { type: "string" },
  translation_suffix_type: { type: "string" },
  reaffirmation_year: { type: "string" },
  expert_commentary: { type: "boolean" },
  expert_commentary_topic: { type: "string" },
};

export const AdoptedEuropeanNormClass = bsiClassWith(
  { kind: "adopted-european-norm", rootKind: "base" }, adoptedAttrs, renderAdopted);
export const AdoptedInternationalStandardClass = bsiClassWith(
  { kind: "adopted-international-standard", rootKind: "base" }, adoptedAttrs, renderAdopted);

interface ConsolidatedLike extends BsiIdentifier {
  identifiers: BsiIdentifier[];
}

export const ConsolidatedIdentifierClass = bsiClassWith(
  { kind: "consolidated-identifier", rootKind: "first" },
  {
    identifiers: { type: BsiIdentifier as unknown as IdentifierStatic, collection: true },
  },
  (id: ConsolidatedLike) => {
    const [baseId, ...supplements] = id.identifiers ?? [];
    if (baseId === undefined) return "";
    let result = baseId.toHuman()
      .replace(/ ExComm \(.*?\)$/, "")
      .replace(/ ExComm$/, "")
      .replace(/ - TC$/, "")
      .replace(/ PDF$/, "")
      .replace(/ \([A-Z][a-z]+\)$/, "");
    for (const supp of supplements) {
      if (supp instanceof Amendment) {
        if (supp.amd_suffix_form) {
          result += supp.number !== undefined && /^[A-Z]+$/.test(supp.number)
            ? ` AMD ${supp.number}`
            : ` AMD${supp.number ?? ""}`;
        } else {
          result += `${supp.separator ?? "+"}A${supp.number ?? ""}`;
          if (supp.year !== undefined) result += `:${supp.year}`;
        }
      } else if (supp instanceof Corrigendum) {
        result += `${supp.separator ?? "+"}C`;
        if (supp.number !== undefined) result += supp.number;
        if (supp.year !== undefined) result += `:${supp.year}`;
      } else {
        result += supp.toHuman();
      }
    }
    const baseSelf = baseId as unknown as Record<string, unknown>;
    if (baseSelf["expert_commentary"] !== undefined) {
      result += baseSelf["expert_commentary_topic"] !== undefined
        ? ` ExComm (${baseSelf["expert_commentary_topic"]})`
        : " ExComm";
    }
    if (baseSelf["tracked_changes"] !== undefined) result += " - TC";
    const tl = baseSelf["translation_lang"] as string | undefined;
    if (tl !== undefined) {
      const tsType = baseSelf["translation_suffix_type"] as string | undefined;
      result += tsType === "version"
        ? ` (${tl} version)`
        : tsType === "Translation"
          ? ` (${tl} Translation)`
          : ` (${tl})`;
    } else {
      const tu = baseSelf["translation_upper"] as string | undefined;
      if (tu !== undefined) {
        const tsType = baseSelf["translation_suffix_type"] as string | undefined;
        result += tsType === "Translation" ? ` (${tu} Translation)` : ` (${tu})`;
      }
    }
    const ry = baseSelf["reaffirmation_year"] as string | undefined;
    if (ry !== undefined) result += ` (R${ry})`;
    return result;
  },
);

// ConsolidatedIdentifier#to_urn override (renderer.rb class method):
// base URN plus per-supplement segments.
export function consolidatedUrn(id: ConsolidatedLike): string | undefined {
  const [base, ...supplements] = id.identifiers ?? [];
  if (base === undefined) return undefined;
  let urn = base.toUrn();
  if (urn === undefined) return undefined;
  for (const supp of supplements) {
    if (supp instanceof Amendment) {
      urn += `:amd:${supp.number ?? ""}`;
      if (supp.year !== undefined) urn += `:${supp.year}`;
    } else if (supp instanceof Corrigendum) {
      urn += `:cor:${supp.number ?? ""}`;
      if (supp.year !== undefined) urn += `:${supp.year}`;
    }
  }
  return urn;
}

