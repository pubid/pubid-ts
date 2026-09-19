import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/asme: the single Standard class (the whole printed
 * code as `number`), the renderer and the URN generator.
 */

class AsmeUrnGenerator extends BaseUrnGenerator<AsmeIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "asme"];

    const specialType = this.specialType(id);
    if (specialType !== undefined) parts.push(specialType);

    parts.push(id.publisher !== undefined ? id.publisher.toLowerCase() : "asme");

    if (id.number !== undefined) parts.push(id.number);

    if (id.draft_year !== undefined) parts.push(id.draft_year);
    else if (id.year !== undefined) parts.push(id.year);

    if (specialType !== "ptc" && id.ptc_suffix !== undefined) {
      parts.push(`ptc-suffix.${id.ptc_suffix}`);
    }
    if (specialType !== "csa" && id.csa_number !== undefined) {
      parts.push(`csa.${id.csa_number}`);
    }
    if (id.first_publisher !== undefined) {
      parts.push(`pub1.${id.first_publisher.toLowerCase()}`);
    }
    if (id.first_code !== undefined) parts.push(`code1.${id.first_code}`);
    if (id.second_publisher !== undefined) {
      parts.push(`pub2.${id.second_publisher.toLowerCase()}`);
    }
    if (id.joint_publisher !== undefined) {
      parts.push(`joint.${id.joint_publisher.toLowerCase()}`);
    }
    if (id.language !== undefined) parts.push(id.language.toLowerCase());
    if (id.reaffirmation !== undefined) parts.push(`reaff.${id.reaffirmation}`);
    if (id.revision_note !== undefined) parts.push(`revnote.${id.revision_note}`);
    if (id.parenthetical_revision !== undefined) {
      parts.push(`prev.${id.parenthetical_revision}`);
    }

    return parts.join(":");
  }

  private specialType(id: AsmeIdentifier): string | undefined {
    if (id.handbook === true) return "handbook";
    if (id.ptc_suffix !== undefined) return "ptc";
    if (id.csa_number !== undefined) return "csa";
    return undefined;
  }
}


export class AsmeIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:asme:standard";
  static urnGenerator = AsmeUrnGenerator;
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: "string" },
    number: { type: "string" },
    year: { type: "string" },
    reaffirmation: { type: "string" },
    language: { type: "string" },
    csa_number: { type: "string" },
    draft_year: { type: "string" },
    revision_note: { type: "string" },
    parenthetical_revision: { type: "string" },
    handbook: { type: "boolean", default: false },
    ptc_suffix: { type: "string" },
    joint_publisher: { type: "string" },
    first_publisher: { type: "string" },
    first_code: { type: "string" },
    second_publisher: { type: "string" },
  });
  static mappings: FieldMapping[] = keyValue(
    { wire: "publisher", to: "publisher" },
    { wire: "number", to: "number" },
    { wire: "year", to: "year" },
    { wire: "reaffirmation", to: "reaffirmation" },
    { wire: "language", to: "language" },
    { wire: "csa_number", to: "csa_number" },
    { wire: "draft_year", to: "draft_year" },
    { wire: "revision_note", to: "revision_note" },
    { wire: "parenthetical_revision", to: "parenthetical_revision" },
    { wire: "handbook", to: "handbook" },
    { wire: "ptc_suffix", to: "ptc_suffix" },
    { wire: "joint_publisher", to: "joint_publisher" },
    { wire: "first_publisher", to: "first_publisher" },
    { wire: "first_code", to: "first_code" },
    { wire: "second_publisher", to: "second_publisher" },
  );

  declare readonly publisher: string | undefined;
  declare readonly number: string | undefined;
  declare readonly year: string | undefined;
  declare readonly reaffirmation: string | undefined;
  declare readonly language: string | undefined;
  declare readonly csa_number: string | undefined;
  declare readonly draft_year: string | undefined;
  declare readonly revision_note: string | undefined;
  declare readonly parenthetical_revision: string | undefined;
  declare readonly handbook: boolean | undefined;
  declare readonly ptc_suffix: string | undefined;
  declare readonly joint_publisher: string | undefined;
  declare readonly first_publisher: string | undefined;
  declare readonly first_code: string | undefined;
  declare readonly second_publisher: string | undefined;

  render(): string {
    const parts: string[] = [];
    if (this.first_publisher !== undefined && this.first_code !== undefined) {
      parts.push(this.first_publisher, this.first_code);
      if (this.second_publisher !== undefined) parts.push(`/${this.second_publisher}`);
      if (this.number !== undefined && this.number !== "") parts.push(this.number);
    } else if (this.joint_publisher !== undefined) {
      parts.push(this.joint_publisher);
      if (this.number !== undefined && this.number !== "") parts.push(this.number);
    } else {
      if (this.publisher !== undefined) parts.push(this.publisher);
      if (this.number !== undefined) parts.push(this.number);
    }

    let result = parts.join(" ");

    if (this.ptc_suffix !== undefined) result += ` ${this.ptc_suffix}`;
    if (this.csa_number !== undefined) result += `/CSA ${this.csa_number}`;
    if (this.handbook === true) result += " Handbook";
    if (this.draft_year !== undefined) result += `-${this.draft_year}`;
    else if (this.year !== undefined) result += `-${this.year}`;
    if (this.parenthetical_revision !== undefined) result += ` ${this.parenthetical_revision}`;
    if (this.language !== undefined) result += ` (${this.language})`;
    if (this.reaffirmation !== undefined) result += ` (${this.reaffirmation})`;
    if (this.revision_note !== undefined) result += ` ${this.revision_note}`;

    return result.replaceAll(/[–—]/g, "-");
  }
}

registerType(AsmeIdentifier as unknown as IdentifierStatic);
