import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import type { FieldMapping } from "../../model/attribute.js";
import { Language, PubidDate, Iteration } from "../../model/component.js";

/**
 * IEC model classes (lib/pubid/iec/identifiers/*). The typed stage is a
 * runtime attribute driving type derivation and the URN stage slot; the
 * wire hash carries only the stage CODE for non-published drafts.
 */

export type IecTypeCode =
  | "is" | "tr" | "ts" | "pas" | "srd" | "od" | "guide" | "ish"
  | "frag" | "trf" | "tec" | "wp" | "sttr" | "amd" | "cor"
  | "cs" | "ca";

export interface TypedStage {
  code: string;
  stageCode: string;
  typeCode: IecTypeCode;
  abbr: string;
  /**
   * The typed stage's lead harmonized code — the gem's
   * `harmonized_stages.first`, which the official URN's stage slot writes
   * ("stage-30.00") and the URN parser resolves back by (type, code).
   * Absent = the gem's empty `harmonized_stages`: the slot stays EMPTY,
   * never a stage-code fallback (#187).
   */
  harmonized?: string | undefined;
  /** Grammar tokens that resolve to this stage (defaults to [abbr]). */
  tokens?: string[] | undefined;
}

const TS = (code: string, stageCode: string, typeCode: IecTypeCode, abbr: string, harmonized?: string, tokens?: string[]): TypedStage =>
  ({ code, stageCode, typeCode, abbr, harmonized, tokens });

export const TYPED_STAGES: TypedStage[] = [
  // The published IS row lists the publication-lifecycle spellings
  // (BPUB, PPUB, APUB, WPUB, DELPUB, RR, …): they parse onto the
  // published stage whose canonical abbr is "" — the abbreviation drops
  // out of the render ("IEC BPUB 60038" -> "IEC 60038"). The leading ""
  // keeps the grammar's empty type_with_stage match byte-identical with
  // the pre-fold alternation (the bare published face's parse tree).
  TS("is", "published", "is", "", undefined, [
    "", "BPUB", "PPUB", "APUB", "WPUB", "DELPUB", "RR",
  ]),
  TS("tr", "published", "tr", "TR"),
  TS("ts", "published", "ts", "TS"),
  TS("pas", "published", "pas", "PAS"),
  TS("srd", "published", "srd", "SRD"),
  TS("od", "published", "od", "OD"),
  TS("guide", "published", "guide", "GUIDE", undefined, ["GUIDE", "Guide"]),
  TS("ish", "published", "ish", "ISH"),
  TS("frag", "published", "frag", "FRAG"),
  TS("trf", "published", "trf", "TRF"),
  TS("amd", "published", "amd", "AMD"),
  TS("cor", "published", "cor", "COR"),
  // IEC CS (Component Specifications) and IEC CA (Conformity Assessment):
  // the abbreviation leads the code and the publisher renders as its
  // default ("IEC CS 033200-TW0001", "IEC CA 01") — gem
  // ComponentSpecification/ConformityAssessment.
  TS("cs", "published", "cs", "CS"),
  TS("ca", "published", "ca", "CA"),
  // The three standalone deliverable types (gem TechnologyReport /
  // SocietalTechnologyTrendReport / WhitePaper, pubid-ts#195): one
  // published row each, the full phrase the ONLY spelling the gem's
  // grammar accepts ("IEC TECHNOLOGY REPORT", "IEC STTR", "IEC WP AAL"
  // and every draft token (DTEC, CD Technology Report) reject — probed
  // at 2.0.32). The abbreviation renders whole ("IEC Technology Report
  // 62674:2019"); `harmonized` is the gem rows' lead code (60.00, the
  // publication ladder) — inert on emission (published rows suppress
  // the stage slot) and carried for the official-URN parser's
  // `tec-stage-60.00`-style slot resolution, which the gem answers by
  // (type, lead code).
  TS("tec", "published", "tec", "Technology Report", "60.00"),
  TS("sttr", "published", "sttr", "Trend Report", "60.00"),
  TS("wp", "published", "wp", "White Paper", "60.00"),
  // The draft ladders below mirror the gem's per-deliverable
  // TYPED_STAGES rows (lib/pubid/iec/identifiers/*.rb, at 2.0.35 —
  // pubid#733): one row per (deliverable, stage), `abbr` the canonical
  // (ruby abbr.first) spelling the render face prints, `tokens` the
  // spellings the row accepts at parse. Each row renders its OWN
  // spelling (renderer.rb: `id.typed_stage.abbr.first` — the #191/#193
  // pattern) and the wire carries typed_stage.code, so "IEC ADTR 60038"
  // renders "IEC ADTR 60038" and hashes stage "adtr"; only rows that
  // genuinely fold several spellings onto one face normalize the render
  // ("IEC PRF 60038" renders "IEC FDIS 60038" and hashes stage "fdis").
  //
  // `tokens` carry the spellings the gem's COMPILED grammar accepts
  // (data/parg/iec.json), which is narrower than the registry's abbr
  // lists: registry-only spellings (DEL, PRVN, AWI, DIS, ADIS, PCC,
  // SPLIT, MERGED, CAN, RPUB, TPUB, DECPUB, SPE, and every PROJECT_STAGES
  // name) are parse-rejected by the gem and stay out of the tokens.
  //
  // The `harmonized` column is the gem's harmonized_stages.first (issue
  // #187): the official URN stage slot writes `stage-<lead code>` and the
  // URN parser resolves the slot back by (type, lead code). Published
  // rows carry no harmonized: the slot is suppressed for them. Row order
  // follows the correspondence table, so the TR/TS shared 50.92 slots
  // (NDTR/DTRM, NDTS/DTSM — IEC's table gives both spellings of each
  // deliverable the same rejection code; the gem's pnw_stage_spec
  // ALLOWED_COLLISIONS) reverse-resolve to the pair's FIRST row —
  // tr-stage-50.92 decodes DTRM, ts-stage-50.92 decodes DTSM — while the
  // pubid-scheme URN keeps the pair distinct (stage-ndtr vs stage-dtrm).
  TS("pwi", "pwi", "is", "PWI", "00.00", ["PWI", "NWIP", "BWG", "AWIN", "AMW"]),
  // PNW owns harmonized 10.20 (gem: NP stages are 10.00/10.60/… — the
  // URN "stage-10.20" slot resolves to PNW, not NP; #187).
  TS("np", "np", "is", "NP", "10.00", ["NP"]),
  TS("pnw", "pnw", "is", "PNW", "10.20"),
  TS("anw", "anw", "is", "ANW", "10.99", ["ANW"]),
  TS("wd", "wd", "is", "WD", "20.20"),
  // The CD-family rows lead the correspondence table's own CD code,
  // 30.20 ("Draft circulated as CD", data/iec/stage-codes.md) — what the
  // official URN stage slot carries (pubid#787, the pubid-ts#187 parity
  // round). The gem's IS/TR/TS :cd/:cd_tr/:cd_ts rows flipped the same
  // way; 30.00 sits in no row of the table.
  TS("cd", "cd", "is", "CD", "30.20", [
    "CD", "2CD", "3CD", "4CD", "5CD", "6CD", "7CD", "8CD", "9CD",
    "ACD", "A2CD", "A3CD", "A4CD", "A5CD", "A6CD", "A7CD", "A8CD", "A9CD",
    "CDM",
  ]),
  TS("cdv", "cdv", "is", "CDV", "40.00", ["CDV", "ACDV", "CCDV", "CDVM", "NCDV"]),
  TS("fdis", "fdis", "is", "FDIS", "50.00", [
    "FDIS", "PRF", "NFDIS", "NADIS", "RDISH", "RFDIS", "CFDIS",
  ]),
  // The TR ladder — the two-token faces ("IEC CD TR 62048") are the
  // per-deliverable rows' spellings, each decoding onto its own typed
  // stage with the deliverable's type code.
  TS("pwi_tr", "pwi", "tr", "PWI TR", "00.00"),
  TS("np_tr", "np", "tr", "NP TR", "10.00"),
  TS("anw_tr", "anw", "tr", "ANW TR", "10.99"),
  TS("wd_tr", "wd", "tr", "WD TR", "20.20"),
  TS("cd_tr", "cd", "tr", "CD TR", "30.20"),
  // Plain DTR keeps the folded 50.00 ladder (the registration step); the
  // point spellings below are rows of their own, each with the exact
  // code IEC's stage-code correspondence table gives it (pubid#733, gem
  // 2.0.35 — probed in-process: render/URN/pubid-URN/hash round-trip).
  TS("dtr", "draft", "tr", "DTR", "50.00"),
  TS("adtr", "draft", "tr", "ADTR", "40.99"),
  TS("cdtr", "draft", "tr", "CDTR", "50.20"),
  // NDTR and DTRM share the table's 50.92 rejection code: their
  // official-URN slot is the same and the reverse lookup resolves the
  // FIRST row (DTRM); the pubid-scheme URN keeps both codes.
  TS("dtrm", "draft", "tr", "DTRM", "50.92"),
  TS("ndtr", "draft", "tr", "NDTR", "50.92"),
  // The TS ladder.
  TS("pwi_ts", "pwi", "ts", "PWI TS", "00.00"),
  TS("np_ts", "np", "ts", "NP TS", "10.00"),
  TS("anw_ts", "anw", "ts", "ANW TS", "10.99"),
  TS("wd_ts", "wd", "ts", "WD TS", "20.20"),
  TS("cd_ts", "cd", "ts", "CD TS", "30.20"),
  TS("dts", "draft", "ts", "DTS", "50.00"),
  TS("adts", "draft", "ts", "ADTS", "40.99"),
  TS("cdts", "draft", "ts", "CDTS", "50.20"),
  // The TS twin of the TR shared slot: NDTS and DTSM both carry 50.92,
  // the reverse lookup resolves DTSM (the first row).
  TS("dtsm", "draft", "ts", "DTSM", "50.92"),
  TS("ndts", "draft", "ts", "NDTS", "50.92"),
  // The PAS ladder.
  TS("pwi_pas", "pwi", "pas", "PWI PAS", "00.00"),
  TS("np_pas", "np", "pas", "NP PAS", "10.00"),
  TS("anw_pas", "anw", "pas", "ANW PAS", "10.99"),
  TS("wd_pas", "wd", "pas", "WD PAS", "20.20"),
  // CDPAS is PAS's 50.20 row of IEC's stage-code correspondence table
  // ("Draft circulated as DPAS") — not a committee-draft state and
  // claiming no 30.xx code: the fabricated 30.00 row and the CDPAS fold
  // on the DPAS row's spellings are gone (pubid#733, gem 2.0.35).
  TS("cdpas", "draft", "pas", "CDPAS", "50.20"),
  TS("dpas", "draft", "pas", "DPAS", "50.00"),
  // The Guide ladder (the two-token faces and the DGuide/FDGuide drafts).
  TS("pwi_guide", "pwi", "guide", "PWI Guide", "00.00"),
  TS("np_guide", "np", "guide", "NP Guide", "10.00"),
  TS("anw_guide", "anw", "guide", "ANW Guide", "10.99"),
  TS("wd_guide", "wd", "guide", "WD Guide", "20.20"),
  TS("cd_guide", "cd", "guide", "CD Guide", "30.00"),
  TS("dguide", "draft", "guide", "DGuide", "40.00"),
  TS("fdguide", "final_draft", "guide", "FDGuide", "50.00", ["FDGuide", "PRF Guide"]),
  // The DAM family's ballot stages carry the CIRCULATION slots as the
  // lead harmonized code (30.20/50.20), not ISO's 30.00/50.00 — CDAM/
  // FDAM keep those (type, leading code) URN keys (gem Amendment
  // registry; the codes are the per-typed-stage keys the wire
  // serializes: pdam, damd, fdamd, fpdam).
  TS("pdam", "cd", "amd", "PDAM", "30.20"),
  TS("damd", "damd", "amd", "DAM", "40.00"),
  TS("fdamd", "fdamd", "amd", "FDAM", "50.00", ["FDAM", "PRF Amd"]),
  TS("fpdam", "fdamd", "amd", "FPDAM", "50.20"),
  // "CDCOR" is the all-caps spelling the attached-supplement renderer
  // emits (abbr.first upcase) when a legacy prefix face decodes onto a
  // CDCor draft; appended as a token so the canonical render re-parses
  // (spelling-only: abbr stays "CDCor").
  TS("cdcor", "cd", "cor", "CDCor", "30.00", ["CDCor", "CDCOR"]),
  TS("dcor", "dcor", "cor", "DCOR"),
  TS("fdcor", "fdcor", "cor", "FDCOR"),
  TS("cdish", "cdish", "ish", "CDISH"),
  TS("dish", "dish", "ish", "DISH"),
];

export function stageTokens(): string[] {
  return TYPED_STAGES.flatMap((t) => t.tokens ?? [t.abbr]);
}

/**
 * from_hash restores the runtime typed stage from the wire "stage" code
 * (ruby from_hash): the render face rides the typed stage ("/DAM 2.3" vs
 * "/AMD 2.3", "IEC FDIS 60038" vs "IEC 60038"), and the round-trip pins
 * the rebuilt render. The wire carries the stage CODE (construct writes
 * the typed stage's code for non-published stages), so the lookup is by
 * code — the abbreviation does not round-trip it ("damd" vs "DAM").
 * Published stages serialize no stage code; the fallback resolves the
 * type's own published stage (ruby restores Amendment → Amd, TR → TR),
 * so the glued published faces round-trip too.
 */
function restoreTypedStage(id: BaseIdentifier, fallback?: () => TypedStage | undefined): BaseIdentifier {
  const stage = (id as unknown as { stage?: unknown }).stage;
  const typedStage =
    typeof stage === "string" && stage !== ""
      ? TYPED_STAGES.find((t) => t.code === stage)
      : fallback?.();
  (id as unknown as { typedStage?: TypedStage | undefined }).typedStage = typedStage;
  return id;
}

/** The published typed stage of a type code ("tr" -> TR, "amd" -> AMD). */
function publishedStageOfType(typeCode: IecTypeCode): TypedStage | undefined {
  return TYPED_STAGES.find((t) => t.typeCode === typeCode && t.stageCode === "published");
}

export function locateStage(token: string): TypedStage | undefined {
  const needle = token.trim();
  return (
    TYPED_STAGES.find((t) => (t.tokens ?? [t.abbr]).includes(needle)) ??
    TYPED_STAGES.find((t) => t.abbr.toUpperCase() === needle.toUpperCase())
  );
}

const TYPE_NAMES: Record<IecTypeCode, string | undefined> = {
  is: "international-standard",
  tr: "technical-report",
  ts: "technical-specification",
  pas: "publicly-available-specification",
  srd: "systems-reference-document",
  cs: "component-specification",
  ca: "conformity-assessment",
  od: "operational-document",
  guide: "guide",
  ish: "interpretation-sheet",
  frag: "fragment-identifier",
  trf: "test-report-form",
  amd: "amendment",
  cor: "corrigendum",
  // The three standalone deliverable types (gem TechnologyReport /
  // SocietalTechnologyTrendReport / WhitePaper, pubid-ts#195).
  tec: "technology-report",
  wp: "white-paper",
  sttr: "societal-technology-trend-report",
};

// The shared single-document attribute table (SingleIdentifier seam).
const SINGLE_ATTRS = {
  number: { type: "string" },
  part: { type: "string" },
  subpart: { type: "string" },
  date: { type: PubidDate },
  undated: { type: "boolean", default: false },
  edition: { type: "string" },
  languages: { type: Language, collection: true, initializeEmpty: true },
  publisher: { type: "string", default: "IEC" },
  copublishers: { type: "string", collection: true, initializeEmpty: true },
  stage: { type: "string" },
  stage_iteration: { type: Iteration },
  all_parts: { type: "boolean", default: false },
  database: { type: "boolean", default: false },
} as const;

// The dotted sub-number facet (pubid#725): the wire carries the flat
// scalar ("stage_iteration: '3'") while the runtime holds the Iteration
// component — the converter pair the ISO flavor declares for the same
// facet. Shared by the single-document table and the supplement table
// (the facet rides whichever layer's designation carries the dot).
const STAGE_ITERATION_MAPPING: FieldMapping = {
  wire: "stage_iteration",
  to: "stage_iteration",
  toWire: (m) => (m["stage_iteration"] as Iteration | undefined)?.string,
  fromWire: (h) =>
    h["stage_iteration"] === undefined || h["stage_iteration"] === null
      ? undefined
      : new Iteration({ string: String(h["stage_iteration"]) }),
};

// The Identifier-level whitelist: date flat, publisher only when it is
// not the IEC default, copublishers as a body list, stage only for drafts.
const BASE_MAPPINGS = keyValue(
  STAGE_ITERATION_MAPPING,
  {
    wire: "year",
    to: "date",
    toWire: (m) => (m["date"] as PubidDate | undefined)?.year,
    fromWire: (h) =>
      h["year"] === undefined || h["year"] === null
        ? undefined
        : new PubidDate({
            year: String(h["year"]),
            month: h["month"] as string | undefined,
            day: h["day"] as string | undefined,
            undated: h["undated"] === true,
          }),
  },
  { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
  { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
  {
    wire: "undated",
    to: "date",
    toWire: (m) => ((m["date"] as PubidDate | undefined)?.undated ? true : undefined),
    fromWire: (h) => (h["undated"] === true ? new PubidDate({ undated: true }) : undefined),
  },
  { wire: "edition", to: "edition" },
  { wire: "languages", to: "languages" },
  {
    wire: "publisher",
    to: "publisher",
    toWire: (m) => (m["publisher"] === "IEC" ? undefined : m["publisher"]),
    fromWire: (h) => (h["publisher"] === undefined || h["publisher"] === null ? undefined : String(h["publisher"])),
  },
  {
    wire: "copublishers",
    to: "copublishers",
    toWire: (m) => {
      const list = m["copublishers"] as string[] | undefined;
      return list !== undefined && list.length > 0 ? list : undefined;
    },
    fromWire: (h) => (Array.isArray(h["copublishers"]) ? (h["copublishers"] as string[]).map(String) : undefined),
  },
  { wire: "stage", to: "stage" },
  { wire: "all_parts", to: "all_parts" },
  { wire: "database", to: "database" },
);

export abstract class IecIdentifier extends BaseIdentifier {
  declare readonly number: string | undefined;

  /** Walk the supplement chain to the base document (BSI's URN
   * generator reaches the root identity of adopted bases). */
  root(): IecIdentifier {
    const base = (this as unknown as Record<string, unknown>)["base"];
    return base instanceof IecIdentifier ? base.root() : this;
  }

  declare readonly part: string | undefined;
  declare readonly subpart: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly edition: string | undefined;
  declare readonly languages: Language[];
  declare readonly publisher: string | undefined;
  declare readonly copublishers: string[];
  declare readonly stage: string | undefined;
  declare readonly all_parts: boolean | undefined;
  declare readonly database: boolean | undefined;
  declare readonly base: IecIdentifier | undefined;

  /** The runtime typed stage — never serialized directly. */
  typedStage: TypedStage | undefined;

  /** Ruby SingleIdentifier#publisher_portion. */
  publisherPortion(): string {
    // The supplement table does not materialize the empty copublishers
    // collection (the single table's initializeEmpty does) — ruby
    // nil-guards the same read (`copublishers&.any?`, pubid#727: the
    // standalone faces crashed here instead of rendering).
    const copublishers = this.copublishers ?? [];
    const publishers =
      copublishers.length > 0
        ? [this.publisher ?? "IEC", ...copublishers]
        : [this.publisher ?? "IEC"];
    let pub = publishers.join("/");
    const abbr = this.typedStage?.abbr ?? "";
    if (abbr !== "") pub += ` ${abbr}`;
    return pub;
  }

  /** Ruby SingleIdentifier#number_portion. */
  numberPortion(): string {
    return [
      this.number !== undefined ? String(this.number) : "",
      this.part !== undefined ? `-${this.part}` : "",
      this.subpart !== undefined ? `-${this.subpart}` : "",
      this.stageIterationValue() !== undefined ? `.${this.stageIterationValue()}` : "",
      this.date !== undefined ? `:${this.date.render()}` : "",
    ].join("");
  }

  stageIterationValue(): string | undefined {
    return (this as unknown as { stage_iteration?: { string?: string } }).stage_iteration?.string;
  }

  languagePortion(): string {
    if (this.languages.length === 0) return "";
    return `(${this.languages.map((l) => l.code).join(",")})`;
  }
}

function iecSingleClass(kind: IecTypeCode): IdentifierStatic {
  const name = TYPE_NAMES[kind];
  if (name === undefined) throw new Error(`no type name for ${kind}`);
  class IecSingleIdentifier extends IecIdentifier {
    static polymorphicName = `pubid:iec:${name}`;
    static attributes = extendAttributes(BaseIdentifier, SINGLE_ATTRS);
    // Ruby: number/part/subpart live on the SingleIdentifier key_value seam.
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "part", to: "part" },
      { wire: "subpart", to: "subpart" },
      ...BASE_MAPPINGS,
    );

    render(): string {
      let result = `${this.publisherPortion()} ${this.numberPortion()}`;
      if (this.edition !== undefined) result += ` ED${this.edition}`;
      if (this.database === true) result += " DB";
      if (this.all_parts === true) result += " (all parts)";
      result += this.languagePortion();
      return result;
    }

    static fromHash(hash: Record<string, unknown>): BaseIdentifier {
      // The single restores its type's published stage when no stage code
      // rode the hash ("IEC TR 61095" stays "IEC TR 61095").
      return restoreTypedStage(super.fromHash(hash), () => publishedStageOfType(kind));
    }
  }
  registerType(IecSingleIdentifier as unknown as IdentifierStatic);
  return IecSingleIdentifier as unknown as IdentifierStatic;
}

/** Working documents: the committee/number/language/stage identity
 *  serializes (pubid#687) — the document number is the inherited
 *  `number`, and the five plain strings sit in the hash under their own
 *  keys (ruby WorkingDocument's key_value block, render_default off). */
function iecWorkingDocumentClass(): IdentifierStatic {
  class IecWorkingDocument extends IecIdentifier {
    static polymorphicName = "pubid:iec:working-document";
    static attributes = extendAttributes(BaseIdentifier, {
      ...SINGLE_ATTRS,
      wp_stage: { type: "string" },
      wp_type: { type: "string" },
      technical_committee: { type: "string" },
      wd_language: { type: "string" },
      wd_stage: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "part", to: "part" },
      { wire: "subpart", to: "subpart" },
      { wire: "edition", to: "edition" },
      { wire: "technical_committee", to: "technical_committee" },
      { wire: "wd_language", to: "wd_language" },
      { wire: "wd_stage", to: "wd_stage" },
      { wire: "wp_stage", to: "wp_stage" },
      { wire: "wp_type", to: "wp_type" },
    );

    declare readonly wp_stage: string | undefined;
    declare readonly wp_type: string | undefined;
    declare readonly technical_committee: string | undefined;
    declare readonly wd_language: string | undefined;
    declare readonly wd_stage: string | undefined;

    render(): string {
      if (this.wp_stage !== undefined) {
        const parts: string[] = [this.wp_stage];
        if (this.wp_type !== undefined && this.wp_type.trim() !== "") {
          parts.push(` ${this.wp_type.trim()}`);
        }
        if (this.number !== undefined) {
          let numStr = String(this.number);
          if (this.part !== undefined && this.part !== "") numStr += `-${this.part}`;
          if (this.subpart !== undefined && this.subpart !== "") numStr += `-${this.subpart}`;
          parts.push(` ${numStr}`);
        }
        if (this.edition !== undefined) parts.push(` ED${this.edition}`);
        return parts.join("");
      }
      const parts: string[] = [];
      if (this.technical_committee !== undefined) parts.push(this.technical_committee);
      if (this.number !== undefined) {
        let numPart = String(this.number);
        if (this.wd_language !== undefined) numPart += `(${this.wd_language})`;
        parts.push(numPart);
      }
      if (this.wd_stage !== undefined) parts.push(this.wd_stage);
      return parts.join("/");
    }
  }
  registerType(IecWorkingDocument as unknown as IdentifierStatic);
  return IecWorkingDocument as unknown as IdentifierStatic;
}

const yearFromWire = BASE_MAPPINGS.find((x) => x.wire === "year")!.fromWire!;

/** Test report forms: IECEE/IECQ/CISPR documents with an optional embedded CISPR id. */
function iecTrfClass(): IdentifierStatic {
  class IecTestReportForm extends IecIdentifier {
    static polymorphicName = "pubid:iec:test-report-form";
    static attributes = extendAttributes(BaseIdentifier, {
      ...SINGLE_ATTRS,
      cispr_number: { type: "string" },
      cispr_part: { type: "string" },
      trf_info: { type: "string" },
      // The embedded CISPR document is part of the form's identity and
      // serializes under its own key (pubid#687), dispatching on the
      // nested _type like ruby's polymorphic attribute.
      cispr_identifier: { type: IecIdentifier as unknown as IdentifierStatic },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "part", to: "part" },
      { wire: "subpart", to: "subpart" },
      { wire: "year", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.year, fromWire: yearFromWire },
      { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
      { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
      {
        wire: "publisher",
        to: "publisher",
        toWire: (m) => (m["publisher"] === "IEC" ? undefined : m["publisher"]),
        fromWire: (h) => (h["publisher"] === undefined || h["publisher"] === null ? undefined : String(h["publisher"])),
      },
      {
        wire: "copublishers",
        to: "copublishers",
        toWire: (m) => {
          const list = m["copublishers"] as string[] | undefined;
          return list !== undefined && list.length > 0 ? list : undefined;
        },
        fromWire: (h) => (Array.isArray(h["copublishers"]) ? (h["copublishers"] as string[]).map(String) : undefined),
      },
      { wire: "cispr_identifier", to: "cispr_identifier" },
    );

    declare readonly cispr_number: string | undefined;
    declare readonly cispr_part: string | undefined;
    declare readonly trf_info: string | undefined;
    declare readonly cispr_identifier: BaseIdentifier | undefined;

    render(): string {
      let result = this.publisherPortion() + " ";
      // The parse path carries the CISPR document in the runtime columns;
      // a fromHash-built form carries the nested identifier — read the
      // document from whichever one is set (ruby renderer).
      const cispr = this.cispr_identifier as unknown as
        | { number?: unknown; part?: unknown }
        | undefined;
      const cisprNumber = this.cispr_number ??
        (cispr?.number === undefined || cispr.number === null ? undefined : String(cispr.number));
      const cisprPart = this.cispr_part ??
        (cispr?.part === undefined || cispr.part === null || cispr.part === ""
          ? undefined
          : String(cispr.part));
      if (cisprNumber !== undefined) {
        let numStr = cisprNumber;
        if (cisprPart !== undefined && cisprPart !== "") numStr += `-${cisprPart}`;
        let cisprStr = `CISPR ${numStr}`;
        if (this.date !== undefined) cisprStr += `:${this.date.render()}`;
        result += cisprStr;
      } else {
        result += this.numberPortion();
      }
      if (this.trf_info !== undefined && this.trf_info !== "") result += ` ${this.trf_info}`;
      return result;
    }

    static fromHash(hash: Record<string, unknown>): BaseIdentifier {
      // The form restores its published stage ("IECEE TRF 60950" keeps
      // the TRF abbreviation on the rebuilt render).
      return restoreTypedStage(super.fromHash(hash), () => publishedStageOfType("trf"));
    }
  }
  registerType(IecTestReportForm as unknown as IdentifierStatic);
  return IecTestReportForm as unknown as IdentifierStatic;
}

/** Supplements: amendment / corrigendum / interpretation sheet. */
function iecSupplementClass(kind: "amendment" | "corrigendum" | "interpretation-sheet"): IdentifierStatic {
  const notation = kind === "amendment" ? "amd" : kind === "corrigendum" ? "cor" : "ish";
  const abbr = kind === "amendment" ? "AMD" : kind === "corrigendum" ? "COR" : "ISH";
  class IecSupplementIdentifier extends IecIdentifier {
    static polymorphicName = `pubid:iec:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: IecIdentifier as unknown as IdentifierStatic },
      number: { type: "string" },
      // The draft stage rides the wire as the typed stage's code
      // ("stage: fdamd") — the single classes declare the same attr
      // (SINGLE_ATTRS.stage); construct sets it on the parse path.
      stage: { type: "string" },
      synthetic_base: { type: "boolean", default: false },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      // The supplement's own dotted sub-number ("/DAM 2.3:2022" — number
      // 2, stage iteration 3; pubid#725): the supplement holds the same
      // facet the ISO supplement does, and the wire carries it flat.
      STAGE_ITERATION_MAPPING,
      { wire: "year", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.year, fromWire: yearFromWire },
      { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
      { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
      { wire: "edition", to: "edition" },
      {
        wire: "publisher",
        to: "publisher",
        toWire: (m) => (m["publisher"] === "IEC" ? undefined : m["publisher"]),
        fromWire: (h) => (h["publisher"] === undefined || h["publisher"] === null ? undefined : String(h["publisher"])),
      },
      {
        wire: "copublishers",
        to: "copublishers",
        toWire: (m) => {
          const list = m["copublishers"] as string[] | undefined;
          return list !== undefined && list.length > 0 ? list : undefined;
        },
        fromWire: (h) => (Array.isArray(h["copublishers"]) ? (h["copublishers"] as string[]).map(String) : undefined),
      },
      // The draft stage rides the wire as the typed stage's code
      // ("stage: fdamd"); the single classes map the same key (ruby
      // serializes typed_stage.code and restores it in from_hash).
      { wire: "stage", to: "stage" },
      { wire: "base", to: "base" },
    );

    declare readonly synthetic_base: boolean | undefined;

    render(): string {
      const base = this.base;
      if (base === undefined || this.synthetic_base === true) {
        // Standalone draft supplement (not in the corpus; Ruby parity
        // shape). Ruby render_supplement_standalone: the publisher join
        // with NO stage abbreviation (the slash stays the copublisher
        // separator), then the stage token over the self-base number and
        // the supplement's own number ("IEC Amd 1-1:2017"). The published
        // stages print the capitalized abbreviation ("Amd"), the draft
        // stages their own token ("DCOR") — the ruby typed_stage.abbr
        // first element. The publisher rides the attribute default ("IEC"
        // fills it on every parse and from_hash route; ruby renders the
        // nil-publisher hand-built case with no publisher part, a shape
        // no parse or deserialization route reaches).
        const parts: string[] = [];
        const copublishers = this.copublishers ?? [];
        const publishers = [this.publisher ?? "IEC", ...copublishers];
        parts.push(publishers.join("/"));
        const stageAbbr = this.typedStage?.abbr ?? abbr;
        const leadAbbr =
          this.typedStage?.stageCode === "published"
            ? stageAbbr.charAt(0) + stageAbbr.slice(1).toLowerCase()
            : stageAbbr;
        // The self-base holds the supplement's own number (ruby's
        // synthetic base stores it before the render reads it).
        let numberStr = String((base as unknown as { number?: unknown } | undefined)?.number ?? this.number ?? "");
        if (this.number !== undefined) numberStr += `-${this.number}`;
        if (this.subpart !== undefined) numberStr += `-${this.subpart}`;
        parts.push(`${leadAbbr} ${numberStr}`);
        let result = parts.join(" ");
        if (this.date !== undefined) result += `:${this.date.render()}`;
        if (this.edition !== undefined) result += ` ED${this.edition}`;
        return result;
      }
      let result = base.render();
      // The attached-supplement renderer prints the typed stage's own
      // abbreviation, upcased (ruby renderer.rb: abbr.first.upcase) —
      // a published Amendment renders "/AMD1", a draft stage its own
      // token plus the ballot-number separator. Draft-stage supplements
      // carry the ballot face: stage token, SPACE, number
      // ("60038-1/FDAM 1", "60038-1/DCOR 1.3") — the spaced citation
      // form the stored twins carry (ruby renderer.rb
      // ballot_number_separator, pubid#724: the published stages
      // stage_code "published" — Amd/Cor/ISH — keep the glued
      // corpus-dominant face, "/AMD1:2011"; the separator only rides
      // when there is a number, so a numberless supplement renders the
      // bare stage token on either side).
      result += `/${(this.typedStage?.abbr ?? abbr).toUpperCase()}${this.ballotNumberSeparator()}${this.number ?? ""}`;
      // The dotted sub-number rides the supplement's own designation,
      // before the date ("/DAM 2.3:2022"; pubid#725) — dropping it here
      // would silently renumber the supplement ("/DAM 2.3" printing as
      // "/DAM 2") the way the gem's renderer used to.
      if (this.stageIterationValue() !== undefined) result += `.${this.stageIterationValue()}`;
      if (this.date !== undefined) result += `:${this.date.render()}`;
      if (this.edition !== undefined) result += ` ED${this.edition}`;
      return result;
    }

    /** Ruby Renderer#ballot_number_separator: "" without a number or on
     *  a published stage (glued "/AMD1"), " " on a draft stage
     *  ("/FDAM 1" — the spaced citation form). */
    ballotNumberSeparator(): string {
      if (this.number === undefined) return "";
      if (this.typedStage?.stageCode === "published") return "";
      return " ";
    }

    static fromHash(hash: Record<string, unknown>): BaseIdentifier {
      // The supplement restores its type's published stage when no stage
      // code rode the hash (ruby restores Amendment -> Amd — the glued
      // "/AMD1" face round-trips; the draft codes restore their own
      // stage, "/FDAM 1").
      return restoreTypedStage(super.fromHash(hash), () => locateStage(abbr));
    }
  }
  registerType(IecSupplementIdentifier as unknown as IdentifierStatic);
  return IecSupplementIdentifier as unknown as IdentifierStatic;
}

function iecSheetClass(): IdentifierStatic {
  class IecSheetIdentifier extends IecIdentifier {
    static polymorphicName = "pubid:iec:sheet-identifier";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: IecIdentifier as unknown as IdentifierStatic },
      sheet_number: { type: "string" },
      sheet_year: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "base", to: "base" },
      { wire: "sheet_number", to: "sheet_number" },
      { wire: "sheet_year", to: "sheet_year" },
    );

    declare readonly sheet_number: string | undefined;
    declare readonly sheet_year: string | undefined;

    render(): string {
      let result = this.base?.render() ?? "";
      result += `/${this.sheet_number}`;
      if (this.sheet_year !== undefined && this.sheet_year !== "") result += `:${this.sheet_year}`;
      return result;
    }
  }
  registerType(IecSheetIdentifier as unknown as IdentifierStatic);
  return IecSheetIdentifier as unknown as IdentifierStatic;
}

function iecVapClass(): IdentifierStatic {
  class IecVapIdentifier extends IecIdentifier {
    static polymorphicName = "pubid:iec:vap-identifier";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: IecIdentifier as unknown as IdentifierStatic },
      vap: { type: "string", collection: true, initializeEmpty: true },
      edition: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "base", to: "base" },
      { wire: "vap", to: "vap" },
      { wire: "edition", to: "edition" },
    );

    declare readonly vap: string[];

    render(): string {
      let result = this.base?.render() ?? "";
      if (this.vap.length > 0) result += ` ${this.vap.join("-")}`;
      if (this.edition !== undefined) result += ` ED${this.edition}`;
      return result;
    }
  }
  registerType(IecVapIdentifier as unknown as IdentifierStatic);
  return IecVapIdentifier as unknown as IdentifierStatic;
}

function iecConsolidatedClass(): IdentifierStatic {
  class IecConsolidatedIdentifier extends IecIdentifier {
    static polymorphicName = "pubid:iec:consolidated-identifier";
    static attributes = extendAttributes(BaseIdentifier, {
      identifiers: { type: IecIdentifier as unknown as IdentifierStatic, collection: true, initializeEmpty: true },
    });
    static mappings = keyValue({ wire: "identifiers", to: "identifiers" });

    declare readonly identifiers: IecIdentifier[];

    render(): string {
      return this.identifiers
        .map((id, idx) => {
          if (idx === 0) return id.render();
          const kind = id.constructor.polymorphicName.slice("pubid:iec:".length);
          const date = id.date?.render();
          if (kind === "amendment") return date !== undefined && date !== "" ? `+AMD${id.number}:${date}` : `+AMD${id.number}`;
          if (kind === "corrigendum") return date !== undefined && date !== "" ? `+COR${id.number}:${date}` : `+COR${id.number}`;
          return `+${id.render()}`;
        })
        .join("");
    }
  }
  registerType(IecConsolidatedIdentifier as unknown as IdentifierStatic);
  return IecConsolidatedIdentifier as unknown as IdentifierStatic;
}

function iecFragmentClass(): IdentifierStatic {
  class IecFragmentIdentifier extends IecIdentifier {
    static polymorphicName = "pubid:iec:fragment-identifier";
    static attributes = extendAttributes(BaseIdentifier, {
      base: { type: IecIdentifier as unknown as IdentifierStatic },
      fragment_number: { type: "string" },
      edition: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "base", to: "base" },
      { wire: "edition", to: "edition" },
      { wire: "fragment_number", to: "fragment_number" },
    );

    declare readonly fragment_number: string | undefined;

    render(): string {
      const base = this.base;
      let result = base?.render() ?? "";
      const isCorr = base?.constructor.polymorphicName === "pubid:iec:corrigendum";
      result += isCorr ? `/FRAGC${this.fragment_number}` : `/FRAG${this.fragment_number}`;
      if (this.edition !== undefined) result += ` ED${this.edition}`;
      return result;
    }
  }
  registerType(IecFragmentIdentifier as unknown as IdentifierStatic);
  return IecFragmentIdentifier as unknown as IdentifierStatic;
}

// The three standalone deliverable types (pubid-ts#195) are plain
// single-document classes: the gem's TechnologyReport /
// SocietalTechnologyTrendReport / WhitePaper all sit on the
// SingleIdentifier chain and take the full designation (number, part,
// subpart, date, edition, languages, database) — probed at 2.0.32
// ("IEC Technology Report 62674-1-2:2019", "IEC White Paper AAL-1",
// "IEC Trend Report 63090 DB").
const SINGLE_KINDS: IecTypeCode[] = [
  "is", "tr", "ts", "pas", "srd", "od", "guide", "cs", "ca",
  "tec", "sttr", "wp",
];

// The working-document class (the PNW/PWI work-programme forms and the
// committee documents "1/2457/FDIS") is keyed by the working-document
// _type, NOT by the "wp" type code — "wp" is the WhitePaper deliverable's
// type code in the gem, and the type-code dispatch (IecBuilder#buildSingle)
// routes it to the white-paper class. The working-document builders
// construct through this handle directly.
const WORKING_DOCUMENT_CLASS = iecWorkingDocumentClass();

const KIND_CLASSES: Partial<Record<IecTypeCode, IdentifierStatic>> = {};
for (const kind of SINGLE_KINDS) {
  KIND_CLASSES[kind] = iecSingleClass(kind);
}
KIND_CLASSES["trf"] = iecTrfClass();
KIND_CLASSES["amd"] = iecSupplementClass("amendment");
KIND_CLASSES["cor"] = iecSupplementClass("corrigendum");
KIND_CLASSES["ish"] = iecSupplementClass("interpretation-sheet");
const SHEET_CLASS = iecSheetClass();
const VAP_CLASS = iecVapClass();
const CONSOLIDATED_CLASS = iecConsolidatedClass();
const FRAGMENT_CLASS = iecFragmentClass();

export const IEC_CLASSES = {
  KIND_CLASSES,
  WORKING_DOCUMENT_CLASS,
  SHEET_CLASS,
  VAP_CLASS,
  CONSOLIDATED_CLASS,
  FRAGMENT_CLASS,
} as const;
