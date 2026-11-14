import { BaseIdentifier, registerType, type IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * The ccsds model declarations (pubid-ts#178) — the parg-free
 * registration module (the worker manifest imports THIS file; the
 * artifact-backed parse entry lives on the flavor index). 1:1 port of
 * lib/pubid/ccsds/identifier.rb + identifiers/ + urn_generator.rb.
 *
 * Faces pinned by the reference: Base#to_s composes by hand ("CCSDS "
 * publisher lead); UrnGenerator#generate_base_urn assembles
 * `urn:ccsds:<number>[.part][-type][-edition][-suffix]`, with the
 * supplement chain emitting `:cor.<n>` segments. A language face makes
 * the reference's own to_urn RAISE (`language&.code` on a plain String —
 * NoMethodError; the corpus exporter omits the `urn` representation for
 * those rows exactly because of this) — mirrored, not papered over.
 */

/** ruby UrnGenerator — the base body is ONE segment; supplements chain
 *  `:cor.<n>` segments onto it. */
export class CcsdsUrnGenerator extends BaseUrnGenerator<CcsdsIdentifier> {
  generate(): string {
    if (this.identifier instanceof CcsdsSupplementIdentifier) {
      return this.generateSupplementUrn(this.identifier);
    }
    return this.generateBaseUrn(this.identifier as CcsdsBaseIdentifier);
  }

  private generateBaseUrn(id: CcsdsBaseIdentifier): string {
    const parts = ["urn", "ccsds"];
    const identifierParts: string[] = [];
    if (id.number) identifierParts.push(id.number);
    if (id.part) identifierParts.push(`.${id.part}`);
    // book_color never populates on the modern hierarchy; type carries
    // the letter (ruby: `elsif identifier.type`).
    if (id.type) identifierParts.push(`-${id.type}`);
    if (id.edition) identifierParts.push(`-${id.edition}`);
    // ruby: retired ? "-S" : suffix — retired never populates here.
    if (id.suffix) identifierParts.push(`-${id.suffix}`);
    if (identifierParts.length > 0) parts.push(identifierParts.join(""));
    if (id.language !== undefined) {
      // Mirrored reference failure: `language&.code` on a plain String
      // raises NoMethodError in ruby (the exporter omits these URNs).
      throw new TypeError(
        "ccsds: the reference raises on a language face (undefined method 'code' for String); no URN exists for it",
      );
    }
    return parts.join(":");
  }

  private generateSupplementUrn(supp: CcsdsSupplementIdentifier): string {
    const parts = ["urn", "ccsds"];
    const chain: CcsdsSupplementIdentifier[] = [];
    let current: CcsdsIdentifier | undefined = supp;
    while (current instanceof CcsdsSupplementIdentifier) {
      chain.unshift(current);
      current = current.base;
    }
    if (current === undefined) {
      throw new TypeError("ccsds: a supplement without a base has no URN body");
    }
    const baseUrn = this.generateBaseUrn(current as CcsdsBaseIdentifier);
    parts.push(baseUrn.replace(/^urn:ccsds:/, ""));
    for (const link of chain) {
      if (link.number !== undefined && link.number !== "") {
        parts.push(`cor.${link.number}`);
      }
    }
    return parts.join(":");
  }
}

/**
 * Abstract root for every CCSDS identifier AND the polymorphic type the
 * supplements' `base` attribute points at — never itself a serialized
 * type (absent from the registry, like ruby's CCSDS_TYPE_MAP omits it;
 * that is what breaks the supplement recursion). Every code component is
 * a plain string, overriding the inherited component types.
 */
export abstract class CcsdsIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    edition: { type: "string" },
    type: { type: "string" },
    suffix: { type: "string" },
    language: { type: "string" },
  });
  // ruby subset_strict :language / :suffix — a nil language means the
  // original English document, a nil suffix the current document.
  static subsetStrict = ["language", "suffix"];
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "part", to: "part" },
    { wire: "edition", to: "edition" },
    { wire: "type", to: "type" },
    { wire: "suffix", to: "suffix" },
    { wire: "language", to: "language" },
  );

  declare readonly number: string;
  declare readonly part: string | undefined;
  declare readonly type: string | undefined;
  declare readonly edition: string | undefined;
  declare readonly suffix: string | undefined;
  declare readonly language: string | undefined;
}

/** The published standard (ruby Identifiers::Base). */
export class CcsdsBaseIdentifier extends CcsdsIdentifier {
  static polymorphicName = "pubid:ccsds:base";
  static urnGenerator = CcsdsUrnGenerator;

  /** ruby Base#to_s: hand composition, publisher lead hard-coded. */
  render(): string {
    let result = `CCSDS ${this.number ?? ""}`;
    if (this.part !== undefined) result += `.${this.part}`;
    if (this.type !== undefined) result += `-${this.type}`;
    if (this.edition !== undefined) result += `-${this.edition}`;
    if (this.suffix !== undefined) result += `-${this.suffix}`;
    if (this.language !== undefined) result += ` - ${this.language} Translated`;
    return result;
  }
}
registerType(CcsdsBaseIdentifier as unknown as IdentifierStatic);

/**
 * Base class for CCSDS supplements; `base` points at the abstract root
 * (never a concrete subclass of itself — the recursion break).
 */
export abstract class CcsdsSupplementIdentifier extends CcsdsIdentifier {
  static attributes = extendAttributes(CcsdsIdentifier, {
    base: { type: CcsdsIdentifier as unknown as IdentifierStatic },
  });
  static mappings = keyValue({ wire: "base", to: "base" });

  declare readonly base: CcsdsIdentifier | undefined;
}

/** The corrigendum (ruby Identifiers::Corrigendum); its `number` is the
 *  corrigendum sequence, mirroring ISO. */
export class CcsdsCorrigendumIdentifier extends CcsdsSupplementIdentifier {
  static polymorphicName = "pubid:ccsds:corrigendum";
  // The merged mapping list (lutaml semantics): the root's code fields
  // first (a supplement's own stay nil), then base.
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "part", to: "part" },
    { wire: "edition", to: "edition" },
    { wire: "type", to: "type" },
    { wire: "suffix", to: "suffix" },
    { wire: "language", to: "language" },
    { wire: "base", to: "base" },
  );
  static urnGenerator = CcsdsUrnGenerator;

  /** ruby Corrigendum#to_s: the base spelling, then " Cor. n". */
  render(): string {
    return `${this.base?.render() ?? ""} Cor. ${this.number ?? ""}`;
  }
}
registerType(CcsdsCorrigendumIdentifier as unknown as IdentifierStatic);

