import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type FieldMapping } from "../../model/attribute.js";
import { PubidDate } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/ashrae: the two single-document leaves (Standard,
 * Guideline), the five supplement types (Addendum, CombinedAddenda,
 * AddendaPackage, Errata, Interpretation), the renderer and the URN
 * generator.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

// The document number lives on the two leaves only (never on the
// shared base, mirroring the gem's deliberate leaf-only declaration);
// the renderer and URN reach it through this accessor or #root.
function numberOf(id: AshraeIdentifier | SingleLeaf): string | undefined {
  return (id as unknown as { number?: string }).number;
}

// Addendum/CombinedAddenda/AddendaPackage override #copublisher to
// delegate to base (Errata/Interpretation do not).
function copublisherOf(id: AshraeIdentifier): string | undefined {
  if (id instanceof Addendum || id instanceof CombinedAddenda || id instanceof AddendaPackage) {
    return id.base?.copublisher;
  }
  return id.copublisher;
}

/** mr_sanitize: lowercase, fold out-of-charset runs to "-", trim the
 * edges; an all-out-of-charset value collapses to undefined. */
function mrSanitize(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const sanitized = value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized === "" ? undefined : sanitized;
}

/** The supplement marker segment (mr_supplement_suffix): the same
 * marker the MR slug uses, appended to the base's URN. */
function mrSupplementMarker(id: unknown): string | undefined {
  const rec = id as Record<string, unknown>;
  const has = (k: string) => rec[k] !== undefined;
  if (has("addendum_code")) {
    const code = rec["addendum_code"] as string;
    const lower = code.toLowerCase();
    return lower === "" ? "add" : `add.${lower}`;
  }
  if (id instanceof CombinedAddenda) return ["adds", mrSanitize(rec["addendum_codes"] as string)].filter(Boolean).join(".");
  if (has("package_description")) return ["pkg", mrSanitize(rec["package_description"] as string)].filter(Boolean).join(".");
  if (id instanceof Interpretation) return "interp";
  if (id instanceof Errata) {
    const d = rec["date"] as { year?: string; month?: string; day?: string } | undefined;
    const slug = d === undefined ? undefined : [d.year, d.month, d.day].filter(Boolean).join("-");
    return ["errata", mrSanitize(slug)].filter(Boolean).join(".");
  }
  return undefined;
}

class AshraeUrnGenerator extends BaseUrnGenerator<AshraeIdentifier> {
  generate(): string {
    const id = this.identifier;
    // A supplement's URN is the URN of its base plus the one marker
    // segment naming the supplement (the same marker the MR slug uses).
    if (id instanceof SupplementIdentifier && id.base !== undefined) {
      const marker = mrSupplementMarker(id);
      return marker === undefined || marker === ""
        ? id.base.toUrn()
        : `${id.base.toUrn()}:${marker}`;
    }
    // A supplement carries no number of its own — the two leaves declare
    // one — so reach it through #root, which walks `base`.
    const number = numberOf(id) ?? numberOf(id.root());
    const parts = ["urn", "ashrae"];
    if (number !== undefined && number !== "") parts.push(number);
    if (id.year !== undefined) parts.push(id.year);
    if (id.type !== undefined) parts.push(id.type.toLowerCase());
    if (id.suffix !== undefined) parts.push(id.suffix.toLowerCase());
    if (id.amendment !== undefined) parts.push(`amd.${id.amendment}`);
    if (id.reaffirmed !== undefined) parts.push(`reaff.${id.reaffirmed}`);
    // The copublisher segment lowercases but keeps its slashes
    // ("copub.ansi/ashrae").
    const copublisher = copublisherOf(id);
    if (copublisher !== undefined) parts.push(`copub.${copublisher.toLowerCase()}`);
    if (id.publisher !== undefined) parts[1] = id.publisher.toLowerCase();
    const addendum = (id as unknown as { addendum?: string }).addendum;
    if (addendum !== undefined) parts.push(`add.${addendum}`);
    return parts.join(":");
  }
}

export abstract class AshraeIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: "string", default: "ASHRAE" },
    year: { type: "string" },
    type: { type: "string" },
    suffix: { type: "string" },
    amendment: { type: "string" },
    reaffirmed: { type: "string" },
    copublisher: { type: "string" },
  });
  static mappings: FieldMapping[] = keyValue(
    { wire: "publisher", to: "publisher" },
    { wire: "copublisher", to: "copublisher" },
    { wire: "type", to: "type" },
    { wire: "suffix", to: "suffix" },
    { wire: "amendment", to: "amendment" },
    { wire: "reaffirmed", to: "reaffirmed" },
    { wire: "year", to: "year" },
  );

  declare readonly publisher: string | undefined;
  declare readonly copublisher: string | undefined;
  declare readonly type: string | undefined;
  declare readonly suffix: string | undefined;
  declare readonly amendment: string | undefined;
  declare readonly reaffirmed: string | undefined;
  declare readonly year: string | undefined;

  // The supplement types reach the document through #root (base walk).
  root(): AshraeIdentifier {
    return this;
  }
}

interface SingleLeaf extends AshraeIdentifier {
  number: string | undefined;
}

function renderSingle(id: SingleLeaf): string {
  let result = [id.publisher ?? "", id.type ?? ""].filter((s) => s !== "").join(" ");
  if (result.length > 0) result += " ";
  result += id.number !== undefined ? id.number : "";
  if (id.year !== undefined) result += `-${id.year}`;
  if (id.amendment !== undefined) result += ` (${id.amendment})`;
  if (id.suffix !== undefined) result += id.suffix;
  if (id.reaffirmed !== undefined) result += ` (RA${id.reaffirmed})`;
  return result;
}

export class Standard extends AshraeIdentifier {
  static polymorphicName = "pubid:ashrae:standard";
  static urnGenerator = AshraeUrnGenerator;
  static attributes = extendAttributes(AshraeIdentifier, {
    number: { type: "string" },
    type: { type: "string", default: "Standard" },
  });
  static mappings: FieldMapping[] = [
    ...AshraeIdentifier.mappings,
    { wire: "number", to: "number" },
  ];

  declare readonly number: string | undefined;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    const self = this as unknown as Record<string, unknown>;
    if (self["publisher"] === undefined) self["publisher"] = "ASHRAE";
    if (self["type"] === undefined) self["type"] = "Standard";
  }

  render(): string {
    return renderSingle(this);
  }
}

export class Guideline extends AshraeIdentifier {
  static polymorphicName = "pubid:ashrae:guideline";
  static urnGenerator = AshraeUrnGenerator;
  static attributes = extendAttributes(AshraeIdentifier, {
    number: { type: "string" },
    type: { type: "string", default: "Guideline" },
  });
  static mappings: FieldMapping[] = [
    ...AshraeIdentifier.mappings,
    { wire: "number", to: "number" },
  ];

  declare readonly number: string | undefined;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    const self = this as unknown as Record<string, unknown>;
    if (self["publisher"] === undefined) self["publisher"] = "ASHRAE";
    if (self["type"] === undefined) self["type"] = "Guideline";
  }

  render(): string {
    return renderSingle(this);
  }
}

export abstract class SupplementIdentifier extends AshraeIdentifier {
  static attributes = extendAttributes(AshraeIdentifier, {
    base: { type: AshraeIdentifier as unknown as IdentifierStatic },
  });
  static mappings: FieldMapping[] = [
    ...AshraeIdentifier.mappings,
    { wire: "base", to: "base" },
  ];

  declare readonly base: AshraeIdentifier | undefined;

  root(): AshraeIdentifier {
    return this.base?.root() ?? this;
  }
}

// The delegated base copublisher rides the wrapper's wire through the
// compactHash hook (Ruby serializes through the overridden getter).
function delegatedCopublisher(model: BaseIdentifier, hash: Record<string, unknown>): void {
  const base = (model as unknown as { base?: AshraeIdentifier }).base;
  if (base?.copublisher !== undefined) hash["copublisher"] = base.copublisher;
}

export class Addendum extends SupplementIdentifier {
  static polymorphicName = "pubid:ashrae:addendum";
  static urnGenerator = AshraeUrnGenerator;
  static attributes = extendAttributes(SupplementIdentifier, {
    addendum_code: { type: "string" },
    addendum_date: { type: "string" },
  });
  static mappings: FieldMapping[] = [
    ...SupplementIdentifier.mappings,
    { wire: "addendum_code", to: "addendum_code" },
    { wire: "addendum_date", to: "addendum_date" },
  ];
  static compactHash = delegatedCopublisher;

  declare readonly addendum_code: string | undefined;
  declare readonly addendum_date: string | undefined;

  render(): string {
    if (this.base === undefined) return "";
    const copublisher = this.base.copublisher;
    let result: string;
    if (copublisher !== undefined) {
      result = `${copublisher} Addendum ${this.addendum_code ?? ""} to ${this.base.toHuman()}`;
    } else {
      const baseType = this.base.type ?? "Standard";
      result = `ASHRAE Addendum ${this.addendum_code ?? ""} to ${baseType} ${numberOf(this.base) ?? ""}`;
      if (this.base.year !== undefined) result += `-${this.base.year}`;
    }
    if (this.addendum_date !== undefined) result += ` (${this.addendum_date})`;
    return result;
  }
}

export class CombinedAddenda extends SupplementIdentifier {
  static polymorphicName = "pubid:ashrae:combined-addenda";
  static urnGenerator = AshraeUrnGenerator;
  static attributes = extendAttributes(SupplementIdentifier, {
    addendum_codes: { type: "string" },
    connector: { type: "string" },
  });
  static mappings: FieldMapping[] = [
    ...SupplementIdentifier.mappings,
    { wire: "addendum_codes", to: "addendum_codes" },
    { wire: "connector", to: "connector" },
  ];
  static compactHash = delegatedCopublisher;

  declare readonly addendum_codes: string | undefined;
  declare readonly connector: string | undefined;

  render(): string {
    if (this.base === undefined) return "";
    const baseType = this.base.type ?? "Standard";
    let result: string;
    if (this.addendum_codes !== undefined) {
      result = `ASHRAE Addenda ${this.addendum_codes} to ${baseType} ${numberOf(this.base) ?? ""}`;
    } else {
      result = `ASHRAE Addenda to ${baseType} ${numberOf(this.base) ?? ""}`;
    }
    if (this.base.year !== undefined) result += `-${this.base.year}`;
    return result;
  }
}

export class AddendaPackage extends SupplementIdentifier {
  static polymorphicName = "pubid:ashrae:addenda-package";
  static urnGenerator = AshraeUrnGenerator;
  static attributes = extendAttributes(SupplementIdentifier, {
    package_description: { type: "string" },
  });
  static mappings: FieldMapping[] = [
    ...SupplementIdentifier.mappings,
    { wire: "package_description", to: "package_description" },
  ];
  static compactHash = delegatedCopublisher;

  declare readonly package_description: string | undefined;

  render(): string {
    if (this.base === undefined) return "";
    let result = `ASHRAE ${this.base.type ?? "Standard"} ${numberOf(this.base) ?? ""}`;
    if (this.base.year !== undefined) result += `-${this.base.year}`;
    if (this.package_description !== undefined) result += `: Addenda ${this.package_description}`;
    return result;
  }
}

export class Errata extends SupplementIdentifier {
  static polymorphicName = "pubid:ashrae:errata";
  static urnGenerator = AshraeUrnGenerator;
  static attributes = extendAttributes(SupplementIdentifier, {
    date: { type: PubidDate },
  });
  static mappings: FieldMapping[] = [
    ...SupplementIdentifier.mappings,
    { wire: "date", to: "date" },
  ];

  declare readonly date: PubidDate | undefined;

  render(): string {
    if (this.base === undefined) return "";
    let result = `${this.base.toHuman()} Errata`;
    const date = longDate(this.date);
    if (date !== undefined) result += ` (${date})`;
    return result;
  }
}

export class Interpretation extends SupplementIdentifier {
  static polymorphicName = "pubid:ashrae:interpretation";
  static urnGenerator = AshraeUrnGenerator;

  render(): string {
    if (this.base === undefined) return "";
    const baseType = this.base.type ?? "Standard";
    let result = `Interpretations for ${baseType} ${numberOf(this.base) ?? ""}`;
    if (this.base.year !== undefined) result += `-${this.base.year}`;
    return result;
  }
}

function longDate(date: PubidDate | undefined): string | undefined {
  if (date === undefined) return undefined;
  if (date.month === undefined) return date.year?.toString();
  const month = MONTH_NAMES[Number(date.month) - 1];
  if (month === undefined) return date.render();
  if (date.day === undefined) return `${month} ${date.year ?? ""}`.trim();
  const day = `${month} ${Number(date.day)}`;
  return date.year !== undefined ? `${day}, ${date.year}` : day;
}

for (const klass of [
  Standard,
  Guideline,
  Addendum,
  CombinedAddenda,
  AddendaPackage,
  Errata,
  Interpretation,
] as unknown as IdentifierStatic[]) {
  registerType(klass);
}
