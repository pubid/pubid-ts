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
 * The publication series share one type (pubid#763 widened):
 *
 *   WMO-No. <number>[, <year> edition]   the WMO-No. publication
 *                                        series; editions are calendar
 *                                        years
 *   WMO/TD-No. <number>                  the Technical Document series
 *   JCOMM Technical Report No. <number>  the joint WMO/IOC series
 *   GAW Report No. <number>              the GAW series
 *   S-<number>[ <x.y.z>]                 the WMO-published S-100 product
 *                                        specifications; editions are
 *                                        dotted x.y.z (the IHO lexical
 *                                        form, WMO as the assigning
 *                                        authority - the S-201-of-IALA
 *                                        ruling)
 *   S-<number> [Annex|ANNEX] [<letter>] [<x.y.z>]   annex wrapper
 *
 * The edition is ONE string attribute carrying a type-driven face:
 * "2025" on a Publication, "1.2.1" on a Standard or Annex. The compound
 * faces widen it: a year pair ("2021/2018" — the pair IS the identity
 * face) rides the same string, while the status word ("Provisional")
 * and the updated-in year carry their own attributes. The volume face
 * ("I", "I.1", "D") is its own attribute, printed before the edition
 * face. The renderer and the MRN URN generator key the face off the
 * type.
 */

/** The series config of a series key: the citation face the grammar
 *  matched and the MRN slug prefix (lib/pubid/wmo/identifier.rb). */
interface WmoSeriesConfig {
  face: string;
  mrn: string;
}

/**
 * The publication series beyond the WMO-No. default (the widening
 * prefix law: every head token names its publisher, so the model
 * carries the short key and derives the citation face and the MRN
 * slug from this table). The default row stays out of the table:
 * series is undefined for WMO-No., so existing rows serialize without
 * the key.
 */
const WMO_SERIES: Record<string, WmoSeriesConfig> = {
  TD: { face: "WMO/TD-No.", mrn: "wmo-td" },
  JCOMM: { face: "JCOMM Technical Report No.", mrn: "jcomm-tr" },
  GAW: { face: "GAW Report No.", mrn: "gaw" },
};

/** The WMO-No. series itself: the face the grammar matches and the MRN
 *  slug prefix of the default series (series undefined). */
const WMO_DEFAULT_SERIES: WmoSeriesConfig = { face: "WMO-No.", mrn: "wmo" };

function wmoSeriesConfig(series: string | undefined): WmoSeriesConfig {
  const found = series === undefined ? undefined : WMO_SERIES[series];
  return found ?? WMO_DEFAULT_SERIES;
}

/**
 * The MRN URN generator (lib/pubid/wmo/urn_generator.rb) — the WMO
 * assigning authority of the IANA-registered mrn namespace, following
 * the IALA pattern (pubid#763 proposed form):
 *
 *   urn:mrn:wmo:pub:wmo-<number>[:vol-<v>][:status-<s>][:ed<year>]
 *       [:updated-<year>]                        the WMO-No. series
 *   urn:mrn:wmo:pub:wmo-td-<number>             the TD series
 *   urn:mrn:wmo:pub:jcomm-tr-<number>           the joint WMO/IOC series
 *   urn:mrn:wmo:pub:gaw-<number>                the GAW series
 *   urn:mrn:wmo:pub:s-<number>[:ed<x.y.z>]      the S-100 specs
 *   urn:mrn:wmo:pub:s-<number>:annex[-<letter>][:ed<x.y.z>]
 *
 * The segment order mirrors the human face order (volume, status,
 * edition, updated-in); the volume and status values are caseless
 * (downcased, re-cased by the parser). The year pair keeps its slash
 * out of the NSS as a hyphen ("2021/2018" rides as "ed2021-2018").
 */
class WmoUrnGenerator {
  constructor(private readonly identifier: WmoIdentifier) {}

  generate(): string {
    const id = this.identifier;
    if (id instanceof WmoAnnex) {
      // The base specification's code, then an "annex" segment (lettered
      // form for the "ANNEX A" style, bare for "Annex" without a
      // letter), then the annex's own edition.
      const parts = ["urn:mrn:wmo:pub", `s-${id.base?.number ?? ""}`];
      parts.push(id.letter !== undefined ? `annex-${id.letter.toLowerCase()}` : "annex");
      if (id.edition !== undefined) parts.push(`ed${id.edition}`);
      return parts.join(":");
    }
    // The publication series codes via its SERIES slug ("wmo-1364",
    // "wmo-td-196", "jcomm-tr-14", "gaw-312"); the S-100 specs keep
    // their lexical form lowercased ("s-411").
    const code = id instanceof WmoPublication
      ? `${wmoSeriesConfig(id.series).mrn}-${id.number ?? ""}`
      : `s-${id.number ?? ""}`;
    const parts = ["urn:mrn:wmo:pub", code];
    if (id.volume !== undefined) parts.push(`vol-${id.volume.toLowerCase()}`);
    if (id.edition_status !== undefined) {
      parts.push(`status-${id.edition_status.toLowerCase()}`);
    }
    if (id.edition !== undefined) parts.push(`ed${id.edition.replaceAll("/", "-")}`);
    if (id.updated_in !== undefined) parts.push(`updated-${id.updated_in}`);
    return parts.join(":");
  }
}

/** The base WMO identifier (Pubid::Wmo::Identifier). */
export class WmoIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:wmo:identifier";
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: "string", default: "WMO" },
    number: { type: "string" }, // "1364", "411"
    // The publication series key: undefined (the WMO-No. default),
    // "TD", "JCOMM" or "GAW". The citation face and the MRN slug
    // prefix derive from WMO_SERIES.
    series: { type: "string" },
    // One edition column, type-driven face: "2025" or the year pair
    // "2021/2018" (the WMO-No. series' calendar-year edition) or
    // "1.2.1" (the S-100 dotted edition).
    edition: { type: "string" },
    // The publication volume face ("I", "I.1", "D"); publication-only.
    volume: { type: "string" },
    // The edition status word ("Provisional"); publication-only.
    edition_status: { type: "string" },
    // The year the edition was updated in ("2025"); publication-only.
    updated_in: { type: "string" },
  });
  // The gem's key_value whitelist: _type, number, series, edition,
  // volume, edition_status, updated_in (the defaulted publisher never
  // serializes).
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "series", to: "series" },
    { wire: "edition", to: "edition" },
    { wire: "volume", to: "volume" },
    { wire: "edition_status", to: "edition_status" },
    { wire: "updated_in", to: "updated_in" },
  );
  static urnGenerator = WmoUrnGenerator;

  /** The series config (face + MRN slug prefix) of a series key,
   *  defaulting to the WMO-No. row. */
  static seriesConfig(series: string | undefined): WmoSeriesConfig {
    return wmoSeriesConfig(series);
  }

  /** The series config of this identifier's own series. */
  seriesConfig(): WmoSeriesConfig {
    return wmoSeriesConfig(this.series);
  }

  declare readonly number: string | undefined;
  declare readonly series: string | undefined;
  declare readonly edition: string | undefined;
  declare readonly volume: string | undefined;
  declare readonly edition_status: string | undefined;
  declare readonly updated_in: string | undefined;
  declare readonly publisher: string | undefined;

  /**
   * The MR-slug identity hooks of the gem (lib/pubid/wmo/
   * identifier.rb) — mirrors with no TS consumer yet (to_mr_string has
   * no TS counterpart), kept faithful to the ruby bodies. The compound
   * faces ride the edition segment so distinct identifiers never
   * collide on the slug: the year pair keeps its slash out of the MR
   * charset as a hyphen ("2021/2018" rides as "ed2021-2018"), the
   * status word and the updated-in year suffix it.
   */
  mrEdition(): string | undefined {
    if (this.edition === undefined) return undefined;
    let segment = `ed${this.edition.replaceAll("/", "-")}`;
    if (this.edition_status !== undefined) {
      segment += `-${this.edition_status.toLowerCase()}`;
    }
    if (this.updated_in !== undefined) segment += `-updated${this.updated_in}`;
    return segment;
  }

  /** The series is the type discriminator of the publication series:
   *  "WMO/TD-No. 196" and "WMO-No. 196" are two documents. Downcased
   *  per the MR charset; undefined (no segment) on the WMO-No. default. */
  mrType(): string | undefined {
    return this.series === undefined ? undefined : this.series.toLowerCase();
  }

  /** The volume is an identity discriminator (the ECMA law): Volume I
   *  and Volume II of WMO-No. 8 are two documents sharing one
   *  docidentifier. Downcased per the MR charset. */
  mrVolume(): string | undefined {
    return this.volume === undefined ? undefined : `vol-${this.volume.toLowerCase()}`;
  }

  /** "WMO-No." and the S-number are designations, not publisher tokens:
   *  the canonical faces carry no publisher prefix. */
  render(): string {
    return `S-${this.number ?? ""}` +
      (this.edition !== undefined ? ` ${this.edition}` : "");
  }
}

/** Identifiers::Publication — the WMO-No. publication series and its
 *  widened siblings (TD, JCOMM, GAW). Editions are calendar years —
 *  "2025 edition" — never version ordinals; the face order is the
 *  widening ruling's: volume first, then the edition face (the status
 *  word inside it), then the updated-in year. */
export class WmoPublication extends WmoIdentifier {
  static polymorphicName = "pubid:wmo:publication";

  render(): string {
    let rendered = `${this.seriesConfig().face} ${this.number ?? ""}`;
    if (this.volume !== undefined) rendered += `, Volume ${this.volume}`;
    if (this.edition !== undefined) {
      rendered += this.edition_status !== undefined
        ? `, ${this.edition_status} ${this.edition} edition`
        : `, ${this.edition} edition`;
      if (this.updated_in !== undefined) rendered += `, updated in ${this.updated_in}`;
    }
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
