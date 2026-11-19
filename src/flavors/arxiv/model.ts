import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";

/**
 * The arxiv identifier model — lib/pubid/arxiv/identifiers/eprint.rb.
 * Registration lives HERE (parg-free) so the worker manifest
 * (src/flavors/register-types.ts) can import it without reaching the
 * artifact runtime; the parse entry (./index.js) is the parg-backed half.
 *
 * An arXiv e-print, new form (`2301.00001`) or old form
 * (`hep-th/9901001`, `math.GT/0309136`). `archive`/`subject_class`
 * (old ids only) are STRICT in the subset match — a nil archive means
 * "this id has none", so a new id never matches an old one and
 * `math/...` never matches `math.GT/...`. The `version` is the only
 * === wildcard. `year`/`month` name the paper (its YYMM), not an
 * edition.
 */

export class ArxivIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:arxiv:identifier";
  static attributes = extendAttributes(BaseIdentifier, {
    archive: { type: "string" },
    subject_class: { type: "string" },
    year: { type: "integer" },
    month: { type: "integer" },
    version: { type: "integer" },
  });
  // The gem's key_value whitelist.
  static mappings = keyValue(
    { wire: "archive", to: "archive" },
    { wire: "subject_class", to: "subject_class" },
    { wire: "year", to: "year" },
    { wire: "month", to: "month" },
    { wire: "number", to: "number" },
    { wire: "version", to: "version" },
  );
  // subset_strict :archive, :subject_class, :year, :month, :number — the
  // version stays the only wildcard.
  static subsetStrict = ["archive", "subject_class", "year", "month", "number"];

  declare readonly archive: string | undefined;
  declare readonly subject_class: string | undefined;
  declare readonly year: number | undefined;
  declare readonly month: number | undefined;
  declare readonly version: number | undefined;

  declare readonly number: string | undefined;

  /** The four-digit YYMM the id prints. */
  yymm(): string {
    const yy = String((this.year ?? 0) % 100).padStart(2, "0");
    const mm = String(this.month ?? 0).padStart(2, "0");
    return `${yy}${mm}`;
  }

  /** True for an old-form (archive) id. */
  oldStyle(): boolean {
    return this.archive !== undefined && this.archive !== null;
  }

  /** The canonical colon form `arXiv:<id>` — whatever prefix the input
   *  used; the `arXiv:` token is constant and every surface prints it. */
  render(): string {
    return `arXiv:${this.body()}${this.versionSuffix()}`;
  }

  /** to_s(with_publisher: false): the bare id — the form the arXiv API
   *  takes in id_list (handled here, not by a publisher-stripper: the
   *  stripper cuts only before a space, "-", "/" or ".", never before
   *  the colon, and publisher_prefixes is [] for that reason). */
  toHuman(opts?: { withPublisher?: boolean }): string {
    const human = super.toHuman();
    if (opts?.withPublisher !== false) return human;
    return human.replace(/^arXiv:/, "");
  }

  /** arXiv registers no official URN namespace, and the base fallback
   *  (urn:arxiv:<number>:<year>) maps different papers to one URN, so
   *  the official form is the lossless pubid-scheme URN. */
  toUrn(): string {
    return this.toPubidUrn();
  }

  protected body(): string {
    if (!this.oldStyle()) return `${this.yymm()}.${this.number ?? ""}`;
    const archive = [this.archive, this.subject_class].filter((v) => v !== undefined).join(".");
    return `${archive}/${this.yymm()}${this.number ?? ""}`;
  }

  protected versionSuffix(): string {
    return this.version !== undefined && this.version !== null ? `v${this.version}` : "";
  }
}

export class ArxivEprint extends ArxivIdentifier {
  static polymorphicName = "pubid:arxiv:eprint";
}

export type ArxivLeafClass = typeof ArxivEprint;

// The ARXIV_TYPE_MAP role: the concrete e-print plus the base (a
// hand-built hash serializes as pubid:arxiv:identifier — the gem's
// Identifier class itself).
registerType(ArxivIdentifier as unknown as IdentifierStatic);
registerType(ArxivEprint as unknown as IdentifierStatic);
