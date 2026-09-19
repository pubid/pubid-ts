import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type AttributeTable, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/csa: SingleIdentifier (with the flat key_value
 * wire), the single-document types (Standard, Series, Cec), the
 * wrappers (CanadianAdopted, CsaAdopted), and the containers
 * (Package, Bundled, Combined), plus the renderer and URN generator.
 */

const SINGLE_ATTRS: AttributeTable = {
  number: { type: "string" },
  no_number: { type: "string" },
  year: { type: "string" },
  year_format: { type: "string" },
  year_prefix: { type: "string" },
  original_year_4digit: { type: "boolean", default: false },
  french: { type: "boolean" },
  reaffirmation: { type: "string" },
  original_reaffirmation_4digit: { type: "boolean", default: false },
  has_publisher: { type: "boolean" },
  series_prefix: { type: "string" },
  series: { type: "boolean" },
  package: { type: "string" },
  publisher_prefix: { type: "string" },
  code_only: { type: "boolean", default: false },
};

const SINGLE_MAPPINGS: FieldMapping[] = keyValue(
  { wire: "number", to: "number" },
  { wire: "no_number", to: "no_number" },
  { wire: "year", to: "year" },
  { wire: "year_format", to: "year_format" },
  { wire: "year_prefix", to: "year_prefix" },
  { wire: "original_year_4digit", to: "original_year_4digit" },
  { wire: "french", to: "french" },
  { wire: "reaffirmation", to: "reaffirmation" },
  { wire: "original_reaffirmation_4digit", to: "original_reaffirmation_4digit" },
  { wire: "has_publisher", to: "has_publisher" },
  { wire: "series_prefix", to: "series_prefix" },
  { wire: "series", to: "series" },
  { wire: "package", to: "package" },
  { wire: "publisher_prefix", to: "publisher_prefix" },
  { wire: "code_only", to: "code_only" },
);

export abstract class CsaIdentifier extends BaseIdentifier {
  root(): CsaIdentifier {
    return this;
  }
}

export abstract class CsaSingleIdentifier extends CsaIdentifier {
  static attributes = extendAttributes(BaseIdentifier, SINGLE_ATTRS);
  static mappings = SINGLE_MAPPINGS;

  declare readonly number: string | undefined;
  declare readonly no_number: string | undefined;
  declare readonly year: string | undefined;
  declare readonly year_format: string | undefined;
  declare readonly year_prefix: string | undefined;
  declare readonly original_year_4digit: boolean | undefined;
  declare readonly french: boolean | undefined;
  declare readonly reaffirmation: string | undefined;
  declare readonly original_reaffirmation_4digit: boolean | undefined;
  declare readonly has_publisher: boolean | undefined;
  declare readonly series_prefix: string | undefined;
  declare readonly series: boolean | undefined;
  declare readonly package: string | undefined;
  declare readonly publisher_prefix: string | undefined;
  declare readonly code_only: boolean | undefined;

}

// --- Renderer helpers ----------------------------------------------------------------

function publisherPrefixFor(id: CsaSingleIdentifier): string {
  if (id.code_only === true) return "";
  return id.publisher_prefix ?? "CSA";
}

function displayYear(id: CsaSingleIdentifier): string {
  const yearStr = id.year ?? "";
  if (id.original_year_4digit === true) return yearStr;
  if (id.year_prefix !== undefined && /^[MF]$/.test(id.year_prefix)
    && yearStr.length === 4 && yearStr.startsWith("19")) {
    return yearStr.slice(2);
  }
  if (yearStr.length === 4 && yearStr.startsWith("20")) return yearStr.slice(2);
  if (yearStr.length === 4 && yearStr.startsWith("19")) {
    return yearStr.slice(2);
  }
  return yearStr;
}

function yearPortion(id: CsaSingleIdentifier): string {
  const separator = id.year_format === "dash" ? "-" : ":";
  let part = separator;
  if (id.year_prefix !== undefined) part += id.year_prefix;
  else if (id.french === true && id.year_format !== "dash") part += "F";
  return part + displayYear(id);
}

function renderReaffirmation(id: CsaSingleIdentifier): string {
  const yearWas2digit = id.original_year_4digit !== true;
  const reaffirmationWas4digit = id.original_reaffirmation_4digit === true;
  const value = id.reaffirmation ?? "";
  const reaffirmationStr = reaffirmationWas4digit
    ? value
    : value.length === 4 && (value.startsWith("19") || value.startsWith("20"))
      ? value.slice(2)
      : value;
  return yearWas2digit && reaffirmationWas4digit
    ? ` (R${reaffirmationStr})`
    : `(R${reaffirmationStr})`;
}

function renderBase(id: CsaSingleIdentifier): string {
  const prefix = publisherPrefixFor(id);
  const parts: string[] = [];
  if (prefix !== "") parts.push(prefix);

  let codePart = id.number ?? "";
  if (id.no_number !== undefined) codePart += ` NO. ${id.no_number}`;
  if (id.series_prefix !== undefined) codePart += ` ${id.series_prefix} SERIES`;
  else if (id.series === true) codePart += " SERIES";
  if (codePart !== "") parts.push(codePart);

  if (id.year !== undefined && parts.length > 0) {
    parts[parts.length - 1] += yearPortion(id);
  }

  let result: string;
  if (prefix !== "" && prefix.endsWith("-")) {
    // No space after a dash-ending prefix (CAN/CSA-, CAN3-, CSA-).
    result = parts.join("");
  } else {
    result = parts.join(" ");
  }
  if (id.reaffirmation !== undefined && id.reaffirmation !== "") {
    result += renderReaffirmation(id);
  }
  if (id.package !== undefined) result += id.package;
  return result;
}

class CsaUrnGenerator extends BaseUrnGenerator<CsaSingleIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "csa"];
    const prefix = id.code_only === true
      ? ""
      : id.publisher_prefix !== undefined
        ? id.publisher_prefix.toLowerCase()
        : "csa";
    parts.push(prefix);

    if (id.number !== undefined) parts.push(id.number);
    if (id.no_number !== undefined) parts.push(`no.${id.no_number}`);
    if (id.series === true) parts.push(`series.${id.series}`);
    if (id.series_prefix !== undefined) parts.push(`series.${id.series_prefix}`);

    if (id.year !== undefined) {
      let year = id.year;
      if (year.length === 4 && year.startsWith("20")) year = year.slice(2);
      if (id.year_prefix !== undefined) year = `${id.year_prefix}${year}`;
      parts.push(year);
    }
    if (id.reaffirmation !== undefined) parts.push(`reaff.${id.reaffirmation}`);
    if (id.package !== undefined) parts.push(`pkg.${id.package}`);
    if (id.year_format === "dash") parts.push("format.dash");
    if (id.french === true) parts.push("french");
    return parts.join(":");
  }
}

void CsaUrnGenerator;

// --- The single-document types ---------------------------------------------------------

function singleClass(kind: string, render: (id: CsaSingleIdentifier) => string): IdentifierStatic {
  class CsaConcrete extends CsaSingleIdentifier {
    static polymorphicName = `pubid:csa:${kind}`;
    static urnGenerator = CsaUrnGenerator;

    render(): string {
      return render(this);
    }
  }
  registerType(CsaConcrete as unknown as IdentifierStatic);
  return CsaConcrete as unknown as IdentifierStatic;
}

export const StandardClass = singleClass("standard", renderBase);

export const SeriesClass = (() => {
  class Series extends CsaSingleIdentifier {
    static polymorphicName = "pubid:csa:series";
    static urnGenerator = CsaUrnGenerator;

    render(): string {
      let result = publisherPrefixFor(this);
      result = result === "" ? "" : (result.endsWith("-") ? result : `${result} `);
      result += this.number ?? "";
      result += " ";
      if (this.series_prefix !== undefined && this.series_prefix !== "") {
        result += `${this.series_prefix} `;
      }
      result += "SERIES";
      if (this.year !== undefined) {
        const separator = this.year_format === "dash" ? "-" : ":";
        let part = separator;
        if (this.year_prefix !== undefined) part += this.year_prefix;
        else if (this.french === true && this.year_format !== "dash") part += "F";
        const yearStr = this.year;
        part += yearStr.length === 4 && yearStr.startsWith("20") ? yearStr.slice(2) : yearStr;
        result += part;
      }
      if (this.reaffirmation !== undefined && this.reaffirmation !== "") {
        result += renderReaffirmation(this);
      }
      return result;
    }
  }
  registerType(Series as unknown as IdentifierStatic);
  return Series as unknown as IdentifierStatic;
})();

export const CecClass = (() => {
  class Cec extends CsaSingleIdentifier {
    static polymorphicName = "pubid:csa:cec";
    static urnGenerator = CsaUrnGenerator;
    static attributes = extendAttributes(CsaSingleIdentifier, {
      cec_part: { type: "string" },
    });
    static mappings: FieldMapping[] = [
      ...SINGLE_MAPPINGS,
      { wire: "cec_part", to: "cec_part" },
    ];

    declare readonly cec_part: string | undefined;

    constructor(attrs: Record<string, unknown> = {}) {
      super(attrs);
      // Cec#number derives from its parts (the Ruby method override).
      if (this.cec_part !== undefined && this.no_number !== undefined) {
        (this as unknown as Record<string, unknown>)["number"] = `${this.cec_part}-${this.no_number}`;
      }
    }

    render(): string {
      const prefix = publisherPrefixFor(this);
      const parts: string[] = [];
      if (prefix !== "") parts.push(prefix);
      if (this.cec_part !== undefined) parts.push(this.cec_part);
      parts.push("NO.");
      if (this.no_number !== undefined) parts.push(this.no_number);

      let result: string;
      if (prefix === "") {
        result = parts.join(" ");
      } else if (!prefix.endsWith("-")) {
        result = parts.join(" ");
      } else if (parts.length <= 2) {
        result = parts.join("");
      } else {
        result = parts[0]! + parts.slice(1).join(" ");
      }

      if (this.year !== undefined) {
        const separator = this.year_format === "dash" ? "-" : ":";
        let part = separator;
        const yearStr = this.year;
        const display = yearStr.length === 4 && (yearStr.startsWith("20") || yearStr.startsWith("19"))
          ? yearStr.slice(2)
          : yearStr;
        if (this.year_prefix !== undefined) part += `${this.year_prefix}${display}`;
        else if (this.french === true && this.year_format !== "dash") part += `F${display}`;
        else part += display;
        result += part;
      }
      if (this.reaffirmation !== undefined && this.reaffirmation !== "") {
        result += renderReaffirmation(this);
      }
      return result;
    }
  }
  registerType(Cec as unknown as IdentifierStatic);
  return Cec as unknown as IdentifierStatic;
})();

// --- The wrappers ---------------------------------------------------------------------

export const CanadianAdoptedClass = (() => {
  class CanadianAdopted extends CsaIdentifier {
    static polymorphicName = "pubid:csa:canadian-adopted";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: CsaIdentifier as unknown as IdentifierStatic },
      reaffirmation: { type: "string" },
      original_reaffirmation_4digit: { type: "boolean", default: false },
      year_format: { type: "string" },
    });
    static mappings: FieldMapping[] = keyValue(
      { wire: "base", to: "base" },
      { wire: "reaffirmation", to: "reaffirmation" },
      { wire: "original_reaffirmation_4digit", to: "original_reaffirmation_4digit" },
      { wire: "year_format", to: "year_format" },
    );

    declare readonly base: CsaIdentifier | undefined;
    declare readonly reaffirmation: string | undefined;
    declare readonly original_reaffirmation_4digit: boolean | undefined;

    root(): CsaIdentifier {
      return this.base?.root() ?? this;
    }

    render(): string {
      const base = this.base as CsaSingleIdentifier | undefined;
      const basePrefix = base?.publisher_prefix;
      let result: string;
      if (basePrefix === "CAN3-" || (basePrefix === "CAN/CSA-" && base instanceof (SeriesClass as unknown as Function))) {
        result = base!.toHuman();
      } else {
        result = `CAN/${base?.toHuman() ?? ""}`;
      }
      const baseReaffirm = (base as CsaSingleIdentifier | undefined)?.reaffirmation;
      if (this.reaffirmation !== undefined && baseReaffirm === undefined) {
        const yearWas2digit = (base as CsaSingleIdentifier | undefined)?.original_year_4digit !== true;
        const was4digit = this.original_reaffirmation_4digit === true;
        const value = this.reaffirmation;
        const reaffirmationStr = was4digit
          ? value
          : value.length === 4 && (value.startsWith("19") || value.startsWith("20"))
            ? value.slice(2)
            : value;
        result += yearWas2digit && was4digit ? ` (R${reaffirmationStr})` : `(R${reaffirmationStr})`;
      }
      return result;
    }
  }
  registerType(CanadianAdopted as unknown as IdentifierStatic);
  return CanadianAdopted as unknown as IdentifierStatic;
})();

export const CsaAdoptedClass = (() => {
  class CsaAdopted extends CsaIdentifier {
    static polymorphicName = "pubid:csa:csa-adopted";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: CsaIdentifier as unknown as IdentifierStatic },
      reaffirmation: { type: "string" },
      original_reaffirmation_4digit: { type: "boolean", default: false },
      year_format: { type: "string" },
      publisher_prefix: { type: "string" },
    });
    static mappings: FieldMapping[] = keyValue(
      { wire: "base", to: "base" },
      { wire: "reaffirmation", to: "reaffirmation" },
      { wire: "original_reaffirmation_4digit", to: "original_reaffirmation_4digit" },
      { wire: "year_format", to: "year_format" },
      { wire: "publisher_prefix", to: "publisher_prefix" },
    );

    declare readonly base: CsaIdentifier | undefined;
    declare readonly reaffirmation: string | undefined;
    declare readonly publisher_prefix: string | undefined;

    root(): CsaIdentifier {
      return this.base?.root() ?? this;
    }

    render(): string {
      let baseStr = this.base?.toHuman() ?? "";
      const yearMatch = baseStr.match(/:(\d{4})\b/);
      if (yearMatch !== null) {
        const year = yearMatch[1]!;
        if (year.startsWith("20") || year.startsWith("19")) {
          baseStr = baseStr.replace(`:${year}`, `:${year.slice(2)}`);
        }
      }
      baseStr = baseStr.replace(
        /\/Amd\s+(\d+)([:/-])(\d{2,4})\b/g,
        (_m, num: string, sep: string, year: string) => {
          const short = year.length === 4 && (year.startsWith("20") || year.startsWith("19"))
            ? year.slice(2)
            : year;
          return `/A${num}${sep}${short}`;
        },
      );
      let result: string;
      if (this.publisher_prefix !== undefined && this.publisher_prefix.endsWith("-")) {
        result = `${this.publisher_prefix}${baseStr}`;
      } else {
        result = `CSA ${baseStr}`;
      }
      if (this.reaffirmation !== undefined) result += ` (R${this.reaffirmation})`;
      return result;
    }
  }
  registerType(CsaAdopted as unknown as IdentifierStatic);
  return CsaAdopted as unknown as IdentifierStatic;
})();

// --- The containers --------------------------------------------------------------------

export const PackageClass = (() => {
  class Package extends CsaIdentifier {
    static polymorphicName = "pubid:csa:package";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: CsaIdentifier as unknown as IdentifierStatic },
      package_materials: { type: "string" },
      package_keyword: { type: "string" },
      materials_after_keyword: { type: "boolean", default: true },
    });
    static mappings: FieldMapping[] = keyValue(
      { wire: "base", to: "base" },
      { wire: "package_materials", to: "package_materials" },
      { wire: "package_keyword", to: "package_keyword" },
      { wire: "materials_after_keyword", to: "materials_after_keyword" },
    );

    declare readonly base: CsaIdentifier | undefined;
    declare readonly package_materials: string | undefined;
    declare readonly package_keyword: string | undefined;
    declare readonly materials_after_keyword: boolean | undefined;

    root(): CsaIdentifier {
      return this.base?.root() ?? this;
    }

    render(): string {
      let result = this.base?.toHuman() ?? "";
      if (this.package_materials !== undefined && this.package_materials !== "") {
        if (this.materials_after_keyword === true) {
          result += " PACKAGE";
          result += ` ${this.package_materials}`;
        } else if (/\sPACKAGE\s*$/i.test(this.package_materials)) {
          result += ` ${this.package_materials}`;
        } else {
          result += ` ${this.package_materials}`;
          result += ` ${this.package_keyword}`;
        }
      } else {
        result += " PACKAGE";
      }
      return result;
    }
  }
  registerType(Package as unknown as IdentifierStatic);
  return Package as unknown as IdentifierStatic;
})();

export const BundledClass = (() => {
  class Bundled extends CsaIdentifier {
    static polymorphicName = "pubid:csa:bundled";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: CsaIdentifier as unknown as IdentifierStatic },
      bundled_with: { type: CsaIdentifier as unknown as IdentifierStatic, collection: true },
      reaffirmation: { type: "string" },
      original_reaffirmation_4digit: { type: "boolean", default: false },
      year_format: { type: "string" },
    });
    static mappings: FieldMapping[] = keyValue(
      { wire: "base", to: "base" },
      { wire: "bundled_with", to: "bundled_with" },
      { wire: "reaffirmation", to: "reaffirmation" },
      { wire: "original_reaffirmation_4digit", to: "original_reaffirmation_4digit" },
      { wire: "year_format", to: "year_format" },
    );

    declare readonly base: CsaIdentifier | undefined;
    declare readonly bundled_with: CsaIdentifier[] | undefined;
    declare readonly reaffirmation: string | undefined;

    root(): CsaIdentifier {
      return this.base?.root() ?? this;
    }

    render(): string {
      const baseSingle = this.base as CsaSingleIdentifier | undefined;
      const parts: string[] = [];
      if (baseSingle !== undefined && baseSingle.constructor === CecClass) {
        // Bundled renders a Cec base through its normalized code, with
        // no "NO." (bundled.rb).
        const prefix = baseSingle.publisher_prefix ?? "CSA";
        const needsSpace = !prefix.endsWith("-");
        let yearDisplay: string | undefined;
        if (baseSingle.year !== undefined) {
          const yearStr = baseSingle.year;
          yearDisplay = yearStr.length === 4 && yearStr.startsWith("20") ? yearStr.slice(2) : yearStr;
        }
        parts.push(`${needsSpace ? `${prefix} ` : prefix}${baseSingle.number ?? ""}:${yearDisplay ?? ""}`);
      } else {
        parts.push(this.base?.toHuman() ?? "");
      }
      for (const bundled of this.bundled_with ?? []) {
        const single = bundled as CsaSingleIdentifier;
        parts.push(renderBundledPortion(single));
      }
      let result = parts.join(" + ");
      if (this.reaffirmation !== undefined) {
        const baseSingle = this.base as CsaSingleIdentifier | undefined;
        const yearWas2digit = baseSingle?.original_year_4digit !== true;
        const was4digit = this.reaffirmation.length === 4
          && (this.reaffirmation.startsWith("19") || this.reaffirmation.startsWith("20"));
        result += yearWas2digit && was4digit
          ? ` (R${this.reaffirmation})`
          : `(R${this.reaffirmation})`;
      }
      return result;
    }
  }
  registerType(Bundled as unknown as IdentifierStatic);
  return Bundled as unknown as IdentifierStatic;
})();

function renderBundledPortion(id: CsaSingleIdentifier): string {
  let part = id.number ?? "";
  if (id.year !== undefined) part += yearPortion(id);
  return part;
}

export const CombinedClass = (() => {
  class Combined extends CsaIdentifier {
    static polymorphicName = "pubid:csa:combined";
    static attributes = extendAttributes(BaseIdentifier, {
      identifiers: { type: CsaIdentifier as unknown as IdentifierStatic, collection: true },
      reaffirmation: { type: "string" },
      original_reaffirmation_4digit: { type: "boolean", default: false },
      package: { type: "string" },
      year_format: { type: "string" },
      separator: { type: "string", default: "/" },
    });
    static mappings: FieldMapping[] = keyValue(
      { wire: "identifiers", to: "identifiers" },
      { wire: "reaffirmation", to: "reaffirmation" },
      { wire: "original_reaffirmation_4digit", to: "original_reaffirmation_4digit" },
      { wire: "package", to: "package" },
      { wire: "year_format", to: "year_format" },
      { wire: "separator", to: "separator" },
    );

    declare readonly identifiers: CsaIdentifier[] | undefined;
    declare readonly reaffirmation: string | undefined;
    declare readonly package: string | undefined;
    declare readonly separator: string | undefined;

    root(): CsaIdentifier {
      return this.identifiers?.[0]?.root() ?? this;
    }

    render(): string {
      const ids = this.identifiers ?? [];
      const parts = (this.separator === ", ")
        ? ids.map((i) => i.toHuman())
        : ids.map((i, index) => (index === 0 ? i.toHuman() : renderContinuation(i as CsaSingleIdentifier)));
      let result = parts.join(this.separator ?? "/");
      if (this.reaffirmation !== undefined) {
        const primary = ids[0] as CsaSingleIdentifier | undefined;
        const yearWas2digit = primary?.original_year_4digit !== true;
        const was4digit = this.reaffirmation.length === 4
          && (this.reaffirmation.startsWith("19") || this.reaffirmation.startsWith("20"));
        result += yearWas2digit && was4digit
          ? ` (R${this.reaffirmation})`
          : `(R${this.reaffirmation})`;
      }
      if (this.package !== undefined) result += this.package;
      return result;
    }
  }
  registerType(Combined as unknown as IdentifierStatic);
  return Combined as unknown as IdentifierStatic;
})();

function renderContinuation(id: CsaSingleIdentifier): string {
  const parts: string[] = [];
  if (id.has_publisher === true) {
    parts.push(id.publisher_prefix ?? "CSA");
  }
  let codePart = id.number ?? "";
  if (id.no_number !== undefined) codePart += ` NO. ${id.no_number}`;
  if (id.series_prefix !== undefined) codePart += ` ${id.series_prefix} SERIES`;
  else if (id.series === true) codePart += " SERIES";
  if (id.year !== undefined) codePart += yearPortion(id);
  if (codePart !== "") parts.push(codePart);
  if (id.has_publisher === true && parts.length > 1) {
    const prefix = parts[0]!;
    return prefix.endsWith("-") ? prefix + parts.slice(1).join(" ") : parts.join(" ");
  }
  return parts.join(" ");
}

// --- The URN generator ------------------------------------------------------------------

