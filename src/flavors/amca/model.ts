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
    return renderBase(this as unknown as Numbered);
  }
}

type Numbered = AmcaIdentifier & { readonly number: string | undefined };

function renderDocument(id: Numbered, title: string): string {
  // "AMCA Standard 803-02 (R2008)": the year joins the number with a
  // bare dash; the reaffirmation prints with the R prefix.
  let result = [id.copublisher, title, id.number ?? ""].filter((p) => p !== "").join(" ");
  if (id.year !== undefined) result += `-${id.year}`;
  return result;
}

function renderBase(id: Numbered): string {
  let result = renderDocument(id, id.typeMeta().title);
  if (id.reaffirmed !== undefined) result += ` (R${id.reaffirmed})`;
  return result;
}

class AmcaUrnGenerator extends BaseUrnGenerator<Numbered> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "amca"];
    if (id.number !== undefined) parts.push(id.number);
    if (id.year !== undefined) parts.push(id.year);
    if (id.suffix !== undefined) parts.push(id.suffix.toLowerCase());
    const code = (id as unknown as { interpretation_code?: string }).interpretation_code;
    if (code !== undefined) parts.push(`interp.${code.toLowerCase()}`);
    const revision = (id as unknown as { revision?: string }).revision;
    if (revision !== undefined) parts.push(`rev.${revision}`);
    if (id.reaffirmed !== undefined) parts.push(`reaff.${id.reaffirmed}`);
    if (id.copublisher !== undefined) parts.push(`copub.${id.copublisher.toLowerCase()}`);
    parts[1] = id.publisher !== undefined ? id.publisher.toLowerCase() : "amca";
    parts.push(id.typeMeta().key);
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
      // The revision and the reaffirmation are separate optional
      // groups in the grammar, so either or both can appear.
      let result = renderDocument(this, "Publication");
      if (this.revision !== undefined) result += ` (Rev. ${this.revision})`;
      if (this.reaffirmed !== undefined) result += ` (R${this.reaffirmed})`;
      return result;
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
      let result = [this.copublisher, this.number ?? ""].filter((p) => p !== "").join(" ");
      if (this.interpretation_code !== undefined) {
        result += ` ${this.interpretation_code} Interp`;
      } else if (this.year !== undefined) {
        result += ` – ${this.year}`;
      } else {
        result += " Interp";
      }
      if (this.suffix !== undefined) result += ` ${this.suffix}`;
      return result;
    }
  }
  registerType(Interpretation as unknown as IdentifierStatic);
  return Interpretation as unknown as IdentifierStatic;
})();
