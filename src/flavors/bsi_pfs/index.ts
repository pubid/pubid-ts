import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { resolveType } from "../../model/identifier.js";
import { extendAttributes, keyValue, type FieldMapping } from "../../model/attribute.js";
import { PubidDate, Publisher } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { grammarImplementation } from "../index.js";
import { TYPED_STAGES_REGISTRY, type BsiTypedStage } from "../bsi/model.js";

/**
 * The PFS-compiled bsi flavor (pubid/pubid#706 §4; the module-composition
 * proof flavor, ported here per pubid-ts#227) — one definition file, both
 * engines: the grammar runtime is the SAME baked artifact the Ruby flavor
 * runs (pubid-grammar artifacts/bsi_pfs.json, compiled from
 * definitions/bsi.pfs by the compiler with the bsi-absorption features),
 * loaded through the artifact runtime, so grammar changes land once and
 * this side cannot drift. The composition is the module library
 * (national.prefix + en.overlay over the iso/iec inners): the plain BS
 * face, the adoption wrappers with the uniform `base` slot (the adopted
 * string parses with the OWNING flavor — EN/CEN/CLC/HD/ENV/ES/CR/CWA
 * leads through the coded cen_cenelec implementation, ISO through iso,
 * IEC/CISPR through iec; an unknown lead or a rejected run is a
 * REJECTION, never a silently empty wrapper), the glued adopted edition
 * face lifted before the delegation, the typed trio
 * (PAS/PD/DD/TS designations: type/stage/typed_stage from the declared
 * registry rows, the ":stage.published" URN segment included), and the
 * marker-less consolidated bundle (each member amends THE bundle's base).
 * Nothing is hand-rolled serialization: the model is declared attributes
 * on the unified model, the trio rides the compactHash hook exactly as
 * the coded {@linkcode import("../bsi/model.js").BsiIdentifier} emits it,
 * and the render body is the definition's canonical template.
 *
 * THE LEDGER IS THE CONTRACT: the bsi corpus rows outside this
 * composition surface (657 of 1,500 — aerospace, Flex, committee
 * documents, index/method/section/test suffixes, addenda/supplements,
 * national annexes, Expert commentary, bundles, sets, standalone AMD,
 * value-added wrappers, DISC escalation prefix, plus four declared
 * shapes) stay REJECTED with a parse failure, never a wrong class —
 * fail-closed exactly as the gem's spec/pubid/bsi_pfs/parity_spec.rb
 * pins them. The parity gate (test/bsi-pfs-parity.test.ts) pins
 * byte-identity with the coded BSI flavor over the absorbed 843-row
 * inventory and the same rejection over every unabsorbed row.
 */

/** Ruby truthiness for a captured face: an absent capture is absent. */
function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function strOf(value: unknown): string | undefined {
  if (!present(value)) return undefined;
  return String(value);
}

/** A raw capture leaf ({value, line, …}) yields its value; a bound scalar
 *  passes through (the run's internal captures bind only through the item
 *  row, so unbound ones arrive as raw leaves). */
function unwrap(capture: unknown): unknown {
  if (typeof capture === "object" && capture !== null && "value" in capture) {
    return (capture as Record<string, unknown>)["value"];
  }
  return capture;
}

/** The builder's present_string: a capture the grammar bound as an
 *  empty string stores as nil (to_hash drops the empty string, so
 *  from_hash would give nil and the two identifiers would not be ==). */
function presentString(value: unknown): string | undefined {
  const s = strOf(value);
  return s === undefined || s === "" ? undefined : s;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The deep terminal of the parent chain (the codec's root-first walk):
 *  a consolidated bundle roots at its first member, a wrapper at its
 *  base — and the nested coded identifiers carry their own parent
 *  columns (the CEN adoption wrapper holds the foreign document under
 *  `adopted`), so the walk follows both keys. */
function deepRoot(node: unknown, seen = 0): unknown {
  if (seen > 6 || !isRecord(node)) return node;
  const members = node["identifiers"];
  if (Array.isArray(members) && members.length > 0 && isRecord(members[0])) {
    return deepRoot(members[0], seen + 1);
  }
  for (const key of ["base", "adopted"]) {
    const next = node[key];
    if (isRecord(next)) return deepRoot(next, seen + 1);
  }
  return node;
}

/**
 * The compiled flavor's identifier base: the shared render machinery and
 * the FLAVOR-LOCAL type dispatch. The concrete classes carry the
 * scheme's canonical wire tags (pubid:bsi:…), which deliberately stay
 * OUT of the global type map — one scheme, one `_type`, one global
 * resolution (the coded class); {@linkcode fromHash} routes the tags
 * back here flavor-locally first (mirroring Ruby's flavor-base
 * polymorphic_type_map order), then falls through to the global registry
 * for the cross-flavor nested identifiers (the adopted CEN/ISO/IEC
 * document), exactly the TypeResolver order.
 */
export abstract class BsiPfsIdentifier extends BaseIdentifier {
  /** The wire tags the compiled classes answer, resolved flavor-locally. */
  static localTypeMap = new Map<string, new (attrs?: Record<string, unknown>) => BsiPfsIdentifier>();

  declare readonly publisher: Publisher | undefined;
  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly edition: string | undefined;
  declare readonly type: string | undefined;
  declare readonly typedStage: BsiTypedStage | undefined;
  declare readonly base: BaseIdentifier | undefined;

  /** The alias's own from_hash: the scheme tags route HERE, the
   *  cross-flavor tags (a nested adopted document) fall through to the
   *  global registry, while nothing reaches the coded classes by way of
   *  the compiled alias (coexistence, not cutover). */
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

  /** The root-through walk the official URN and the identity reads use:
   *  the adoption wrapper carries no identity of its own, so its
   *  identity attributes read the ROOT document's. */
  root(): BsiPfsIdentifier {
    const terminal = deepRoot(this);
    return isRecord(terminal) && terminal instanceof BsiPfsIdentifier
      ? (terminal as BsiPfsIdentifier)
      : this;
  }

  /** An identity attribute of this identifier, or of the document it
   *  wraps (the declared root-through): #root is +self+ for a
   *  non-wrapper, so an ordinary identifier reads its own value and
   *  nothing changes. */
  identity(attr: string): unknown {
    const own = (this as unknown as Record<string, unknown>)[attr];
    if (own !== undefined && own !== null) return own;
    const root = deepRoot(this);
    return root === this ? undefined : (root as Record<string, unknown>)[attr];
  }

  /** The definition's canonical face: `<publisher> <adopted>[ ED<n>]` or
   *  `<publisher> <number>[-<part>][:<year>]`, then the supplement run
   *  (the standalone slash chain / the consolidated plus run) — every
   *  optional renders only what the input carried, and a designation
   *  token prints where the face names the publisher. */
  render(): string {
    let root: BsiPfsIdentifier = this;
    let run = "";
    let members: BsiPfsIdentifier[] | undefined;
    if (root instanceof BsiPfsConsolidatedIdentifier) {
      const [base, ...consolidated] = root.identifiers;
      members = consolidated;
      root = base ?? root;
    }
    while (root instanceof BsiPfsSupplement) {
      run = `/${root.supplementNotation()}${run}`;
      root = root.base ?? root;
    }
    if (members !== undefined) {
      for (const member of members) {
        run += `+${(member as BsiPfsSupplement).supplementNotation()}`;
      }
    }
    const designation = root.type !== undefined && DESIGNATION_FACES.has(root.type);
    const publisher = designation
      ? root.type
      : root.publisher !== undefined
        ? root.publisher.body
        : undefined;
    const adopted = adoptedView(root);
    const year = root.date?.year;
    let head = "";
    if (publisher !== undefined && adopted !== undefined) {
      head = `${publisher} ${adopted}`;
    } else if (publisher !== undefined && present(root.number)) {
      head =
        `${publisher} ${root.number}` +
        `${present(root.part) ? `-${root.part}` : ""}` +
        `${present(year) ? `:${year}` : ""}`;
    }
    return head + run;
  }
}

/** The adoption face: the adopted document, with the wrapper's own
 *  edition face after it (the declared glued ED form — the hook lifts
 *  the ordinal onto the wrapper). */
function adoptedView(root: BsiPfsIdentifier): string | undefined {
  const adopted = (root as unknown as Record<string, unknown>)["base"];
  if (!(adopted instanceof BaseIdentifier)) return undefined;
  const edition = (root as unknown as Record<string, unknown>)["edition"];
  const adoptedStr = adopted.toString();
  return present(edition) ? `${adoptedStr} ED${edition}` : adoptedStr;
}

/** The designation faces (the typed trio): the token that selected the
 *  class prints where the face names the publisher. */
const DESIGNATION_FACES = new Set(["PAS", "PD", "DD", "TS"]);

/** The typed trio the designation rows carry (the wire keys the coded
 *  flavor serializes): type {name, abbr, type_code}, stage {name,
 *  stage_code, harmonized_stages, abbr}, typed_stage {name, code,
 *  type_code, stage_code, abbr, harmonized_stages} — the same nested
 *  blocks the coded {@linkcode BsiIdentifier} compactHash emits. */
function emitTypedTrio(model: BsiPfsIdentifier, hash: Record<string, unknown>): void {
  const ts = model.typedStage;
  if (ts === undefined) return;
  hash["type"] = { name: ts.name, abbr: ts.abbr[0], type_code: ts.typeCode };
  hash["stage"] = {
    name: ts.name,
    stage_code: ts.stageCode,
    harmonized_stages: ts.harmonizedStages,
    abbr: ts.abbr[0],
  };
  hash["typed_stage"] = {
    name: ts.name,
    code: ts.code,
    type_code: ts.typeCode,
    stage_code: ts.stageCode,
    abbr: ts.abbr,
    harmonized_stages: ts.harmonizedStages,
  };
}

/**
 * The official URN: urn:bsi[:<publisher>][:<number>][:‑<part>][:-<subpart>]
 * [:<year>][:v<edition>][:<type abbr unless BS>][:stage.<code>]. A
 * wrapper reads through to its subject for the identity columns (the
 * publisher and the edition stay the wrapper's own), a supplement
 * wrapper prepends its declared chain (:amd:/:cor:), and the
 * marker-less bundle appends each member's chain directly (the
 * coded-BSI shape).
 */
class BsiPfsUrnGenerator extends BaseUrnGenerator<BsiPfsIdentifier> {
  generate(): string {
    let id: BsiPfsIdentifier = this.identifier;
    const wrapper: string[] = [];
    let members: BsiPfsIdentifier[] | undefined;
    if (id instanceof BsiPfsConsolidatedIdentifier) {
      const [base, ...consolidated] = id.identifiers;
      members = consolidated;
      id = base ?? id;
    }
    while (id instanceof BsiPfsSupplement) {
      wrapper.unshift(...wrapperSegments(id));
      id = id.base as BsiPfsIdentifier ?? id;
    }
    const parts = ["urn", "bsi", ...officialSegments(id), ...wrapper];
    if (members !== undefined) {
      for (const member of members) {
        parts.push(...wrapperSegments(member as BsiPfsSupplement));
      }
    }
    return parts.join(":");
  }
}

/** The fused official segments: the wrapper's own publisher, the
 *  root-through identity columns, the wrapper's own glued edition face,
 *  the designation type abbr (the BS token never fires), and the typed
 *  trio's own stage segment (it fires for published rows too — the
 *  coded generator's own comparison: a stage_code String is never the
 *  :published Symbol, so a set typed stage always segments). */
function officialSegments(id: BsiPfsIdentifier): string[] {
  const segments: string[] = [];
  if (id.publisher !== undefined) segments.push(id.publisher.render("urn")!);
  const number = id.identity("number");
  if (present(number)) segments.push(String(number));
  const part = id.identity("part");
  if (present(part)) segments.push(`-${part}`);
  const subpart = id.identity("subpart");
  if (present(subpart)) segments.push(`-${subpart}`);
  const year = (id.identity("date") as PubidDate | undefined)?.year;
  if (present(year)) segments.push(String(year));
  if (present(id.edition)) segments.push(`v${id.edition}`);
  if (id.type !== undefined && id.type !== "BS") {
    segments.push(id.type.toLowerCase());
  }
  const code = id.typedStage?.stageCode;
  if (code !== undefined) segments.push(`stage.${code}`);
  return segments;
}

/** One wrapper's declared URN chain: the kind word, then the wrapper's
 *  columns (the ordinal, the year). */
function wrapperSegments(id: BsiPfsSupplement): string[] {
  let segments: unknown[];
  if (id instanceof BsiPfsAmendment) {
    segments = ["amd", id.number, id.year];
  } else if (id instanceof BsiPfsCorrigendum) {
    segments = ["cor", id.number, id.year];
  } else {
    segments = [];
  }
  return segments.map((s) => String(s ?? "")).filter((s) => s !== "");
}

// --- the compiled class family -------------------------------------------------

interface DocumentSpec {
  /** The scheme-canonical wire tag (declared in the definition). */
  tag: string;
  /** The adoption wrappers (AEN, AIS) carry the nested foreign document
   *  under the uniform `base` slot and the glued edition face. */
  adopted?: boolean;
}

/** A declared document family: the columns the compiled builder casts,
 *  the class defaults, and the whitelist that keeps the wire flat (the
 *  `type`/`typedStage` slots never serialize raw — the trio rides the
 *  compactHash hook, exactly the coded flavor's wire). */
function documentClass(spec: DocumentSpec): (new (attrs?: Record<string, unknown>) => BsiPfsIdentifier) & IdentifierStatic {
  abstract class BsiPfsDocument extends BsiPfsIdentifier {
    static get polymorphicName(): string {
      return spec.tag;
    }
    static get attributes() {
      return extendAttributes(BaseIdentifier, {
        publisher: { type: Publisher, default: new Publisher({ body: "BS" }) },
        number: { type: "string" },
        part: { type: "string" },
        date: { type: PubidDate },
        ...(spec.adopted
          ? {
              edition: { type: "string" },
              // The nested foreign document: a complete cross-flavor
              // instance passes through untouched; a wire hash rebuilds
              // through the alias's TypeResolver order (flavor map,
              // then the global registry).
              base: { type: BsiPfsIdentifier as unknown as IdentifierStatic },
            }
          : {}),
        type: { type: "string" },
        typedStage: { type: "string" },
      });
    }
    static get mappings(): FieldMapping[] {
      return keyValue(
        { wire: "publisher", to: "publisher" },
        { wire: "number", to: "number" },
        { wire: "part", to: "part" },
        { wire: "date", to: "date" },
        ...(spec.adopted
          ? [
              { wire: "edition", to: "edition" },
              { wire: "base", to: "base" },
            ] as FieldMapping[]
          : []),
        {
          // The typed trio's wire keys ride compactHash (the coded
          // flavor's hook); from the wire they rebuild the registry row.
          wire: "typed_stage",
          to: "typedStage",
          fromWire: (h) => {
            const trio = h["typed_stage"];
            if (trio === undefined || trio === null || typeof trio !== "object") return undefined;
            const code = (trio as Record<string, unknown>)["code"];
            return TYPED_STAGES_REGISTRY.find((t) => t.code === code);
          },
          toWire: () => undefined,
        },
        {
          wire: "type",
          to: "type",
          fromWire: (h) => {
            const trio = h["type"];
            if (trio === undefined || trio === null || typeof trio !== "object") return undefined;
            const typeCode = (trio as Record<string, unknown>)["type_code"];
            return TYPED_STAGES_REGISTRY.find((t) => t.typeCode === typeCode)?.abbr[0];
          },
          toWire: () => undefined,
        },
      );
    }
    static compactHash = (model: BaseIdentifier, hash: Record<string, unknown>): void => {
      emitTypedTrio(model as BsiPfsIdentifier, hash);
    };
    static urnGenerator = BsiPfsUrnGenerator;

    constructor(attrs: Record<string, unknown> = {}) {
      super(attrs);
      const self = this as unknown as Record<string, unknown>;
      if (self["publisher"] === undefined) self["publisher"] = new Publisher({ body: "BS" });
    }
  }
  return BsiPfsDocument as unknown as (new (
    attrs?: Record<string, unknown>,
  ) => BsiPfsIdentifier) & IdentifierStatic;
}

/** The default class (the token-free face) and the four designation
 *  tokens' classes (feature 1): the token selects the class, the
 *  designation IS the publisher, and the class default publisher is BS
 *  for every family. */
export const BsiPfsBritishStandard = documentClass({ tag: "pubid:bsi:british-standard" });
export const BsiPfsPubliclyAvailableSpecification = documentClass({
  tag: "pubid:bsi:publicly-available-specification",
});
export const BsiPfsPublishedDocument = documentClass({ tag: "pubid:bsi:published-document" });
export const BsiPfsDraftDocument = documentClass({ tag: "pubid:bsi:draft-document" });
export const BsiPfsTechnicalSpecification = documentClass({ tag: "pubid:bsi:technical-specification" });
export const BsiPfsAdoptedEuropeanNorm = documentClass({
  tag: "pubid:bsi:adopted-european-norm",
  adopted: true,
});
export const BsiPfsAdoptedInternationalStandard = documentClass({
  tag: "pubid:bsi:adopted-international-standard",
  adopted: true,
});

/** The supplement wrapper base: the wrapper owns its ordinal and the
 *  base identifier; every rendered face reads through. */
abstract class BsiPfsSupplement extends BsiPfsIdentifier {
  static get attributes() {
    return extendAttributes(BaseIdentifier, {
      base: { type: BsiPfsIdentifier as unknown as IdentifierStatic },
      number: { type: "string" },
      year: { type: "string" },
    });
  }
  static get mappings(): FieldMapping[] {
    return keyValue(
      { wire: "base", to: "base" },
      { wire: "number", to: "number" },
      { wire: "year", to: "year" },
    );
  }
  static urnGenerator = BsiPfsUrnGenerator;

  declare readonly base: BsiPfsIdentifier | undefined;
  declare readonly year: string | undefined;

  /** The printed notation: the kind face, the ordinal (absent for an
   *  unnumbered corrigendum) and the declared date tail. The bare
   *  notation; the render's walkers add the standalone slash and the
   *  consolidated plus themselves. */
  supplementNotation(): string {
    return (
      (this.constructor as unknown as { FACE: string }).FACE +
      (this.number ?? "") +
      (present(this.year) ? `:${this.year}` : "")
    );
  }
}

export class BsiPfsAmendment extends BsiPfsSupplement {
  /** The kind face "A" is the run's dispatch token and the notation
   *  face. */
  static get polymorphicName(): string {
    return "pubid:bsi:amendment";
  }
  static FACE = "A";
}
export class BsiPfsCorrigendum extends BsiPfsSupplement {
  /** The kind face "C" is the run's dispatch token and the notation
   *  face. */
  static get polymorphicName(): string {
    return "pubid:bsi:corrigendum";
  }
  static FACE = "C";
}

/** The consolidated (plus-run) bundle: the base document is the first
 *  member; each member amends it, so the members carry it as their base
 *  (the coded builder's shape). The wrapper reads the base document's
 *  identity and drops the member suffixes. */
export class BsiPfsConsolidatedIdentifier extends BsiPfsIdentifier {
  static get polymorphicName(): string {
    return "pubid:bsi:consolidated-identifier";
  }
  static get attributes() {
    return extendAttributes(BaseIdentifier, {
      identifiers: {
        type: BsiPfsIdentifier as unknown as IdentifierStatic,
        collection: true,
      },
    });
  }
  static get mappings(): FieldMapping[] {
    return keyValue({ wire: "identifiers", to: "identifiers" });
  }
  /** The declared marker-less bundle (the coded-BSI compact-hash rule):
   *  the delegated publisher leaves the wrapper's own wire entry, and
   *  the wrapper reads the base document's designation — the first
   *  member's typed trio supplies the bundle-level type block (the
   *  stage/typed_stage blocks stay the members'). */
  static compactHash = (model: BaseIdentifier, hash: Record<string, unknown>): void => {
    delete hash["publisher"];
    const first = (model as BsiPfsConsolidatedIdentifier).identifiers?.[0];
    const ts = first?.typedStage;
    if (ts !== undefined) {
      hash["type"] = { name: ts.name, abbr: ts.abbr[0], type_code: ts.typeCode };
    }
  };
  static urnGenerator = BsiPfsUrnGenerator;

  declare readonly identifiers: BsiPfsIdentifier[];

  /** The origin document: members live in `identifiers`, so the walk
   *  starts at the first member. */
  root(): BsiPfsIdentifier {
    const first = this.identifiers[0];
    return first !== undefined ? first.root() : this;
  }
}

for (const klass of [
  BsiPfsBritishStandard,
  BsiPfsPubliclyAvailableSpecification,
  BsiPfsPublishedDocument,
  BsiPfsDraftDocument,
  BsiPfsTechnicalSpecification,
  BsiPfsAdoptedEuropeanNorm,
  BsiPfsAdoptedInternationalStandard,
  BsiPfsAmendment,
  BsiPfsCorrigendum,
  BsiPfsConsolidatedIdentifier,
]) {
  BsiPfsIdentifier.localTypeMap.set(klass.polymorphicName, klass);
}

// --- the builder (the generated builder's shape) -------------------------------

/** The designation registry rows by their token (the builder's
 *  DESIGNATION_STAGES): the token that selected the class is the
 *  designation face, not a publisher — the identifier carries the
 *  stage entry's type/typed stage (the coded builder's cast). */
const DESIGNATION_STAGES = new Map<string, BsiTypedStage>(
  (
    [
      ["PAS", "pas"],
      ["PD", "pd"],
      ["DD", "dd"],
      ["TS", "ts"],
    ] as const
  )
    .map(([token, typeCode]) => [token, TYPED_STAGES_REGISTRY.find((t) => t.typeCode === typeCode)!] as const)
    .filter(([, row]) => row !== undefined),
);

/** The type each declared token selects (feature 1); the token-free
 *  type is the default class. */
const TYPE_TOKENS: Record<string, new (attrs?: Record<string, unknown>) => BsiPfsIdentifier> = {
  PAS: BsiPfsPubliclyAvailableSpecification,
  PD: BsiPfsPublishedDocument,
  DD: BsiPfsDraftDocument,
  TS: BsiPfsTechnicalSpecification,
};

/** The columns, as the compiled builder's cast writes them: the date
 *  carries the captured year, a designation token selects the class and
 *  carries the trio row but is not a publisher. */
function assignAttributes(flat: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const year = strOf(unwrap(flat["year"]));
  if (year !== undefined) attrs["date"] = new PubidDate({ year });
  const number = strOf(unwrap(flat["number"]));
  if (number !== undefined) attrs["number"] = number;
  const part = strOf(unwrap(flat["part"]));
  if (part !== undefined) attrs["part"] = part;
  const publisher = strOf(unwrap(flat["publisher"]));
  if (publisher !== undefined && !DESIGNATION_STAGES.has(publisher)) {
    attrs["publisher"] = new Publisher({ body: publisher });
  }
  const row = publisher !== undefined ? DESIGNATION_STAGES.get(publisher) : undefined;
  if (row !== undefined) {
    attrs["typedStage"] = row;
    attrs["type"] = row.abbr[0];
  }
  return attrs;
}

/** The class each reference selects: the publisher-position token (the
 *  designation faces), else the token-free default class. The bsi
 *  grammar declares no guide/type position, so the token scan is the
 *  publisher column only. */
function locateIdentifierKlass(flat: Record<string, unknown>): new (attrs?: Record<string, unknown>) => BsiPfsIdentifier {
  const publisher = strOf(unwrap(flat["publisher"]));
  const selected = publisher !== undefined ? TYPE_TOKENS[publisher] : undefined;
  return selected ?? BsiPfsBritishStandard;
}

/** The en.overlay routing: the lead token names the owning flavor — EN,
 *  CEN, CLC, HD, ENV, ES, CR and CWA leads through the coded cen_cenelec
 *  implementation (the cen inner), ISO through iso (iso.inner), IEC and
 *  CISPR through iec (iec.inner). An unknown lead is a rejection citing
 *  the run; a run the owning flavor rejects propagates THAT flavor's
 *  parse failure (the honest attribution). */
function parseAdopted(adoptedStr: string): BaseIdentifier {
  const lead = adoptedStr.split(/\s|\//, 2)[0] ?? "";
  const flavor = CEN_LEADS.has(lead)
    ? "cen_cenelec"
    : lead === "ISO"
      ? "iso"
      : IEC_LEADS.has(lead)
        ? "iec"
        : undefined;
  if (flavor === undefined) {
    throw new ParseFailed(
      `bsi_pfs: no owning flavor parses the run ${JSON.stringify(adoptedStr)}`,
      0,
    );
  }
  const impl = grammarImplementation(flavor);
  if (impl === undefined) {
    throw new ParseFailed(`bsi_pfs: the ${flavor} implementation is unavailable`, 0);
  }
  return impl.parse(adoptedStr) as unknown as BaseIdentifier;
}

const CEN_LEADS = new Set(["EN", "CEN", "CLC", "HD", "ENV", "ES", "CR", "CWA"]);
const IEC_LEADS = new Set(["IEC", "CISPR"]);
const ADOPTED_EDITION_FACE = "ED";

/** The declared glued edition face, lifted from the run's tail ("BS HD
 *  IEC 60364-8-81 ED1" — the ordinal glues to the face, there is no
 *  edition space): the owning flavor drops it, the wrapper column
 *  carries it. Returns the cleaned run and the ordinal; a run with no
 *  face passes through untouched. */
function extractEdition(adoptedStr: string): [string, string | undefined] {
  const match = /\s+ED(\d+)\s*$/.exec(adoptedStr);
  if (match === null) return [adoptedStr, undefined];
  return [adoptedStr.replace(/\s+ED(\d+)\s*$/, ""), match[1]!];
}

/** The wrapper class by what the owning flavor came back with: a CEN
 *  identifier (including a CEN adoption of an ISO/IEC document) is the
 *  adopted European norm; an ISO/IEC identifier is the adopted
 *  international standard. */
function wrapperClassOf(adoptedId: BaseIdentifier): "aen" | "ais" {
  const tag = (adoptedId.constructor as unknown as { polymorphicName?: string }).polymorphicName;
  return typeof tag === "string" && tag.startsWith("pubid:cencenelec:") ? "aen" : "ais";
}

/** The adopted-base dispatch (the §4 coded escape hatch): the wrapper's
 *  attributes are the adopted document under the uniform `base` slot,
 *  the captured head token as the publisher, and the lifted edition
 *  face when the run carried one. BSI carries no implicit adoption
 *  probe — the coded builder's adoptions are all printed. */
function adoptedBuild(flat: Record<string, unknown>): BsiPfsIdentifier {
  const adoptedStr = strOf(unwrap(flat["adopted"]))?.trim();
  if (adoptedStr === undefined || adoptedStr === "") {
    throw new ParseFailed("bsi_pfs: an adopted run captured no document", 0);
  }
  const [run, edition] = extractEdition(adoptedStr);
  const adoptedId = parseAdopted(run);
  const attrs: Record<string, unknown> = { base: adoptedId };
  const publisher = strOf(unwrap(flat["publisher"]));
  if (publisher !== undefined) attrs["publisher"] = new Publisher({ body: publisher });
  if (edition !== undefined) attrs["edition"] = edition;
  return wrapperClassOf(adoptedId) === "aen"
    ? new BsiPfsAdoptedEuropeanNorm(attrs)
    : new BsiPfsAdoptedInternationalStandard(attrs);
}

function buildBaseDocument(flat: Record<string, unknown>): BsiPfsIdentifier {
  if (present(flat["adopted"])) return adoptedBuild(flat);
  return new (locateIdentifierKlass(flat))(assignAttributes(flat));
}

/** The run's internal captures bind only through the item row, so the
 *  raw supplement item arrives as the capture map itself (or, on a
 *  doubly-nested row, as the inner map's first value — the compiled
 *  builder's own unwrap). */
function supplementItemOf(row: unknown): Record<string, unknown> {
  const inner = isRecord(row) ? row["supplement"] : undefined;
  if (!isRecord(inner)) return {};
  const values = Object.values(inner);
  // A row of capture leaves ({value, …}) IS the item; a row whose every
  // value is a nested group descends into its first group (the compiled
  // builder's own unwrap — the Slice/Hash discrimination on the Ruby
  // side, where a leaf capture never arrives as a plain group hash).
  if (values.length > 0 && values.every((v) => isRecord(v) && !("value" in v))) {
    return values[0] as Record<string, unknown>;
  }
  return inner;
}

/** The wrapper classes by kind face: the run's dispatch. */
function supplementFrom(item: Record<string, unknown>, base?: BsiPfsIdentifier): BsiPfsIdentifier {
  const kind = strOf(unwrap(item["supplement_kind"])) ?? "";
  const Wrapper =
    kind === BsiPfsAmendment.FACE
      ? BsiPfsAmendment
      : kind === BsiPfsCorrigendum.FACE
        ? BsiPfsCorrigendum
        : undefined;
  if (Wrapper === undefined) {
    throw new ParseFailed(`BSI: unknown supplement kind ${kind}`, 0);
  }
  const attrs: Record<string, unknown> = {};
  if (base !== undefined) attrs["base"] = base;
  const number = presentString(unwrap(item["supplement_number"]));
  if (number !== undefined) attrs["number"] = number;
  const year = presentString(unwrap(item["supplements_year"]));
  if (year !== undefined) attrs["year"] = year;
  return new Wrapper(attrs);
}

/** The declared wrapper shapes: the slash run folds into the standalone
 *  wrapper chain, the plus run into the marker-less consolidated bundle
 *  whose members each carry the bundle's base document. */
function wrapSupplements(base: BsiPfsIdentifier, flat: Record<string, unknown>): BsiPfsIdentifier {
  const rows = Array.isArray(flat["supplements"])
    ? flat["supplements"]
    : present(flat["supplements"])
      ? [flat["supplements"]]
      : [];
  if (rows.length === 0) return base;
  const items = rows.map(supplementItemOf);
  if (items.some((item) => present(item["supplements_plus"]))) {
    const members = items.map((item) => supplementFrom(item, base));
    return new BsiPfsConsolidatedIdentifier({ identifiers: [base, ...members] });
  }
  return supplementFrom(items[0]!, base);
}

export function buildBsiPfsIdentifier(flat: Record<string, unknown>): BsiPfsIdentifier {
  return wrapSupplements(buildBaseDocument(flat), flat);
}

/**
 * The artifact's declared bindings carry the parsed faces: the flat
 * columns land on the model fields, the adopted run dispatches through
 * the hook (the same fold the Ruby builder performs), and the
 * supplement run folds into the synthesized wrapper chain (standalone)
 * or the consolidated bundle (plus).
 */
let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function bsiPfsGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("bsi_pfs");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed("bsi_pfs: the artifact rejected the input", 0);
      }
      return buildBsiPfsIdentifier(bound as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
