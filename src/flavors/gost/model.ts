import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/gost: the five identifier classes
 * (interstate/national standard, identical adoption, harmonized,
 * foreign reference), the renderer and the URN generator.
 *
 * GOST shape: GOST [R ][<copublisher> ][<subtype> ]<number>[-<year>]
 *             [/<adopted>][(<refs>)]
 */

export abstract class GostIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    copublisher: { type: "string" },
    subtype: { type: "string" },
    number: { type: "string" },
    year: { type: "string" },
  });
  // publisher defaults to "GOST" but is deliberately NOT mapped: the
  // Ruby class declares it without a key_value entry, so it never
  // serializes (a default-equal scalar would drop anyway).
  static mappings: FieldMapping[] = keyValue(
    { wire: "copublisher", to: "copublisher" },
    { wire: "subtype", to: "subtype" },
    { wire: "number", to: "number" },
    { wire: "year", to: "year" },
  );

  declare readonly copublisher: string | undefined;
  declare readonly subtype: string | undefined;
  declare readonly number: string | undefined;
  declare readonly year: string | undefined;
}

function renderStandard(id: GostIdentifier & { number: string | undefined }): string {
  const national = id instanceof NationalStandard;
  return [
    "GOST",
    national ? " R" : "",
    id.copublisher !== undefined ? ` ${id.copublisher}` : "",
    id.subtype !== undefined ? ` ${id.subtype}` : "",
    ` ${id.number ?? ""}`,
    id.year !== undefined ? `-${id.year}` : "",
  ].join("");
}

class GostUrnGenerator extends BaseUrnGenerator<GostIdentifier> {
  generate(): string {
    let id: GostIdentifier = this.identifier;
    while (id instanceof Harmonized || id instanceof IdenticalAdoption) {
      id = id.base!;
    }
    if (!(id instanceof InterstateStandard) && !(id instanceof NationalStandard)) {
      throw new Error(`Unknown GOST identifier class: ${id.constructor.name}`);
    }
    const parts = ["urn", "gost", "std"];
    if (id instanceof NationalStandard) parts.push("r");
    if (id.number !== undefined) parts.push(id.number);
    if (id.year !== undefined) parts.push(id.year);
    return parts.join(":");
  }
}

export class InterstateStandard extends GostIdentifier {
  static polymorphicName = "pubid:gost:interstate-standard";
  static urnGenerator = GostUrnGenerator;

  render(): string {
    return renderStandard(this);
  }
}

export class NationalStandard extends GostIdentifier {
  static polymorphicName = "pubid:gost:national-standard";
  static urnGenerator = GostUrnGenerator;

  render(): string {
    return renderStandard(this);
  }
}

export class ForeignReference extends GostIdentifier {
  static polymorphicName = "pubid:gost:foreign-reference";
  // raw is instance-only: never declared on the wire (the Ruby class
  // declares the attribute without a key_value mapping).
  static get attributes() {
    return extendAttributes(GostIdentifier, { raw: { type: "string" } });
  }
  static mappings: FieldMapping[] = [];

  declare readonly raw: string | undefined;

  render(): string {
    return this.raw ?? "";
  }
}

// number/year/copublisher/subtype delegate to base (Ruby overrides the
// getters); the delegated values ride along on the wire via the
// compactHash hook.
function delegatedWireFields(
  model: BaseIdentifier,
  hash: Record<string, unknown>,
): void {
  const base = (model as unknown as { base?: GostIdentifier }).base;
  if (base === undefined) return;
  if (base.number !== undefined) hash["number"] = base.number;
  if (base.year !== undefined) hash["year"] = base.year;
  if (base.copublisher !== undefined) hash["copublisher"] = base.copublisher;
  if (base.subtype !== undefined) hash["subtype"] = base.subtype;
}

export class Harmonized extends GostIdentifier {
  static polymorphicName = "pubid:gost:harmonized";
  static urnGenerator = GostUrnGenerator;
  static get attributes() {
    return extendAttributes(GostIdentifier, {
      base: { type: GostIdentifier as unknown as IdentifierStatic },
      adoptedIdentifiers: {
        type: GostIdentifier as unknown as IdentifierStatic,
        collection: true,
      },
    });
  }
  static mappings: FieldMapping[] = [
    ...GostIdentifier.mappings,
    { wire: "base", to: "base" },
    { wire: "adopted_identifiers", to: "adoptedIdentifiers" },
  ];
  static compactHash = delegatedWireFields;

  declare readonly base: GostIdentifier | undefined;
  declare readonly adoptedIdentifiers: GostIdentifier[] | undefined;

  render(): string {
    const base = this.base?.toHuman() ?? "";
    const adopted = (this.adoptedIdentifiers ?? []).map((a) => a.toHuman()).join(", ");
    return adopted === "" ? base : `${base} (${adopted})`;
  }
}

export class IdenticalAdoption extends GostIdentifier {
  static polymorphicName = "pubid:gost:identical-adoption";
  static urnGenerator = GostUrnGenerator;
  static get attributes() {
    return extendAttributes(GostIdentifier, {
      base: { type: GostIdentifier as unknown as IdentifierStatic },
      adopted: { type: GostIdentifier as unknown as IdentifierStatic },
    });
  }
  static mappings: FieldMapping[] = [
    ...GostIdentifier.mappings,
    { wire: "base", to: "base" },
    { wire: "adopted", to: "adopted" },
  ];
  static compactHash = delegatedWireFields;

  declare readonly base: GostIdentifier | undefined;
  declare readonly adopted: GostIdentifier | undefined;

  render(): string {
    return `${this.base?.toHuman() ?? ""}/${this.adopted?.toHuman() ?? ""}`;
  }
}

for (const klass of [
  InterstateStandard,
  NationalStandard,
  ForeignReference,
  Harmonized,
  IdenticalAdoption,
] as unknown as IdentifierStatic[]) {
  registerType(klass);
}
