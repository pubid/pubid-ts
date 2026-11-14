import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, resolveType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue, type FieldMapping } from "../../model/attribute.js";
import { PubidDate } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { grammarImplementation } from "../index.js";
import { mrFromHash } from "../cen_cenelec/model.js";

/**
 * The PFS-compiled cen flavor (pubid/pubid#706; the cen_pfs full
 * absorption is pubid-grammar#121 + pubid#721's regeneration) — one
 * definition file, both engines: the grammar runtime is the SAME baked
 * artifact the Ruby flavor runs (pubid-grammar artifacts/cen_pfs.json,
 * compiled from definitions/cen.pfs by the compiler with the six
 * declared-emission features), loaded through the artifact runtime, so
 * grammar changes land once and this side cannot drift. Nothing is
 * hand-rolled serialization: the model is declared attributes on the
 * unified model (serialization derives from BaseIdentifier), the nine
 * deliverable families are declared document classes (the token in type
 * or publisher position selects the class, the designation token
 * defaulting the publisher column), the prEN/FprEN draft stages fold
 * onto the typed stage whose compact wire code is the definition's
 * stage map, and the render body is the definition's canonical template
 * with presence-guarded optionals. The wrapper classes are the compiled
 * classes the definition's supplements declaration synthesizes (the
 * slash run folds into the standalone wrapper chain, the plus run into
 * the consolidated bundle, the FRAG face wraps the amendment), and the
 * adopted-base dispatch is the §4 coded escape hatch: the hook parses
 * the adopted string with the owning flavor's implementation, switches
 * the ENV adoption to the prestandard, and owns the implicit IEC-range
 * adoption — the same two explicit call points the generated Ruby
 * builder performs. The parity gate (test/cen-pfs-parity.test.ts) pins
 * byte-identity with the coded
 * {@linkcode import("../cen_cenelec/model.js").CenIdentifier} over the
 * shared conformance set (the full 189-row corpus inventory).
 */

/** The declared draft stages (the definition's `stages:` map): the
 * serialized code is the key, the official-URN stage code the declared
 * `urn:` value — the same trio the coded flavor's stage registry rows
 * carry, restricted to the declared subset. */
export interface CenPfsStage {
  code: string;
  stage_code: string;
  type_code: string;
  abbr: string;
}

export const STAGES: Record<string, CenPfsStage> = {
  pren: { code: "pren", stage_code: "proposal", type_code: "en", abbr: "prEN" },
  fpren: { code: "fpren", stage_code: "final_proposal", type_code: "en", abbr: "FprEN" },
};

/** The captured spelling → the serialized stage code (the builder's
 * STAGE_MAP). */
const STAGE_MAP: Record<string, string> = {
  prEN: "pren",
  FprEN: "fpren",
};

export function locateStageByCode(code: string): CenPfsStage | undefined {
  return STAGES[code];
}

/** Ruby truthiness for a captured face: an absent capture is absent. */
function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function strOf(value: unknown): string | undefined {
  if (!present(value)) return undefined;
  return String(value);
}

/** A raw capture leaf ({value, line, …}) yields its value; a bound
 * scalar passes through (the run's internal captures bind only through
 * the item row, so unbound ones arrive as raw leaves). */
function unwrap(capture: unknown): unknown {
  if (typeof capture === "object" && capture !== null && "value" in capture) {
    return (capture as Record<string, unknown>)["value"];
  }
  return capture;
}

/** The builder's present_string: a capture the grammar bound as an
 * empty string stores as nil (to_hash drops the empty string, so
 * from_hash would give nil and the two identifiers would not be ==). */
function presentString(value: unknown): string | undefined {
  const s = strOf(value);
  return s === undefined || s === "" ? undefined : s;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The publisher face: the captured column, else the class's declared
 * publisher default (feature 5) — Ruby's default-valued Publisher
 * component, which the render view and the fused URN group read. */
function publisherFace(id: CenPfsIdentifier): string | undefined {
  const bound = strOf(id.publisher);
  if (bound !== undefined) return bound;
  const spec = (id.constructor as unknown as IdentifierStatic).attributes["publisher"];
  return typeof spec?.default === "string" ? spec.default : undefined;
}

/**
 * The compiled flavor's identifier base: the shared render machinery
 * (the definition's canonical template) and the FLAVOR-LOCAL type
 * dispatch. The concrete classes carry the scheme's canonical wire tags
 * (pubid:cencenelec:…), which deliberately stay OUT of the global type
 * map — one scheme, one `_type`, one global resolution (the coded
 * class); {@linkcode fromHash} routes the tags back here flavor-locally
 * first (mirroring Ruby's flavor-base polymorphic_type_map), then falls
 * through to the global registry for the cross-flavor nested identifiers
 * (the adopted ISO/IEC document), exactly the TypeResolver order.
 */
export abstract class CenPfsIdentifier extends BaseIdentifier {
  /** The wire tags the compiled classes answer, resolved flavor-locally. */
  static localTypeMap = new Map<string, new (attrs?: Record<string, unknown>) => CenPfsIdentifier>();

  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly version: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly publisher: string | undefined;
  declare readonly copublishers: string[] | undefined;
  declare readonly type: string | undefined;
  declare readonly typedStage: CenPfsStage | undefined;

  /** The alias's own from_hash: the scheme tags route HERE, the
   * cross-flavor tags (a nested adopted ISO/IEC document) fall through
   * to the global registry, while the cen tags never reach the coded
   * classes (coexistence, not cutover). */
  static fromHash(hash: Record<string, unknown>): BaseIdentifier {
    const tag = typeof hash["_type"] === "string" ? hash["_type"] : undefined;
    const klass = tag !== undefined ? this.localTypeMap.get(tag) : undefined;
    if (klass === undefined && tag !== undefined) {
      const global = resolveType(tag);
      if (global !== undefined) return global.fromHash(hash);
    }
    const target = (klass ?? this) as unknown as IdentifierStatic & {
      applyMappings(data: Record<string, unknown>): Record<string, unknown>;
      inflateScalarComponents(data: Record<string, unknown>): Record<string, unknown>;
    };
    return new target(
      target.applyMappings(target.inflateScalarComponents(hash)),
    ) as unknown as BaseIdentifier;
  }

  /** The definition's canonical face — the head alternation picks the
   * first alternative whose direct fields captured: the draft face, the
   * Guide word face, the adopted face, else the publisher face with the
   * optional slash type; the run and the FRAG face follow. */
  render(): string {
    let root: CenPfsIdentifier = this;
    let run = "";
    let members: CenPfsIdentifier[] | undefined;
    let frag: string | undefined;
    if (root instanceof CenPfsFragment) {
      frag = root.number;
      root = root.base ?? root;
    }
    if (root instanceof CenPfsConsolidatedIdentifier) {
      const [base, ...consolidated] = root.identifiers;
      members = consolidated;
      root = base ?? root;
    }
    while (root instanceof CenPfsSupplement) {
      run = `/${root.supplementNotation()}${run}`;
      root = root.base ?? root;
    }
    if (members !== undefined) {
      for (const member of members) {
        run += `+${(member as CenPfsSupplement).supplementNotation()}`;
      }
    }
    const view = {
      publisher: publisherFace(root),
      copublishers:
        root.copublishers !== undefined && root.copublishers.length > 0
          ? root.copublishers.map((item) => `/${item}`).join("")
          : undefined,
      stage: root.typedStage?.abbr,
      type:
        root.type !== undefined && (root.type === "TR" || root.type === "TS")
          ? root.type
          : undefined,
      guide: root.type === "Guide" ? root.type : undefined,
      number: strOf(root.number),
      part: strOf(root.part),
      version: root.version,
      year: root.date?.year,
      adopted: (root as unknown as Record<string, unknown>)["adopted"],
    };
    let head = "";
    if (present(view.stage) && present(view.number)) {
      head =
        `${view.stage} ${view.number}` +
        `${present(view.part) ? `-${view.part}` : ""}` +
        `${present(view.version) ? String(view.version) : ""}` +
        `${present(view.year) ? `:${view.year}` : ""}`;
    } else if (present(view.publisher) && present(view.guide) && present(view.number)) {
      head =
        `${view.publisher}${view.copublishers ?? ""} ${view.guide} ${view.number}` +
        `${present(view.part) ? `-${view.part}` : ""}` +
        `${present(view.year) ? `:${view.year}` : ""}`;
    } else if (present(view.publisher) && view.adopted !== undefined && view.adopted !== null) {
      head = `${view.publisher}${view.copublishers ?? ""} ${String(view.adopted)}`;
    } else if (present(view.publisher) && present(view.number)) {
      head =
        `${view.publisher}${view.copublishers ?? ""}` +
        `${present(view.type) ? `/${view.type}` : ""} ${view.number}` +
        `${present(view.part) ? `-${view.part}` : ""}` +
        `${present(view.version) ? String(view.version) : ""}` +
        `${present(view.year) ? `:${view.year}` : ""}`;
    }
    const tail =
      run === ""
        ? ""
        : `${run}${present(frag) ? ` FRAG${frag}` : ""}`;
    return head + tail;
  }
}

/**
 * The official URN: the definition's urn.official fused segments —
 * urn:cen[:<publisher group>][:<adopted fused MR>][:<composed
 * code>][:<year>][:<stage code>]; a wrapper reads through to its
 * subject and appends its declared chain (:amd:/:cor:), the
 * consolidated bundle marks each member with the plus marker, and the
 * fragment's :frag: segments come last.
 */
class CenPfsUrnGenerator extends BaseUrnGenerator<CenPfsIdentifier> {
  generate(): string {
    let id: CenPfsIdentifier = this.identifier;
    let fragSegments: string[] = [];
    const wrapper: string[] = [];
    let members: CenPfsIdentifier[] | undefined;
    if (id instanceof CenPfsFragment) {
      fragSegments = wrapperSegments(id);
      id = id.base ?? id;
    }
    if (id instanceof CenPfsConsolidatedIdentifier) {
      const [base, ...consolidated] = id.identifiers;
      members = consolidated;
      id = base ?? id;
    }
    while (id instanceof CenPfsSupplement) {
      wrapper.unshift(...wrapperSegments(id));
      id = id.base ?? id;
    }
    const parts = ["urn", "cen", ...officialSegments(id), ...wrapper];
    if (members !== undefined) {
      for (const member of members) parts.push("plus", ...wrapperSegments(member));
    }
    parts.push(...fragSegments);
    return parts.join(":");
  }
}

/** The fused official segments: the publisher group, the adopted
 * document's MR string with its separators fused to colons, the
 * composed code, the year, the draft-stage code. */
function officialSegments(id: CenPfsIdentifier): string[] {
  const segments: string[] = [];
  const group = [publisherFace(id), ...(id.copublishers ?? [])]
    .filter((p) => present(p))
    .map((p) => String(p).toLowerCase());
  if (group.length > 0) segments.push(group.join("-"));
  const adopted = (id as unknown as Record<string, unknown>)["adopted"] as
    | BaseIdentifier
    | undefined;
  if (adopted !== undefined && adopted !== null) {
    const mr = mrFromHash(adopted.toHash());
    if (mr !== "") segments.push(mr.replaceAll(".", ":").replaceAll("_", ":"));
  }
  const code = [
    strOf(id.number),
    present(id.part) ? `-${id.part}` : undefined,
  ].filter((c): c is string => present(c));
  if (code.length > 0) segments.push(code.join(""));
  const date = [id.date?.year].filter((y): y is string => present(y));
  if (date.length > 0) segments.push(date.join("-"));
  const stageCode = id.typedStage?.stage_code;
  if (stageCode !== undefined && stageCode !== "published") {
    segments.push(`stage.${stageCode}`);
  }
  return segments;
}

/** One wrapper's declared URN chain: the kind word, then the wrapper's
 * columns (the ordinal, the year-month date). */
function wrapperSegments(id: CenPfsIdentifier): string[] {
  let segments: unknown[];
  if (id instanceof CenPfsAmendment) {
    segments = ["amd", id.number, id.year];
  } else if (id instanceof CenPfsCorrigendum) {
    segments = ["cor", id.number, id.supplementDate()];
  } else if (id instanceof CenPfsFragment) {
    segments = ["frag", id.number];
  } else {
    segments = [];
  }
  return segments.map((s) => String(s ?? "")).filter((s) => s !== "");
}

// --- the compiled class family -------------------------------------------------

/** The stage wire: the typed stage serializes as its compact code
 * ("stage" => "pren") and reads back through the declared subset. */
const stageWire: FieldMapping = {
  wire: "stage",
  to: "typedStage",
  toWire: (model) => (model["typedStage"] as CenPfsStage | undefined)?.code,
  fromWire: (hash) => {
    const code = hash["stage"];
    return typeof code === "string" ? locateStageByCode(code) : undefined;
  },
};

interface DocumentSpec {
  /** The scheme-canonical wire tag (declared in the definition). */
  tag: string;
  /** The publisher default (feature 5): the type's own token when the
   * type is its designation, else the scheme default. */
  publisher: string;
  /** The type column's default (the class's own short face). */
  type: string;
  /** The adoption wrapper classes (AEN, ENV) carry the nested document. */
  adopted?: boolean;
}

/** A declared document family: the columns the coded builder casts, the
 * class defaults, and the whitelist that keeps the wire flat. */
function documentClass(spec: DocumentSpec): (new (attrs?: Record<string, unknown>) => CenPfsIdentifier) & IdentifierStatic {
  abstract class CenPfsDocument extends CenPfsIdentifier {
    static get polymorphicName(): string {
      return spec.tag;
    }
    static get attributes() {
      return extendAttributes(BaseIdentifier, {
        number: { type: "string" },
        part: { type: "string" },
        version: { type: "string" },
        date: { type: PubidDate },
        publisher: { type: "string", default: spec.publisher },
        copublishers: { type: "string", collection: true },
        type: { type: "string", default: spec.type },
        typedStage: { type: "string" },
        ...(spec.adopted
          ? { adopted: { type: CenPfsIdentifier as unknown as IdentifierStatic } }
          : {}),
      });
    }
    static get mappings(): FieldMapping[] {
      return keyValue(
        { wire: "number", to: "number" },
        { wire: "part", to: "part" },
        { wire: "version", to: "version" },
        { wire: "date", to: "date" },
        { wire: "publisher", to: "publisher" },
        { wire: "copublishers", to: "copublishers" },
        { wire: "type", to: "type" },
        stageWire,
        ...(spec.adopted
          ? [{ wire: "adopted", to: "adopted" } as FieldMapping]
          : []),
      );
    }
    static urnGenerator = CenPfsUrnGenerator;

    declare readonly adopted: BaseIdentifier | undefined;
  }
  return CenPfsDocument as unknown as (new (
    attrs?: Record<string, unknown>,
  ) => CenPfsIdentifier) & IdentifierStatic;
}

/** The nine deliverable families plus the adoption wrapper (the
 * definition's `types:` map): the token-free EuropeanNorm is the
 * default class. */
export const CenPfsEuropeanNorm = documentClass({
  tag: "pubid:cencenelec:european-norm",
  publisher: "EN",
  type: "EN",
});
export const CenPfsAdoptedEuropeanNorm = documentClass({
  tag: "pubid:cencenelec:adopted-european-norm",
  publisher: "EN",
  type: "EN",
  adopted: true,
});
export const CenPfsTechnicalReport = documentClass({
  tag: "pubid:cencenelec:technical-report",
  publisher: "EN",
  type: "TR",
});
export const CenPfsTechnicalSpecification = documentClass({
  tag: "pubid:cencenelec:technical-specification",
  publisher: "EN",
  type: "TS",
});
export const CenPfsGuide = documentClass({
  tag: "pubid:cencenelec:guide",
  publisher: "EN",
  type: "Guide",
});
export const CenPfsCenReport = documentClass({
  tag: "pubid:cencenelec:cen-report",
  publisher: "CR",
  type: "CR",
});
export const CenPfsCenWorkshopAgreement = documentClass({
  tag: "pubid:cencenelec:cen-workshop-agreement",
  publisher: "CWA",
  type: "CWA",
});
export const CenPfsEuropeanSpecification = documentClass({
  tag: "pubid:cencenelec:european-specification",
  publisher: "ES",
  type: "ES",
});
export const CenPfsEuropeanPrestandard = documentClass({
  tag: "pubid:cencenelec:european-prestandard",
  publisher: "ENV",
  type: "ENV",
  adopted: true,
});
export const CenPfsHarmonizationDocument = documentClass({
  tag: "pubid:cencenelec:harmonization-document",
  publisher: "HD",
  type: "HD",
});

/** The type each declared token selects (feature 1); the token-free
 * type is the default class. */
const TYPE_TOKENS: Record<string, new (attrs?: Record<string, unknown>) => CenPfsIdentifier> = {
  TR: CenPfsTechnicalReport,
  TS: CenPfsTechnicalSpecification,
  Guide: CenPfsGuide,
  CR: CenPfsCenReport,
  CWA: CenPfsCenWorkshopAgreement,
  ES: CenPfsEuropeanSpecification,
  ENV: CenPfsEuropeanPrestandard,
  HD: CenPfsHarmonizationDocument,
};

/** The supplement wrapper base: the wrapper owns its ordinal and the
 * base identifier; every rendered face reads through. */
abstract class CenPfsSupplement extends CenPfsIdentifier {
  static get attributes() {
    return extendAttributes(BaseIdentifier, {
      base: { type: CenPfsIdentifier as unknown as IdentifierStatic },
      number: { type: "string" },
      year: { type: "string" },
      month: { type: "string" },
    });
  }
  static get mappings(): FieldMapping[] {
    return keyValue(
      { wire: "base", to: "base" },
      { wire: "number", to: "number" },
      { wire: "year", to: "year" },
      { wire: "month", to: "month" },
    );
  }
  static urnGenerator = CenPfsUrnGenerator;

  declare readonly base: CenPfsIdentifier | undefined;
  declare readonly year: string | undefined;
  declare readonly month: string | undefined;

  /** The wrapper's date: "2016-11", "2003", or undefined. */
  supplementDate(): string | undefined {
    if (!present(this.year)) return undefined;
    return [this.year, this.month]
      .filter((m): m is string => present(m))
      .join("-");
  }

  /** The printed notation: the kind face, the ordinal (absent for an
   * unnumbered corrigendum) and the declared date tail. */
  supplementNotation(): string {
    return (
      (this.constructor as unknown as { FACE: string }).FACE +
      (this.number ?? "") +
      (present(this.year) ? `:${this.year}` : "") +
      (present(this.month) ? `-${this.month}` : "")
    );
  }
}

export class CenPfsAmendment extends CenPfsSupplement {
  /** The kind face "A" is the run's dispatch token and the notation
   * face. */
  static get polymorphicName(): string {
    return "pubid:cencenelec:amendment";
  }
  static FACE = "A";
}
export class CenPfsCorrigendum extends CenPfsSupplement {
  /** The kind face "AC" is the run's dispatch token and the notation
   * face. */
  static get polymorphicName(): string {
    return "pubid:cencenelec:corrigendum";
  }
  static FACE = "AC";
}

/** The consolidated (plus-run) bundle: the base document is the first
 * member; the supplements carry no base. */
export class CenPfsConsolidatedIdentifier extends CenPfsIdentifier {
  static get polymorphicName(): string {
    return "pubid:cencenelec:consolidated-identifier";
  }
  static get attributes() {
    return extendAttributes(BaseIdentifier, {
      identifiers: {
        type: CenPfsIdentifier as unknown as IdentifierStatic,
        collection: true,
      },
    });
  }
  static get mappings(): FieldMapping[] {
    return keyValue({ wire: "identifiers", to: "identifiers" });
  }
  static urnGenerator = CenPfsUrnGenerator;

  declare readonly identifiers: CenPfsIdentifier[];
}

/** The fragment wrapper: a fragment of the amendment it wraps; the
 * fragment ordinal is its own `number`. */
export class CenPfsFragment extends CenPfsIdentifier {
  static get polymorphicName(): string {
    return "pubid:cencenelec:fragment";
  }
  static get attributes() {
    return extendAttributes(BaseIdentifier, {
      base: { type: CenPfsIdentifier as unknown as IdentifierStatic },
      number: { type: "string" },
    });
  }
  static get mappings(): FieldMapping[] {
    return keyValue(
      { wire: "base", to: "base" },
      { wire: "number", to: "number" },
    );
  }
  static urnGenerator = CenPfsUrnGenerator;

  declare readonly base: CenPfsIdentifier | undefined;
}

for (const klass of [
  CenPfsEuropeanNorm,
  CenPfsAdoptedEuropeanNorm,
  CenPfsTechnicalReport,
  CenPfsTechnicalSpecification,
  CenPfsGuide,
  CenPfsCenReport,
  CenPfsCenWorkshopAgreement,
  CenPfsEuropeanSpecification,
  CenPfsEuropeanPrestandard,
  CenPfsHarmonizationDocument,
  CenPfsAmendment,
  CenPfsCorrigendum,
  CenPfsConsolidatedIdentifier,
  CenPfsFragment,
]) {
  CenPfsIdentifier.localTypeMap.set(klass.polymorphicName, klass);
}

// --- the builder (the generated builder's shape) -------------------------------

function copublishersOf(flat: Record<string, unknown>): string[] {
  const rows = flat["copublishers"];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => strOf(unwrap(isRecord(row) ? row["copublisher"] : row)))
    .filter((c): c is string => c !== undefined && c !== "");
}

/** The class each reference selects: the type-position token first,
 * then the publisher-position token (the publisher-type faces
 * CR/CWA/…), then the token-free default class. */
function locateIdentifierKlass(flat: Record<string, unknown>): new (attrs?: Record<string, unknown>) => CenPfsIdentifier {
  const token = presentString(unwrap(flat["guide"])) ?? presentString(unwrap(flat["type"]));
  const publisher = strOf(unwrap(flat["publisher"]));
  const selected =
    token ?? (publisher !== undefined && publisher in TYPE_TOKENS ? publisher : undefined);
  return selected !== undefined
    ? (TYPE_TOKENS[selected] ?? CenPfsEuropeanNorm)
    : CenPfsEuropeanNorm;
}

/** The columns, as the coded builder's cast writes them. */
function assignAttributes(flat: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const year = strOf(unwrap(flat["year"]));
  if (year !== undefined) attrs["date"] = new PubidDate({ year });
  const number = strOf(unwrap(flat["number"]));
  if (number !== undefined) attrs["number"] = number;
  const part = strOf(unwrap(flat["part"]));
  if (part !== undefined) attrs["part"] = part;
  const version = presentString(unwrap(flat["version"]));
  if (version !== undefined) attrs["version"] = version;
  const publisher = strOf(unwrap(flat["publisher"]));
  if (publisher !== undefined) attrs["publisher"] = publisher;
  const copubs = copublishersOf(flat);
  if (copubs.length > 0) attrs["copublishers"] = copubs;
  const typeToken =
    presentString(unwrap(flat["guide"])) ?? presentString(unwrap(flat["type"]));
  if (typeToken !== undefined) attrs["type"] = typeToken;
  const stageCode = STAGE_MAP[strOf(unwrap(flat["stage"])) ?? ""];
  if (stageCode !== undefined) attrs["typedStage"] = locateStageByCode(stageCode);
  return attrs;
}

/** The adopted-base dispatch (the §4 coded escape hatch): the adopted
 * string parses with the owning scheme's implementation ("ISO" leads
 * through iso — its ISO/IEC copublisher spelling included, "IEC"
 * through iec); an ENV-prefixed adoption switches the class to the
 * prestandard, the publisher staying ENV. */
function parseAdopted(adoptedStr: string): BaseIdentifier | undefined {
  if (adoptedStr.startsWith("IEC")) {
    const impl = grammarImplementation("iec");
    if (impl === undefined) throw new Error("iec implementation unavailable");
    return impl.parse(adoptedStr) as unknown as BaseIdentifier;
  }
  if (adoptedStr.startsWith("ISO")) {
    const impl = grammarImplementation("iso");
    if (impl === undefined) throw new Error("iso implementation unavailable");
    return impl.parse(adoptedStr) as unknown as BaseIdentifier;
  }
  return undefined;
}

function adoptedBuild(flat: Record<string, unknown>): CenPfsIdentifier | undefined {
  const adoptedStr = strOf(unwrap(flat["adopted"]))?.trim();
  if (adoptedStr === undefined || adoptedStr === "") return undefined;
  const adoptedId = parseAdopted(adoptedStr);
  const publisher = strOf(unwrap(flat["publisher"]));
  if (publisher === "ENV") {
    return new CenPfsEuropeanPrestandard({ publisher: "ENV", adopted: adoptedId });
  }
  const attrs: Record<string, unknown> = { adopted: adoptedId };
  const stageCode = STAGE_MAP[strOf(unwrap(flat["stage"])) ?? ""];
  if (stageCode !== undefined) attrs["typedStage"] = locateStageByCode(stageCode);
  if (publisher !== undefined) attrs["publisher"] = publisher;
  const copubs = copublishersOf(flat);
  if (copubs.length > 0) attrs["copublishers"] = copubs;
  return new CenPfsAdoptedEuropeanNorm(attrs);
}

/** The implicit adoption probe: an EN with a bare number in the IEC
 * range (60000-79999), no copublishers, no part and no supplements,
 * adopts the corresponding IEC standard — the ISO-only range is
 * intentionally NOT mapped (pubid#249). */
function implicitAdoption(flat: Record<string, unknown>): CenPfsIdentifier | undefined {
  if (strOf(unwrap(flat["publisher"])) !== "EN") return undefined;
  if (copublishersOf(flat).length > 0) return undefined;
  if (present(flat["part"])) return undefined;
  const supplements = flat["supplements"];
  if (Array.isArray(supplements) && supplements.length > 0) return undefined;
  const number = strOf(unwrap(flat["number"]))?.trim();
  if (number === undefined || !/^\d{1,6}$/.test(number)) return undefined;
  const num = Number.parseInt(number, 10);
  if (!(num >= 60000 && num <= 79999)) return undefined;
  const impl = grammarImplementation("iec");
  if (impl === undefined) return undefined;
  return new CenPfsAdoptedEuropeanNorm({
    adopted: impl.parse(`IEC ${number}`) as unknown as BaseIdentifier,
  });
}

function buildBaseDocument(flat: Record<string, unknown>): CenPfsIdentifier {
  if (present(flat["adopted"])) {
    const built = adoptedBuild(flat);
    if (built !== undefined) return built;
  }
  const implicit = implicitAdoption(flat);
  if (implicit !== undefined) return implicit;
  return new (locateIdentifierKlass(flat))(assignAttributes(flat));
}

/** The run's internal captures bind only through the item row, so the
 * raw supplement item arrives as the capture map itself. */
function supplementItemOf(row: unknown): Record<string, unknown> {
  const inner = isRecord(row) ? row["supplement"] : undefined;
  return isRecord(inner) ? inner : {};
}

/** The wrapper classes by kind face: the run's dispatch. */
function supplementFrom(
  item: Record<string, unknown>,
  base?: CenPfsIdentifier,
): CenPfsIdentifier {
  const kind = strOf(unwrap(item["supplement_kind"])) ?? "";
  const Wrapper =
    kind === CenPfsAmendment.FACE
      ? CenPfsAmendment
      : kind === CenPfsCorrigendum.FACE
        ? CenPfsCorrigendum
        : undefined;
  if (Wrapper === undefined) {
    throw new ParseFailed(`CEN: unknown supplement kind ${kind}`, 0);
  }
  const attrs: Record<string, unknown> = {};
  if (base !== undefined) attrs["base"] = base;
  const number = presentString(unwrap(item["supplement_number"]));
  if (number !== undefined) attrs["number"] = number;
  const year = presentString(unwrap(item["supplements_year"]));
  if (year !== undefined) attrs["year"] = year;
  const month = presentString(unwrap(item["supplements_month"]));
  if (month !== undefined) attrs["month"] = month;
  return new Wrapper(attrs);
}

/** The cen wrapper shapes: the slash run folds into the standalone
 * wrapper chain, the plus run into the consolidated bundle. */
function wrapSupplements(base: CenPfsIdentifier, flat: Record<string, unknown>): CenPfsIdentifier {
  const rows = Array.isArray(flat["supplements"])
    ? flat["supplements"]
    : present(flat["supplements"])
      ? [flat["supplements"]]
      : [];
  if (rows.length === 0) return base;
  const items = rows.map(supplementItemOf);
  if (items.some((item) => item["supplements_plus"] !== undefined && item["supplements_plus"] !== null)) {
    const members = items.map((item) => supplementFrom(item));
    return new CenPfsConsolidatedIdentifier({
      identifiers: [base, ...members],
    });
  }
  return supplementFrom(items[0]!, base);
}

function wrapFragment(identifier: CenPfsIdentifier, flat: Record<string, unknown>): CenPfsIdentifier {
  const fragNumber = strOf(unwrap(flat["fragment_number"]));
  if (fragNumber === undefined || fragNumber === "") return identifier;
  return new CenPfsFragment({ number: fragNumber, base: identifier });
}

export function buildCenPfsIdentifier(flat: Record<string, unknown>): CenPfsIdentifier {
  return wrapFragment(wrapSupplements(buildBaseDocument(flat), flat), flat);
}

/**
 * The artifact's declared bindings carry the parsed faces: the flat
 * columns land on the model fields, the stage capture folds onto the
 * typed stage (the definition's stage map), the supplement run folds
 * into the synthesized wrapper chain (standalone) or the consolidated
 * bundle (plus), and the adopted run dispatches through the hook — the
 * same fold the Ruby builder performs.
 */
let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function cenPfsGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("cen_pfs");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed("cen_pfs: the artifact rejected the input", 0);
      }
      return buildCenPfsIdentifier(bound as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
