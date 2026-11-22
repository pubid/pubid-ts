import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes } from "../../model/attribute.js";

/**
 * The wmo identifier model — lib/pubid/wmo/identifier.rb plus its
 * Identifiers::* leaves. Registration lives HERE (parg-free) so the
 * worker manifest (src/flavors/register-types.ts) can import it without
 * reaching the artifact runtime; the parse entry (./index.js) is the
 * parg-backed half.
 *
 * Two series share the flavor (pubid#763):
 *
 *   WMO-No. <number>[, <year> edition]   the WMO-No. publication
 *                                        series; editions are calendar
 *                                        years
 *   S-<number>[ <x.y.z>]                 the WMO-published S-100 product
 *                                        specifications; editions are
 *                                        dotted x.y.z (the IHO lexical
 *                                        form, WMO as the assigning
 *                                        authority - the S-201-of-IALA
 *                                        ruling)
 *   S-<number> [Annex|ANNEX] [<letter>] [<x.y.z>]   annex wrapper
 *
 * The edition is ONE string attribute carrying a type-driven face:
 * "2025" on a Publication, "1.2.1" on a Standard or Annex. The
 * renderer and the MRN URN generator key the face off the type.
 */

/**
 * The MRN URN generator (lib/pubid/wmo/urn_generator.rb) — the WMO
 * assigning authority of the IANA-registered mrn namespace, following
 * the IALA pattern (pubid#763 proposed form):
 *
 *   urn:mrn:wmo:pub:wmo-<number>[:ed<year>]     the WMO-No. series
 *   urn:mrn:wmo:pub:s-<number>[:ed<x.y.z>]      the S-100 specs
 *   urn:mrn:wmo:pub:s-<number>:annex[-<letter>][:ed<x.y.z>]
 */
class WmoUrnGenerator {
  constructor(private readonly identifier: WmoIdentifier) {}

  generate(): string {
    const id = this.identifier;
    if (id instanceof WmoAnnex) {
      const parts = ["urn:mrn:wmo:pub", `s-${id.base?.number ?? ""}`];
      // Lettered form for the "ANNEX A" style, bare for "Annex"
      // without a letter.
      parts.push(id.letter !== undefined ? `annex-${id.letter.toLowerCase()}` : "annex");
      if (id.edition !== undefined) parts.push(`ed${id.edition}`);
      return parts.join(":");
    }
    // The WMO-No. series codes as "wmo-<number>"; the S-100 specs keep
    // their lexical form lowercased ("s-411").
    const code = id instanceof WmoPublication
      ? `wmo-${id.number ?? ""}`
      : `s-${id.number ?? ""}`;
    const parts = ["urn:mrn:wmo:pub", code];
    if (id.edition !== undefined) parts.push(`ed${id.edition}`);
    return parts.join(":");
  }
}

/** The base WMO identifier (Pubid::Wmo::Identifier). */
export class WmoIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:wmo:identifier";
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: "string", default: "WMO" },
    number: { type: "string" },
    // One edition column, type-driven face.
    edition: { type: "string" },
  });
  // The gem's key_value whitelist: _type, number, edition (the
  // defaulted publisher never serializes).
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "edition", to: "edition" },
  );
  static urnGenerator = WmoUrnGenerator;

  declare readonly number: string | undefined;
  declare readonly edition: string | undefined;
  declare readonly publisher: string | undefined;

  /** The edition is a plain string (the string-edition flavors precede
   *  this); the base mr_edition reads edition.number of a
   *  Components::Edition, which would crash on the string. */
  mrEdition(): string | undefined {
    return this.edition === undefined ? undefined : `ed${this.edition}`;
  }

  /** "WMO-No." and the S-number are designations, not publisher tokens:
   *  the canonical faces carry no publisher prefix. */
  render(): string {
    return `S-${this.number ?? ""}` +
      (this.edition !== undefined ? ` ${this.edition}` : "");
  }
}

/** Identifiers::Publication — the WMO-No. series. */
export class WmoPublication extends WmoIdentifier {
  static polymorphicName = "pubid:wmo:publication";

  render(): string {
    let rendered = `WMO-No. ${this.number ?? ""}`;
    if (this.edition !== undefined) rendered += `, ${this.edition} edition`;
    return rendered;
  }
}

/** Identifiers::Standard — the WMO-published S-100 specifications. */
export class WmoStandard extends WmoIdentifier {
  static polymorphicName = "pubid:wmo:standard";
}

/**
 * Identifiers::Annex — an annex to a WMO-published S-100 product
 * specification: "S-411 Annex A" (the DCEG docidentifier). The marker
 * case is preserved (Annex vs ANNEX) for round-trip fidelity; the
 * optional edition applies to the annex itself, not the base.
 */
export class WmoAnnex extends WmoIdentifier {
  static polymorphicName = "pubid:wmo:annex";
  static attributes = extendAttributes(WmoIdentifier, {
    // The specification this annex supplements. Always present;
    // carries the S-number (e.g. S-411).
    base: { type: WmoIdentifier },
    // "Annex" or "ANNEX" — preserved verbatim for exact round-trip.
    annex_form: { type: "string" },
    // "A", "B", … or undefined for the bare form.
    letter: { type: "string" },
  });
  static mappings = keyValue(
    ...WmoIdentifier.mappings,
    { wire: "base", to: "base" },
    { wire: "annex_form", to: "annex_form" },
    { wire: "letter", to: "letter" },
  );

  declare readonly base: WmoIdentifier | undefined;
  declare readonly annex_form: string | undefined;
  declare readonly letter: string | undefined;
  declare readonly edition: string | undefined;

  render(): string {
    let rendered = `S-${this.base?.number ?? ""} ${this.annex_form ?? ""}`;
    if (this.letter !== undefined) rendered += ` ${this.letter}`;
    if (this.edition !== undefined) rendered += ` ${this.edition}`;
    return rendered;
  }
}

// The WMO_TYPE_MAP role: the base plus the three concrete leaves (the
// schema's pubid:wmo:{identifier,publication,standard,annex}).
registerType(WmoIdentifier as unknown as IdentifierStatic);
registerType(WmoPublication as unknown as IdentifierStatic);
registerType(WmoStandard as unknown as IdentifierStatic);
registerType(WmoAnnex as unknown as IdentifierStatic);
