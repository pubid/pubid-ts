import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { CenIdentifier } from "../cen_cenelec/model.js";

/**
 * Port of lib/pubid/evs: the national identifier ("EVS" / "prEVS" over a
 * CEN adoption, an ISO/IEC adoption, or a plain Estonian standard), the
 * shared supplements (the national annex, the COR/AC corrigendum, the AMD
 * amendment spelling, the trailing language code) and the URN faces
 * (urn:evs:en:…, urn:evs:iso:…, urn:evs:921:2019, urn:evs:ts:1:2019).
 */

const CEN_NAMESPACE = "urn:cen:";
const EVS_NAMESPACE = "urn:evs:";

class EvsUrnGenerator extends BaseUrnGenerator<EvsIdentifier> {
  generate(): string {
    const id = this.identifier;
    const segments: string[] = [];
    if (id.draft_prefix === true) segments.push("pr");

    if (id.base) {
      const adoptedUrn = id.base.toUrn();
      if (!adoptedUrn.startsWith(CEN_NAMESPACE)) {
        throw new Error(`expected adopted CEN URN, got ${JSON.stringify(adoptedUrn)}`);
      }
      segments.push(...adoptedUrn.slice(CEN_NAMESPACE.length).split(":"));
    } else if (id instanceof InternationalAdoption) {
      segments.push((id.intl_org ?? "").toLowerCase());
      segments.push(id.part !== undefined ? `${id.number}-${id.part}` : (id.number ?? ""));
      if (id.year !== undefined) segments.push(id.year);
    } else {
      const est = id as EstonianStandard; // instanceof narrowing via the else branch
      if (est.evs_type !== undefined) segments.push(est.evs_type.toLowerCase());
      segments.push(est.number ?? "");
      if (est.year !== undefined) segments.push(est.year);
    }

    if (id.na_separator !== undefined) {
      segments.push("na");
      if (id.na_year !== undefined) segments.push(id.na_year);
    }
    if (id.amd_separator !== undefined) {
      if (id.amd_separator === "+") segments.push("plus");
      segments.push("amd");
      if (id.amd_number !== undefined) segments.push(id.amd_number);
      if (id.amd_year !== undefined) segments.push(id.amd_year);
    }
    if (id.cor_separator !== undefined) {
      if (id.cor_separator === "+") segments.push("plus");
      segments.push("cor");
      if (id.cor_number !== undefined) segments.push(id.cor_number);
      if (id.cor_year !== undefined) segments.push(id.cor_year);
    }
    if (id.language !== undefined) segments.push(id.language);

    return EVS_NAMESPACE + segments.join(":");
  }
}

export abstract class EvsIdentifier extends BaseIdentifier {
  declare readonly base: CenIdentifier | undefined;
  // "-" or " " — preserves the printed separator ("EVS-EN" vs "EVS EN").
  declare readonly separator: string | undefined;
  declare readonly draft_prefix: boolean | undefined;
  declare readonly language: string | undefined;
  // The national annex: separator ("+"/"/") and optional year.
  declare readonly na_separator: string | undefined;
  declare readonly na_year: string | undefined;
  // The AMD amendment spelling.
  declare readonly amd_separator: string | undefined;
  declare readonly amd_kind: string | undefined;
  declare readonly amd_number: string | undefined;
  declare readonly amd_year: string | undefined;
  // The COR corrigendum spelling.
  declare readonly cor_separator: string | undefined;
  declare readonly cor_kind: string | undefined;
  declare readonly cor_number: string | undefined;
  declare readonly cor_year: string | undefined;

  /** "EVS" + separator + the shape's body + the supplements + the language. */
  render(): string {
    let result = (this.draft_prefix === true ? "pr" : "") + "EVS" + (this.separator ?? "-");
    result += this.body();
    if (this.amd_separator !== undefined) {
      result += `${this.amd_separator}AMD${this.amd_number ?? ""}`;
      if (this.amd_year !== undefined) result += `:${this.amd_year}`;
    }
    if (this.cor_separator !== undefined) {
      result += `${this.cor_separator}${this.cor_kind ?? "COR"}${this.cor_number ?? ""}`;
      if (this.cor_year !== undefined) result += `:${this.cor_year}`;
    }
    if (this.na_separator !== undefined) {
      result += `${this.na_separator}NA`;
      if (this.na_year !== undefined) result += `:${this.na_year}`;
    }
    if (this.language !== undefined) result += ` ${this.language}`;
    return result;
  }

  protected abstract body(): string;
}

const SHARED_ATTRIBUTES = {
  draft_prefix: { type: "boolean" as const, default: false },
  language: { type: "string" as const },
  na_separator: { type: "string" as const },
  na_year: { type: "string" as const },
  amd_separator: { type: "string" as const },
  amd_kind: { type: "string" as const },
  amd_number: { type: "string" as const },
  amd_year: { type: "string" as const },
  cor_separator: { type: "string" as const },
  cor_kind: { type: "string" as const },
  cor_number: { type: "string" as const },
  cor_year: { type: "string" as const },
};

const SHARED_MAPPINGS: FieldMapping[] = [
  { wire: "draft_prefix", to: "draft_prefix" },
  { wire: "language", to: "language" },
  { wire: "na_separator", to: "na_separator" },
  { wire: "na_year", to: "na_year" },
  { wire: "amd_separator", to: "amd_separator" },
  { wire: "amd_kind", to: "amd_kind" },
  { wire: "amd_number", to: "amd_number" },
  { wire: "amd_year", to: "amd_year" },
  { wire: "cor_separator", to: "cor_separator" },
  { wire: "cor_kind", to: "cor_kind" },
  { wire: "cor_number", to: "cor_number" },
  { wire: "cor_year", to: "cor_year" },
];

export class NationalAdoption extends EvsIdentifier {
  static polymorphicName = "pubid:evs:national-adoption";
  static urnGenerator = EvsUrnGenerator;
  static attributes = extendAttributes(EvsIdentifier, {
    base: { type: CenIdentifier as unknown as IdentifierStatic },
    separator: { type: "string", default: "-" },
    ...SHARED_ATTRIBUTES,
  });
  static mappings: FieldMapping[] = keyValue(
    { wire: "base", to: "base" },
    { wire: "separator", to: "separator" },
    ...SHARED_MAPPINGS,
  );

  protected body(): string {
    return this.base?.toHuman() ?? "";
  }
}

export class InternationalAdoption extends EvsIdentifier {
  declare readonly intl_org: string | undefined;
  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly year: string | undefined;
  static polymorphicName = "pubid:evs:international-adoption";
  static urnGenerator = EvsUrnGenerator;
  static attributes = extendAttributes(EvsIdentifier, {
    number: { type: "string" },
    part: { type: "string" },
    intl_org: { type: "string" },
    year: { type: "string" },
    language: { type: "string" as const },
    draft_prefix: { type: "boolean" as const, default: false },
    na_separator: { type: "string" as const },
    na_year: { type: "string" as const },
    amd_separator: { type: "string" as const },
    amd_kind: { type: "string" as const },
    amd_number: { type: "string" as const },
    amd_year: { type: "string" as const },
    cor_separator: { type: "string" as const },
    cor_kind: { type: "string" as const },
    cor_number: { type: "string" as const },
    cor_year: { type: "string" as const },
  });
  static mappings: FieldMapping[] = keyValue(
    { wire: "number", to: "number" },
    { wire: "part", to: "part" },
    { wire: "intl_org", to: "intl_org" },
    { wire: "year", to: "year" },
    { wire: "draft_prefix", to: "draft_prefix" },
    { wire: "language", to: "language" },
    { wire: "na_separator", to: "na_separator" },
    { wire: "na_year", to: "na_year" },
    { wire: "amd_separator", to: "amd_separator" },
    { wire: "amd_kind", to: "amd_kind" },
    { wire: "amd_number", to: "amd_number" },
    { wire: "amd_year", to: "amd_year" },
    { wire: "cor_separator", to: "cor_separator" },
    { wire: "cor_kind", to: "cor_kind" },
    { wire: "cor_number", to: "cor_number" },
    { wire: "cor_year", to: "cor_year" },
  );

  protected body(): string {
    let org = `${this.intl_org} ${this.number}`;
    if (this.part !== undefined) org += `-${this.part}`;
    if (this.year !== undefined) org += `:${this.year}`;
    return org;
  }
}

export class EstonianStandard extends EvsIdentifier {
  declare readonly number: string | undefined;
  declare readonly year: string | undefined;
  declare readonly evs_type: string | undefined;
  static polymorphicName = "pubid:evs:estonian-standard";
  static urnGenerator = EvsUrnGenerator;
  static attributes = extendAttributes(EvsIdentifier, {
    number: { type: "string" },
    separator: { type: "string", default: "-" },
    language: { type: "string" as const },
    year: { type: "string" },
    evs_type: { type: "string" as const },
    draft_prefix: { type: "boolean" as const, default: false },
    na_separator: { type: "string" as const },
    na_year: { type: "string" as const },
    amd_separator: { type: "string" as const },
    amd_kind: { type: "string" as const },
    amd_number: { type: "string" as const },
    amd_year: { type: "string" as const },
    cor_separator: { type: "string" as const },
    cor_kind: { type: "string" as const },
    cor_number: { type: "string" as const },
    cor_year: { type: "string" as const },
  });
  static mappings: FieldMapping[] = keyValue(
    { wire: "number", to: "number" },
    { wire: "separator", to: "separator" },
    { wire: "language", to: "language" },
    { wire: "year", to: "year" },
    { wire: "evs_type", to: "evs_type" },
  );

  protected body(): string {
    let plain = this.evs_type !== undefined ? `${this.evs_type} ` : "";
    plain += this.number ?? "";
    if (this.year !== undefined) plain += `:${this.year}`;
    return plain;
  }
}

registerType(NationalAdoption as unknown as IdentifierStatic);
registerType(InternationalAdoption as unknown as IdentifierStatic);
registerType(EstonianStandard as unknown as IdentifierStatic);
