import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type AttributeTable, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/amca: the base class with the shared flat wire,
 * the three leaf types (Standard, Publication, Interpretation), the
 * renderer and the URN generator.
 */

interface TypeMeta {
  key: string;
  title: string;
  short: string | null;
}

// The URN's type segment is the Ruby Hash#to_s of the class type
// metadata, downcased — reproduced verbatim (quotes, braces, nil).
function urnTypeSegment(meta: TypeMeta): string {
  return `{key: :${meta.key}, title: "${meta.title.toLowerCase()}", short: ${meta.short === null ? "nil" : `"${meta.short.toLowerCase()}"`}}`;
}

const BASE_ATTRS: AttributeTable = {
  publisher: { type: "string", default: "AMCA" },
  copublisher: { type: "string" },
  year: { type: "string" },
  suffix: { type: "string" },
  reaffirmed: { type: "string" },
};

const BASE_MAPPINGS: FieldMapping[] = keyValue(
  { wire: "publisher", to: "publisher" },
  { wire: "copublisher", to: "copublisher" },
  { wire: "year", to: "year" },
  { wire: "suffix", to: "suffix" },
  { wire: "reaffirmed", to: "reaffirmed" },
);

export abstract class AmcaIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, BASE_ATTRS);
  static mappings = BASE_MAPPINGS;

  declare readonly publisher: string | undefined;
  declare readonly copublisher: string | undefined;
  declare readonly year: string | undefined;
  declare readonly suffix: string | undefined;
  declare readonly reaffirmed: string | undefined;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    const self = this as unknown as Record<string, unknown>;
    if (self["publisher"] === undefined) self["publisher"] = "AMCA";
  }

  abstract typeMeta(): TypeMeta;

  render(): string {
    return renderBase(this);
  }
}

function renderBase(id: AmcaIdentifier & { number?: string }): string {
  const parts: string[] = [];
  if (id.copublisher !== undefined) parts.push(id.copublisher);
  parts.push(id.typeMeta().title);
  parts.push(id.number ?? "");
  if (id.year !== undefined) parts.push(`-${id.year}`);

  let result = parts.filter((p) => p !== "").join(" ");

  if (id.copublisher?.includes("/") === true && id.year !== undefined) {
    result = `${id.copublisher} ${id.typeMeta().title} ${id.number}-${id.year}`;
  }

  if (id.reaffirmed !== undefined) result += ` (${id.reaffirmed})`;
  return result;
}

class AmcaUrnGenerator extends BaseUrnGenerator<AmcaIdentifier & { number?: string }> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "amca"];
    if (id.number !== undefined) parts.push(id.number);
    if (id.year !== undefined) parts.push(id.year);
    if (id.suffix !== undefined) parts.push(id.suffix.toLowerCase());
    if (id.reaffirmed !== undefined) parts.push(`reaff.${id.reaffirmed}`);
    if (id.copublisher !== undefined) parts.push(`copub.${id.copublisher.toLowerCase()}`);
    parts[1] = id.publisher !== undefined ? id.publisher.toLowerCase() : "amca";
    parts.push(urnTypeSegment(id.typeMeta()));
    return parts.join(":");
  }
}

export const StandardClass = (() => {
  class Standard extends AmcaIdentifier {
    static polymorphicName = "pubid:amca:standard";
    static urnGenerator = AmcaUrnGenerator;
    static attributes = extendAttributes(AmcaIdentifier, {
      number: { type: "string" },
    });
    static mappings: FieldMapping[] = [
      ...BASE_MAPPINGS,
      { wire: "number", to: "number" },
    ];

    declare readonly number: string | undefined;

    typeMeta(): TypeMeta {
      return { key: "standard", title: "Standard", short: null };
    }
  }
  registerType(Standard as unknown as IdentifierStatic);
  return Standard as unknown as IdentifierStatic;
})();

export const PublicationClass = (() => {
  class Publication extends AmcaIdentifier {
    static polymorphicName = "pubid:amca:publication";
    static urnGenerator = AmcaUrnGenerator;
    static attributes = extendAttributes(AmcaIdentifier, {
      number: { type: "string" },
      revision: { type: "string" },
    });
    static mappings: FieldMapping[] = [
      ...BASE_MAPPINGS,
      { wire: "number", to: "number" },
      { wire: "revision", to: "revision" },
    ];

    declare readonly number: string | undefined;
    declare readonly revision: string | undefined;

    typeMeta(): TypeMeta {
      return { key: "publication", title: "Publication", short: null };
    }

    render(): string {
      const parts: string[] = [];
      if (this.copublisher !== undefined) parts.push(this.copublisher);
      parts.push("Publication");
      parts.push(this.number ?? "");
      if (this.year !== undefined) parts.push(`-${this.year}`);
      if (this.revision !== undefined) parts.push(` (Rev. ${this.revision})`);
      if (this.reaffirmed !== undefined && this.revision === undefined) {
        parts.push(` (${this.reaffirmed})`);
      }
      return parts.join(" ").replaceAll("  ", " ");
    }
  }
  registerType(Publication as unknown as IdentifierStatic);
  return Publication as unknown as IdentifierStatic;
})();

export const InterpretationClass = (() => {
  class Interpretation extends AmcaIdentifier {
    static polymorphicName = "pubid:amca:interpretation";
    static urnGenerator = AmcaUrnGenerator;
    static attributes = extendAttributes(AmcaIdentifier, {
      number: { type: "string" },
      interpretation_code: { type: "string" },
    });
    static mappings: FieldMapping[] = [
      ...BASE_MAPPINGS,
      { wire: "number", to: "number" },
      { wire: "interpretation_code", to: "interpretation_code" },
    ];

    declare readonly number: string | undefined;
    declare readonly interpretation_code: string | undefined;

    typeMeta(): TypeMeta {
      return { key: "interpretation", title: "Interpretation", short: "Interp" };
    }

    render(): string {
      const parts: string[] = [];
      if (this.copublisher !== undefined) parts.push(this.copublisher);
      parts.push(this.number ?? "");
      if (this.interpretation_code !== undefined) {
        parts.push(`– ${this.interpretation_code}`);
      } else if (this.year !== undefined) {
        parts.push(`-${this.year}`);
      }
      if (this.suffix !== undefined) parts.push(` ${this.suffix}`);
      return parts.join(" ").replaceAll("  ", " ");
    }
  }
  registerType(Interpretation as unknown as IdentifierStatic);
  return Interpretation as unknown as IdentifierStatic;
})();
