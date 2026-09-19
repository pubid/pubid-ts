import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue, type AttributeTable, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/ieee: Components::Code/Draft/TypedStage, the
 * Identifiers::* family, Renderer, UrnGenerator and Compaction.
 *
 * Wire: the split code columns (number/prefix/parts/separator) on
 * CodeNumber leaves; typed_stage compacted to a `stage` scalar when the
 * registry rebuilds it byte-identically (else the full object, fails
 * closed); the draft serializes as its rendered string minus the "/".
 */

// --- Components --------------------------------------------------------------

export interface TypedStageRecord {
  abbr: string[];
  stage_code: string;
  type_code: string;
  iso_stage_equivalent?: string;
  ieee_draft_equivalent?: string;
  approval_status?: string;
  project_status?: boolean;
}

export const TYPED_STAGES: TypedStageRecord[] = [
  { abbr: ["Std"], stage_code: "published", type_code: "standard" },
  { abbr: ["D1"], stage_code: "working_draft", type_code: "draft", ieee_draft_equivalent: "D1", iso_stage_equivalent: "WD", approval_status: "unapproved", project_status: true },
  { abbr: ["D2", "D3"], stage_code: "committee_draft", type_code: "draft", ieee_draft_equivalent: "D2-D3", iso_stage_equivalent: "CD", approval_status: "unapproved", project_status: true },
  { abbr: ["D4", "D5", "D6"], stage_code: "draft_standard", type_code: "draft", ieee_draft_equivalent: "D4-D6", iso_stage_equivalent: "DIS", approval_status: "unapproved", project_status: true },
  { abbr: ["D7", "D8", "D9"], stage_code: "final_draft", type_code: "draft", ieee_draft_equivalent: "D7-D9", iso_stage_equivalent: "FDIS", approval_status: "approved", project_status: true },
  { abbr: ["PWI"], stage_code: "preliminary", type_code: "draft", ieee_draft_equivalent: "P", iso_stage_equivalent: "PWI", approval_status: "unapproved", project_status: true },
  { abbr: ["NP"], stage_code: "new_proposal", type_code: "draft", ieee_draft_equivalent: "P", iso_stage_equivalent: "NP", approval_status: "unapproved", project_status: true },
  { abbr: ["WD"], stage_code: "working_draft", type_code: "draft", ieee_draft_equivalent: "D1", iso_stage_equivalent: "WD", approval_status: "unapproved", project_status: true },
  { abbr: ["CD", "CD1", "CD2", "CD3", "CD4"], stage_code: "committee_draft", type_code: "draft", ieee_draft_equivalent: "D2-D3", iso_stage_equivalent: "CD", approval_status: "unapproved", project_status: true },
  { abbr: ["CDV"], stage_code: "committee_draft_for_vote", type_code: "draft", ieee_draft_equivalent: "D2-D3", iso_stage_equivalent: "CDV", approval_status: "unapproved", project_status: true },
  { abbr: ["DIS"], stage_code: "draft_international_standard", type_code: "draft", ieee_draft_equivalent: "D5", iso_stage_equivalent: "DIS", approval_status: "unapproved", project_status: true },
  { abbr: ["FDIS"], stage_code: "final_draft", type_code: "draft", ieee_draft_equivalent: "D8", iso_stage_equivalent: "FDIS", approval_status: "approved", project_status: true },
  { abbr: ["No", "No."], stage_code: "published", type_code: "standard" },
  { abbr: ["P"], stage_code: "draft", type_code: "draft", ieee_draft_equivalent: "P", approval_status: "unapproved", project_status: true },
  { abbr: ["Draft"], stage_code: "draft", type_code: "draft", approval_status: "unapproved", project_status: true },
];

const entrySubHash = (ts: TypedStageRecord): Record<string, unknown> => {
  const out: Record<string, unknown> = { abbr: ts.abbr, stage_code: ts.stage_code, type_code: ts.type_code };
  if (ts.iso_stage_equivalent !== undefined) out["iso_stage_equivalent"] = ts.iso_stage_equivalent;
  if (ts.ieee_draft_equivalent !== undefined) out["ieee_draft_equivalent"] = ts.ieee_draft_equivalent;
  if (ts.approval_status !== undefined) out["approval_status"] = ts.approval_status;
  if (ts.project_status) out["project_status"] = ts.project_status;
  return out;
};

const SUB_HASH_FOR = new Map<string, Record<string, unknown>>(
  TYPED_STAGES.map((ts) => [ts.abbr[0]!, entrySubHash(ts)]),
);

export function locateStage(abbr: string): TypedStageRecord | undefined {
  const up = abbr.toUpperCase();
  return TYPED_STAGES.find((ts) => ts.abbr.some((a) => a.toUpperCase() === up));
}

export class IeeeTypedStage {
  readonly record: TypedStageRecord;
  constructor(record: TypedStageRecord) {
    this.record = record;
  }
  get abbr(): string[] {
    return this.record.abbr;
  }
  get projectStatus(): boolean {
    return this.record.project_status === true;
  }
  get ieeeDraftEquivalent(): string | undefined {
    return this.record.ieee_draft_equivalent;
  }
  get typeCode(): string {
    return this.record.type_code;
  }
  toWire(): Record<string, unknown> {
    return entrySubHash(this.record);
  }
  render(): string {
    return this.record.abbr[0] ?? "";
  }
}

export class IeeeCode {
  readonly prefix: string | undefined;
  readonly number: string;
  readonly parts: string[];
  readonly originalSeparator: string | undefined;

  constructor(attrs: Record<string, unknown>) {
    this.prefix = attrs["prefix"] as string | undefined;
    this.number = String(attrs["number"] ?? "");
    this.parts = Array.isArray(attrs["parts"]) ? (attrs["parts"] as string[]) : [];
    this.originalSeparator = attrs["original_separator"] as string | undefined;
  }

  static parse(codeStr: string): IeeeCode | undefined {
    if (codeStr === "") return undefined;
    const prefixMatch = /^([A-Z])/.exec(codeStr);
    const prefix = prefixMatch !== null ? prefixMatch[1] : undefined;
    const remainder = prefix !== undefined ? codeStr.slice(prefix.length) : codeStr;
    let separator: string | undefined;
    if (remainder.includes(".")) separator = ".";
    else if (remainder.includes("-")) separator = "-";
    const components = remainder.split(/[.-]/);
    const number = components.shift() ?? "";
    return new IeeeCode({
      prefix,
      number,
      parts: components,
      original_separator: separator,
    });
  }

  render(): string {
    let result = "";
    if (this.prefix !== undefined) result += this.prefix;
    result += this.number;
    if (this.parts.length > 0) {
      let separator = this.originalSeparator;
      if (separator === undefined) {
        if (this.prefix === "P" || (this.prefix === undefined && this.parts[0] !== undefined && this.parts[0].length > 3)) {
          separator = "-";
        } else if (this.prefix !== undefined && this.prefix !== "P") {
          separator = ".";
        } else if (this.prefix === undefined && this.number.length >= 5) {
          separator = "-";
        } else {
          separator = ".";
        }
      }
      for (const part of this.parts) result += separator + part;
    }
    return result;
  }
}

const DRAFT_MONTH_NAMES: Record<string, string> = {
  January: "1", February: "2", March: "3", April: "4", May: "5", June: "6",
  July: "7", August: "8", September: "9", October: "10", November: "11",
  December: "12", Jan: "1", Feb: "2", Mar: "3", Apr: "4", Jun: "6",
  Jul: "7", Aug: "8", Sep: "9", Sept: "9", Oct: "10", Nov: "11", Dec: "12",
};

export class IeeeDraft {
  readonly version: string;
  readonly revision: string | undefined;
  readonly year: string | undefined;
  readonly month: string | undefined;
  readonly day: string | undefined;
  readonly originalMonth: string | undefined;
  readonly commaBeforeMonth: boolean;
  /** Distinguishes an explicit `false` from "not recorded" (Ruby's nil). */
  readonly commaBeforeMonthSet: boolean;

  constructor(attrs: Record<string, unknown>) {
    this.commaBeforeMonthSet = "comma_before_month" in attrs;
    this.version = String(attrs["version"] ?? "");
    this.revision = attrs["revision"] as string | undefined;
    this.year = attrs["year"] as string | undefined;
    this.originalMonth = attrs["month"] as string | undefined;
    this.month = attrs["month"] !== undefined
      ? DRAFT_MONTH_NAMES[String(attrs["month"])] ?? String(attrs["month"])
      : undefined;
    this.day = attrs["day"] as string | undefined;
    this.commaBeforeMonth = attrs["comma_before_month"] === true;
  }

  static parse(value: string): IeeeDraft | undefined {
    if (value === "") return undefined;
    let body = value;
    if (body.startsWith("/D")) body = body.slice(2);
    else if (body.startsWith("/")) body = body.slice(1);
    else if (body.startsWith("D") && body.length > 1) body = body.slice(1);

    const monthAlt = Object.keys(DRAFT_MONTH_NAMES)
      .sort((a, b) => b.length - a.length)
      .map((m) => `${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?`)
      .join("|");
    const suffix = new RegExp(
      `(?:(, | )(${monthAlt})(?: (\\d{1,2}))?(?:, | )| )((?:19|20)\\d{2}[a-z]{0,2})$`,
    );
    const m = suffix.exec(body);
    if (m === null) return new IeeeDraft({ version: body });
    return new IeeeDraft({
      version: body.slice(0, m.index),
      month: m[2],
      day: m[3],
      year: m[4],
      comma_before_month: m[1] === ", ",
    });
  }

  render(): string {
    let result = `/D${this.version}`;
    if (this.revision !== undefined) result += `.${this.revision}`;
    if (this.year !== undefined) {
      const displayMonth = this.originalMonth;
      if (displayMonth !== undefined) {
        const useCommaBefore = this.commaBeforeMonthSet
          ? this.commaBeforeMonth
          : displayMonth.length > 4 && displayMonth !== "Sept";
        result += useCommaBefore ? `, ${displayMonth}` : ` ${displayMonth}`;
        if (this.day !== undefined) result += ` ${this.day}`;
        result += displayMonth.length <= 4 || displayMonth === "Sept" ? ` ${this.year}` : `, ${this.year}`;
      } else {
        result += ` ${this.year}`;
      }
    }
    return result;
  }
}

// --- Wire helpers ------------------------------------------------------------

const typedStageWire: FieldMapping = {
  wire: "typed_stage",
  to: "typed_stage",
  toWire: (model) => (model["typed_stage"] instanceof IeeeTypedStage
    ? (model["typed_stage"] as IeeeTypedStage).toWire()
    : undefined),
  fromWire: (hash) => {
    const value = hash["typed_stage"];
    if (value === undefined || typeof value !== "object" || Array.isArray(value)) return undefined;
    const rec = value as Record<string, unknown>;
    const abbr = Array.isArray(rec["abbr"]) ? (rec["abbr"] as unknown[]).map(String) : [];
    const match = TYPED_STAGES.find(
      (ts) => ts.abbr.length === abbr.length && ts.abbr.every((a, i) => a === abbr[i]),
    );
    return match !== undefined ? new IeeeTypedStage(match) : undefined;
  },
};

const draftWire: FieldMapping = {
  wire: "draft",
  to: "draft",
  toWire: (model) => {
    const draft = model["draft"];
    if (typeof draft !== "string" || draft === "") return undefined;
    return draft.startsWith("/") ? draft.slice(1) : draft;
  },
  fromWire: (hash) => {
    const value = hash["draft"];
    if (typeof value !== "string" || value === "") return undefined;
    return IeeeDraft.parse(value)?.render() ?? undefined;
  },
};

const nestedIdWire = (attrName: string): FieldMapping => ({
  wire: attrName,
  to: attrName,
});

export const RELATIONSHIP_PREFIXES: Record<string, string> = {
  revision_of: "Revision of",
  amendment_to: "Amendment to",
  corrigendum_to: "Corrigendum to",
  incorporates: "incorporates",
  adoption_of: "Adoption of",
  supplement_to: "Supplement to",
  draft_amendment_to: "Draft Amendment to",
  draft_revision_of: "Draft Revision of",
  reaffirmation_of: "Reaffirmation of",
  redesignation_of: "Redesignation of",
  supersedes: "Supersedes",
  previously_designated_as: "Previously designated as",
  includes: "Includes",
};

export class IeeeRelationship {
  constructor(
    readonly relationshipType: string,
    readonly relatedIds: { toHuman(): string }[],
    readonly intermediateAmendments: { toHuman(): string }[],
    readonly approvedAmendmentsFlag = false,
  ) {}

  render(): string {
    if (this.relatedIds.length === 0) return "";
    const prefix = RELATIONSHIP_PREFIXES[this.relationshipType] ?? this.relationshipType;
    const ids = this.relatedIds.length === 1
      ? this.relatedIds[0]!.toHuman()
      : this.relatedIds.length === 2
        ? `${this.relatedIds[0]!.toHuman()} and ${this.relatedIds[1]!.toHuman()}`
        : `${this.relatedIds.slice(0, -1).map((i) => i.toHuman()).join(", ")}, and ${this.relatedIds[this.relatedIds.length - 1]!.toHuman()}`;
    return `${prefix} ${ids}`;
  }
}

// --- Compaction (hash transforms on toHash/fromHash) --------------------------

function walkHash(node: unknown, visit: (h: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkHash(item, visit);
    return;
  }
  if (node !== null && typeof node === "object") {
    visit(node as Record<string, unknown>);
    for (const value of Object.values(node as Record<string, unknown>)) {
      walkHash(value, visit);
    }
  }
}

function collapseIeeeHash(node: unknown): void {
  walkHash(node, (h) => {
    const ts = h["typed_stage"];
    if (ts !== null && typeof ts === "object" && !Array.isArray(ts)) {
      const sub = ts as Record<string, unknown>;
      const abbr = Array.isArray(sub["abbr"]) ? (sub["abbr"] as unknown[])[0] : undefined;
      if (typeof abbr === "string") {
        const expected = SUB_HASH_FOR.get(abbr);
        if (
          expected !== undefined &&
          JSON.stringify(canonicalJsonKeyOrder(expected)) === JSON.stringify(canonicalJsonKeyOrder(sub))
        ) {
          delete h["typed_stage"];
          h["stage"] = abbr;
        }
      }
    }
    const draft = h["draft"];
    if (typeof draft === "string" && draft.startsWith("/")) {
      h["draft"] = draft.slice(1);
    }
  });
}

function canonicalJsonKeyOrder(sub: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(sub, Object.keys(sub).sort()));
}

function expandIeeeHash(hash: Record<string, unknown>): Record<string, unknown> {
  const deep = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(deep);
    if (node !== null && typeof node === "object") {
      const src = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) out[k] = deep(v);
      if (typeof out["stage"] === "string") {
        const sub = SUB_HASH_FOR.get(out["stage"] as string);
        if (sub !== undefined) {
          delete out["stage"];
          out["typed_stage"] = { ...sub };
        }
      }
      return out;
    }
    return node;
  };
  return deep(hash) as Record<string, unknown>;
}

// --- The identifier base -----------------------------------------------------

export abstract class IeeeIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: "string", default: "IEEE" },
    copublisher: { type: "string", collection: true, default: [] as string[] },
    year: { type: "string" },
    type: { type: "string", default: "Std" },
    draft_status: { type: "string" },
    draft: { type: "string" },
    revision: { type: "string" },
    edition: { type: "string" },
    month: { type: "string" },
    day: { type: "string" },
    redline: { type: "boolean", default: false },
    edition_month: { type: "string" },
    space_before_draft: { type: "boolean", default: false },
    typed_stage: { type: IeeeTypedStage },
    parenthetical_content: { type: "string" },
    nickname: { type: "string" },
    adoption: { type: "string" },
    amendment_to: { type: "string" },
    note: { type: "string" },
    iso_identifier: { type: "string" },
    revision_of: { type: "string" },
    ashrae_number: { type: "string" },
    ashrae_year: { type: "string" },
    crossref: { type: "string" },
    reaffirmed: { type: "string" },
    interpretation: { type: "boolean", default: false },
    relationships: { type: "string", collection: true },
  });
  static mappings: FieldMapping[] = keyValue(
    { wire: "publisher", to: "publisher" },
    { wire: "copublisher", to: "copublisher" },
    { wire: "year", to: "year" },
    { wire: "type", to: "type" },
    { wire: "draft_status", to: "draft_status" },
    draftWire,
    { wire: "revision", to: "revision" },
    { wire: "edition", to: "edition" },
    { wire: "month", to: "month" },
    { wire: "day", to: "day" },
    { wire: "redline", to: "redline" },
    { wire: "edition_month", to: "edition_month" },
    { wire: "space_before_draft", to: "space_before_draft" },
    typedStageWire,
    { wire: "parenthetical_content", to: "parenthetical_content" },
    { wire: "nickname", to: "nickname" },
    { wire: "adoption", to: "adoption" },
    { wire: "amendment_to", to: "amendment_to" },
    { wire: "note", to: "note" },
    { wire: "iso_identifier", to: "iso_identifier" },
    { wire: "revision_of", to: "revision_of" },
    { wire: "ashrae_number", to: "ashrae_number" },
    { wire: "ashrae_year", to: "ashrae_year" },
    { wire: "crossref", to: "crossref" },
    { wire: "reaffirmed", to: "reaffirmed" },
    { wire: "interpretation", to: "interpretation" },
    {
      wire: "relationships",
      to: "relationships",
      toWire: (model) => {
        const rel = model["relationships"] as IeeeRelationship[] | undefined;
        if (rel === undefined || rel.length === 0) return undefined;
        return rel.map((r) => ({ relationship_type: r.relationshipType }));
      },
      fromWire: (hash) => {
        const value = hash["relationships"];
        if (!Array.isArray(value)) return undefined;
        return (value as Record<string, unknown>[]).map(
          (r) => new IeeeRelationship(String(r["relationship_type"] ?? ""), [], []),
        );
      },
    },
  );

  declare readonly publisher: string;
  declare readonly copublisher: string[];
  declare readonly year: string | undefined;
  declare readonly type: string | undefined;
  declare readonly draft_status: string | undefined;
  declare readonly draft: string | undefined;
  declare readonly revision: string | undefined;
  declare readonly edition: string | undefined;
  declare readonly month: string | undefined;
  declare readonly day: string | undefined;
  declare readonly redline: boolean | undefined;
  declare readonly edition_month: string | undefined;
  declare readonly space_before_draft: boolean | undefined;
  declare readonly typed_stage: IeeeTypedStage | undefined;
  declare readonly parenthetical_content: string | undefined;
  declare readonly nickname: string | undefined;
  declare readonly adoption: string | undefined;
  declare readonly amendment_to: string | undefined;
  declare readonly note: string | undefined;
  declare readonly iso_identifier: string | undefined;
  declare readonly revision_of: string | undefined;
  declare readonly ashrae_number: string | undefined;
  declare readonly ashrae_year: string | undefined;
  declare readonly crossref: string | undefined;
  declare readonly reaffirmed: string | undefined;
  declare readonly interpretation: boolean | undefined;
  declare readonly relationships: IeeeRelationship[] | undefined;

  private draftObjCache: IeeeDraft | undefined;

  draftObject(): IeeeDraft | undefined {
    if (this.draftObjCache !== undefined) return this.draftObjCache;
    if (this.draft === undefined || this.draft === "") return undefined;
    this.draftObjCache = IeeeDraft.parse(this.draft);
    return this.draftObjCache;
  }

  get codeObj(): IeeeCode | undefined {
    return undefined;
  }

  root(): IeeeIdentifier {
    return this;
  }

  yearForUrn(): string | undefined {
    return this.year;
  }

  toHash(): Record<string, unknown> {
    const hash = super.toHash();
    collapseIeeeHash(hash);
    return hash;
  }

  static fromHash(hash: Record<string, unknown>): BaseIdentifier {
    return super.fromHash(expandIeeeHash(hash));
  }
}

// --- render_base (the shared renderer core) ----------------------------------

export function renderIeeeBase(id: IeeeIdentifier): string {
  const parts: string[] = [];

  if (id.copublisher !== undefined && id.copublisher.length > 0) {
    parts.push([id.publisher, ...id.copublisher].join("/"));
  } else {
    parts.push(id.publisher);
  }

  if (id.draft_status !== undefined) parts.push(id.draft_status);

  const shouldRenderType = /^(IEEE|AIEE)/.test(id.publisher ?? "");
  const stageObj = id.typed_stage;
  if (
    shouldRenderType && !(stageObj?.projectStatus === true) &&
    id.type !== undefined && id.type.trim() !== "" && id.type !== "P" &&
    !/unapproved/i.test(id.draft_status ?? "")
  ) {
    let typeStr = id.type;
    if (typeStr.startsWith("P")) typeStr = typeStr.slice(1);
    if (typeStr.trim() !== "") parts.push(typeStr);
  }

  const codeObj = id.codeObj;
  const draftObj = id.draftObject();
  if (codeObj !== undefined) {
    let result = codeObj.render();
    if (stageObj?.projectStatus === true && shouldRenderType && !result.startsWith("P")) {
      result = `P${result}`;
    }
    if (id.year !== undefined && draftObj === undefined && id.edition === undefined && id.month === undefined) {
      result += `-${id.year}`;
    }
    if (id.revision !== undefined) result += `Rev${id.revision}`;
    if (draftObj !== undefined) {
      result += id.space_before_draft === true ? ` ${draftObj.render()}` : draftObj.render();
    }
    if (id.interpretation === true) result += "/INT";
    if (id.ashrae_number !== undefined) {
      result += `/ASHRAE Guideline ${id.ashrae_number}`;
      if (id.ashrae_year !== undefined) result += `-${id.ashrae_year}`;
    }
    if (id.crossref !== undefined) result += id.crossref;
    parts.push(result);
  } else if (shouldRenderType && stageObj?.projectStatus === true) {
    parts.push("P");
  }

  if (id.edition !== undefined) {
    let editionStr = `Edition ${id.edition}`;
    if (id.year !== undefined) {
      editionStr += ` ${id.year}`;
      if (id.edition_month !== undefined) editionStr += `-${id.edition_month}`;
    }
    parts.push(editionStr);
  }

  let result = parts.join(" ");

  if (id.month !== undefined) {
    result += `, ${id.month}`;
    if (id.day !== undefined) result += ` ${id.day}`;
    if (id.year !== undefined && id.edition === undefined) result += ` ${id.year}`;
  }

  const parentheticals: string[] = [];
  if (id.reaffirmed !== undefined && id.reaffirmed.trim() !== "") {
    parentheticals.push(`(R${id.reaffirmed})`);
  }
  if (id.parenthetical_content !== undefined) {
    parentheticals.push(`(${id.parenthetical_content})`);
  }
  if (parentheticals.length > 0) result += ` ${parentheticals.join(" ")}`;

  if (id.nickname !== undefined && id.nickname.trim() !== "") result += ` [${id.nickname}]`;
  if (id.redline === true) result += " - Redline";

  return result;
}

// --- URN generator -----------------------------------------------------------

let SPECIAL_URN_OF: (id: IeeeIdentifier) => string | undefined = () => undefined;
let CODE_THROUGH_BASE: (id: IeeeIdentifier) => boolean = () => false;

class IeeeUrnGenerator extends BaseUrnGenerator<IeeeIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts: string[] = ["urn", "ieee"];
    const special = this.specialType();
    const push = (value: string | undefined) => {
      if (value !== undefined) parts.push(value);
    };

    push(this.publisherComponent());
    push(special);
    push(this.typeComponent());
    push(this.codeComponent());
    push(this.yearComponent());
    push(this.draftComponent());
    if (id.edition !== undefined) push(`ed.${id.edition}`);
    push(this.monthDayComponent());
    if (id.draft_status !== undefined) push(id.draft_status.toLowerCase().replaceAll(" ", "."));

    if (special === undefined && id.redline === true) push("redline");
    if (special === undefined && id.interpretation === true) push("int");

    if (id.ashrae_number !== undefined) {
      let ashrae = `ashrae.${id.ashrae_number}`;
      if (id.ashrae_year !== undefined) ashrae += `-${id.ashrae_year}`;
      push(ashrae);
    }
    if (id.crossref !== undefined) push(`xref.${id.crossref}`);
    if (id.relationships !== undefined && id.relationships.length > 0) {
      push(`rel.${id.relationships.map((r) => r.render()).join("/")}`);
    }
    if (id.revision_of !== undefined) push(`revof.${id.revision_of}`);
    if (id.amendment_to !== undefined) push(`amdto.${id.amendment_to}`);
    if (id.adoption !== undefined) push(`adopt.${id.adoption}`);
    if (id.reaffirmed !== undefined) push(`reaff.${id.reaffirmed}`);
    if (id.note !== undefined) push(`note.${id.note}`);
    if (id.nickname !== undefined) push(`nick.${id.nickname}`);
    return parts.join(":");
  }

  protected specialType(): string | undefined {
    return SPECIAL_URN_OF(this.identifier);
  }

  protected publisherComponent(): string {
    // Supplements delegate #publisher/#copublisher to their base (Ruby
    // SupplementIdentifier); DualPublished derives publisher from BOTH
    // members; MultiNumbered derives it from its primary.
    const self = this.identifier as unknown as Record<string, unknown>;
    const first = self["first_identifier"] as IeeeIdentifier | undefined;
    const second = self["second_identifier"] as IeeeIdentifier | undefined;
    const single = (self["ieee_identifier"] ?? self["primary_identifier"]) as IeeeIdentifier | undefined;
    const derived =
      first !== undefined && second !== undefined
        ? [first.publisher, second.publisher]
        : undefined;
    const wrapped = (self["base"] ?? single) as IeeeIdentifier | undefined;
    const id = wrapped ?? this.identifier;
    const names = derived ?? (Array.isArray(id.publisher) ? id.publisher : [id.publisher]);
    const cleaned = names.map((p) => String(p).toLowerCase()).filter((p) => p !== "");
    let pub = cleaned.length === 0 ? "ieee" : cleaned.join("-");
    if (id.copublisher !== undefined && id.copublisher.length > 0) {
      pub = [pub, ...id.copublisher.map((c) => String(c).toLowerCase())].join("-");
    }
    return pub;
  }

  protected typeComponent(): string | undefined {
    const type = this.identifier.type;
    if (type === undefined || type.trim() === "" || type === "Std") return undefined;
    return type.toLowerCase().replaceAll(" ", ".");
  }

  protected codeComponent(): string | undefined {
    // Wrappers delegate code_obj to the identifier they wrap (Ruby
    // AdoptedStandard/CsaDualPublished/MultiNumberedIdentifier).
    const self = this.identifier as unknown as Record<string, unknown>;
    // NB: NOT base — SupplementIdentifier delegates #code but leaves
    // code_obj nil on the wrapper (identity-free corrigendum URNs) —
    // except InterpretationIdentifier, whose override reaches the base.
    const fallbacks = CODE_THROUGH_BASE(this.identifier)
      ? ["ieee_identifier", "primary_identifier", "first_identifier", "base"]
      : ["ieee_identifier", "primary_identifier", "first_identifier"];
    const wrapped = fallbacks.map((k) => self[k]).find((v): v is IeeeIdentifier => v instanceof IeeeIdentifier);
    return (wrapped ?? this.identifier).codeObj?.render();
  }

  protected yearComponent(): string | undefined {
    const id = this.identifier;
    if (id.year !== undefined) return id.year;
    const root = id.root();
    return root === id ? undefined : root.yearForUrn();
  }

  protected draftComponent(): string | undefined {
    const draftObj = this.identifier.draftObject();
    return draftObj === undefined ? undefined : `draft.${draftObj.render()}`;
  }

  protected monthDayComponent(): string | undefined {
    const parts: string[] = [];
    const id = this.identifier;
    if (id.month !== undefined) parts.push(id.month);
    if (id.day !== undefined) parts.push(id.day);
    return parts.length === 0 ? undefined : parts.join("-");
  }
}

// --- Class family ------------------------------------------------------------

export interface ClassSpec {
  kind: string;
}

const CODE_COLUMN_DEFS: AttributeTable = {
  number: { type: "string" },
  prefix: { type: "string" },
  parts: { type: "string", collection: true, default: [] as string[] },
  separator: { type: "string" },
};
const CODE_COLUMN_MAPPINGS = keyValue(
  { wire: "number", to: "number" },
  { wire: "prefix", to: "prefix" },
  { wire: "parts", to: "parts" },
  { wire: "separator", to: "separator" },
);

interface WireDelete {
  keys: string[];
}

function ieeeClass(
  spec: ClassSpec,
  opts: {
    codeColumns?: boolean;
    extraDefs?: AttributeTable;
    extraMappings?: FieldMapping[];
    wireDelete?: WireDelete;
    render?: (id: IeeeIdentifier & Record<string, unknown>) => string;
    rootOf?: (id: IeeeIdentifier & Record<string, unknown>) => IeeeIdentifier;
    yearForUrnOf?: (id: IeeeIdentifier & Record<string, unknown>) => string | undefined;
    specialUrn?: string;
    /** InterpretationIdentifier#code_obj falls back to the base's code. */
    codeThroughBase?: boolean;
  } = {},
): IdentifierStatic {
  const parentAttrs = () =>
    opts.codeColumns === true
      ? extendAttributes(IeeeIdentifier, CODE_COLUMN_DEFS)
      : IeeeIdentifier.attributes;
  const parentMappings = () =>
    opts.codeColumns === true
      ? [...IeeeIdentifier.mappings, ...CODE_COLUMN_MAPPINGS]
      : [...IeeeIdentifier.mappings];

  class IeeeConcrete extends IeeeIdentifier {
    static polymorphicName = `pubid:ieee:${spec.kind}`;
    static urnGenerator = IeeeUrnGenerator;
    static get attributes() {
      return opts.extraDefs === undefined
        ? parentAttrs()
        : extendAttributes({ attributes: parentAttrs() } as never, opts.extraDefs);
    }
    static get mappings() {
      const base = opts.extraMappings === undefined
        ? parentMappings()
        : [...parentMappings(), ...opts.extraMappings];
      return opts.wireDelete === undefined
        ? base
        : base.filter((m) => !opts.wireDelete!.keys.includes(m.wire));
    }

    declare readonly number: string | undefined;
    declare readonly prefix: string | undefined;
    declare readonly parts: string[];
    declare readonly separator: string | undefined;

    constructor(attrs: Record<string, unknown> = {}) {
      super(attrs);
      // Ruby lutaml materializes attribute defaults on every instance; the
      // base constructor only assigns present keys, so fill scalar defaults
      // the renderers read (publisher/type). toHash still drops them.
      const self = this as unknown as Record<string, unknown>;
      for (const [name, spec] of Object.entries(this.classAttributes())) {
        if (self[name] === undefined && spec.default !== undefined && typeof spec.default !== "function") {
          self[name] = spec.default;
        }
      }
    }

    render(): string {
      return this.renderBody();
    }

    toHuman(): string {
      return this.render();
    }

    renderBody(): string {
      return (opts.render ?? renderIeeeBase)(this as unknown as IeeeIdentifier & Record<string, unknown>);
    }

    get codeObj(): IeeeCode | undefined {
      // Only CodeNumber leaves carry code columns; on a supplement the
      // `number` attribute is the ORDINAL (Ruby SupplementIdentifier#code
      // delegates to base, code_obj stays nil).
      if (opts.codeColumns !== true) return undefined;
      const self = this as unknown as Record<string, unknown>;
      const number = self["number"];
      if (typeof number !== "string" || number === "") return undefined;
      return new IeeeCode({
        prefix: self["prefix"],
        number,
        parts: self["parts"],
        original_separator: self["separator"],
      });
    }

    root(): IeeeIdentifier {
      return opts.rootOf !== undefined
        ? opts.rootOf(this as unknown as IeeeIdentifier & Record<string, unknown>)
        : this;
    }

    yearForUrn(): string | undefined {
      return opts.yearForUrnOf !== undefined
        ? opts.yearForUrnOf(this as unknown as IeeeIdentifier & Record<string, unknown>)
        : this.year;
    }
  }
  registerType(IeeeConcrete as unknown as IdentifierStatic);
  if (opts.specialUrn !== undefined) {
    const special = opts.specialUrn;
    const prev = SPECIAL_URN_OF;
    SPECIAL_URN_OF = (id: IeeeIdentifier) => {
      if (id instanceof IeeeConcrete) return special;
      return prev(id);
    };
  }
  if (opts.codeThroughBase === true) {
    const prevCode = CODE_THROUGH_BASE;
    CODE_THROUGH_BASE = (id: IeeeIdentifier) => (id instanceof IeeeConcrete ? true : prevCode(id));
  }
  return IeeeConcrete as unknown as IdentifierStatic;
}

const childOf =
  (attrName: string) =>
  (id: IeeeIdentifier & Record<string, unknown>): IeeeIdentifier =>
    (id[attrName] as IeeeIdentifier | undefined)?.root() ?? id;

const childYearOf =
  (attrName: string) =>
  (id: IeeeIdentifier & Record<string, unknown>): string | undefined =>
    (id[attrName] as IeeeIdentifier | undefined)?.year;

// --- Supplements and wrappers -------------------------------------------------

export const SupplementBaseDefs = {
  base: { type: IeeeIdentifier as unknown as IdentifierStatic },
};

export const StandardClass = ieeeClass({ kind: "standard" }, { codeColumns: true });

export const ProjectDraftIdentifierClass = ieeeClass(
  { kind: "project-draft-identifier" },
  { codeColumns: true },
);

export const SiStandardClass = ieeeClass(
  { kind: "si-standard" },
  {
    codeColumns: true,
    specialUrn: "si",
    render: (id) => {
      const parts: string[] = ["IEEE/ASTM"];
      const isPsi = (id.typed_stage?.abbr ?? []).includes("PSI");
      parts.push(isPsi ? "PSI" : "SI");
      const codeObj = id.codeObj;
      let codePart = codeObj?.render() ?? "";
      const draftObj = id.draftObject();
      if (draftObj !== undefined) codePart += `/D${draftObj.version}`;
      if (codeObj !== undefined) parts.push(codePart);
      let result = "";
      for (const part of parts) {
        if (result === "" || part.startsWith("-") || part.startsWith(",")) {
          result += part;
        } else {
          result += ` ${part}`;
        }
      }
      if (id.month !== undefined && id.year !== undefined) result += `, ${id.month} ${id.year}`;
      else if (id.year !== undefined) result += `-${id.year}`;
      return result;
    },
  },
);

export const CorrigendumClass = ieeeClass(
  { kind: "corrigendum" },
  {
    extraDefs: SupplementBaseDefs,
    extraMappings: keyValue(nestedIdWire("base"), { wire: "number", to: "number" }),
    wireDelete: { keys: ["publisher", "copublisher"] },
    render: (id) => {
      const base = id["base"] as IeeeIdentifier | undefined;
      if (base === undefined) return renderIeeeBase(id);
      let result = base.toHuman();
      result += "/Cor";
      if (id.number !== undefined) result += ". ";
      if (id.number !== undefined) result += id.number;
      if (id.year !== undefined) result += `-${id.year}`;
      return result;
    },
    rootOf: childOf("base"),
  },
);

export const AmendmentClass = ieeeClass(
  { kind: "amendment" },
  {
    extraDefs: SupplementBaseDefs,
    extraMappings: keyValue(nestedIdWire("base"), { wire: "number", to: "number" }),
    wireDelete: { keys: ["publisher", "copublisher"] },
    render: (id) => {
      const base = id["base"] as IeeeIdentifier | undefined;
      if (base === undefined) return renderIeeeBase(id);
      let result = base.toHuman();
      result += "/Amd";
      if (id.number !== undefined) result += ` ${id.number}`;
      if (id.year !== undefined) result += `-${id.year}`;
      return result;
    },
    rootOf: childOf("base"),
  },
);

export const InterpretationClass = ieeeClass(
  { kind: "interpretation-identifier" },
  {
    specialUrn: "interpretation",
    codeThroughBase: true,
    extraDefs: SupplementBaseDefs,
    extraMappings: keyValue(nestedIdWire("base")),
    wireDelete: { keys: ["publisher", "copublisher"] },
    render: (id) => {
      const base = id["base"] as IeeeIdentifier | undefined;
      if (base === undefined) return renderIeeeBase(id);
      let result = base.toHuman();
      result += "/INT";
      if (id.year !== undefined) result += `-${id.year}`;
      return result;
    },
    rootOf: childOf("base"),
  },
);

export const ConformanceClass = ieeeClass(
  { kind: "conformance-identifier" },
  {
    specialUrn: "conformance",
    extraDefs: SupplementBaseDefs,
    extraMappings: keyValue(nestedIdWire("base"), { wire: "number", to: "number" }),
    wireDelete: { keys: ["publisher", "copublisher"] },
    render: (id) => {
      const base = id["base"] as IeeeIdentifier | undefined;
      if (base === undefined) return renderIeeeBase(id);
      let result = base.toHuman();
      if (id.number !== undefined) result += `/Conformance${id.number}`;
      if (id.year !== undefined) result += `-${id.year}`;
      return result;
    },
    rootOf: childOf("base"),
  },
);

const DualDefs = {
  first_identifier: { type: IeeeIdentifier as unknown as IdentifierStatic },
  second_identifier: { type: IeeeIdentifier as unknown as IdentifierStatic },
};

export const DualPublishedClass = ieeeClass(
  { kind: "dual-published" },
  {
    extraDefs: DualDefs,
    extraMappings: keyValue(nestedIdWire("first_identifier"), nestedIdWire("second_identifier")),
    wireDelete: { keys: ["publisher"] },
    render: (id) =>
      `${(id["first_identifier"] as IeeeIdentifier).toHuman()} and ${(id["second_identifier"] as IeeeIdentifier).toHuman()}`,
    rootOf: childOf("first_identifier"),
    yearForUrnOf: childYearOf("first_identifier"),
  },
);

export const DualIdentifierClass = ieeeClass(
  { kind: "dual-identifier" },
  {
    extraDefs: DualDefs,
    extraMappings: keyValue(nestedIdWire("first_identifier"), nestedIdWire("second_identifier")),
    render: (id) =>
      `${(id["first_identifier"] as IeeeIdentifier).toHuman()} and ${(id["second_identifier"] as IeeeIdentifier).toHuman()}`,
  },
);

export const ParentheticalClass = ieeeClass(
  { kind: "parenthetical-identifier" },
  {
    extraDefs: {
      base: { type: IeeeIdentifier as unknown as IdentifierStatic },
      parenthetical_identifier: { type: IeeeIdentifier as unknown as IdentifierStatic },
    },
    extraMappings: keyValue(nestedIdWire("base"), nestedIdWire("parenthetical_identifier")),
    render: (id) => {
      let result = (id["base"] as IeeeIdentifier).toHuman();
      if (id["parenthetical_identifier"] !== undefined) {
        result += ` (${(id["parenthetical_identifier"] as IeeeIdentifier).toHuman()})`;
      }
      return result;
    },
    rootOf: childOf("base"),
  },
);

export const AdoptedStandardClass = ieeeClass(
  { kind: "adopted-standard" },
  {
    extraDefs: {
      ieee_identifier: { type: IeeeIdentifier as unknown as IdentifierStatic },
      adopted_identifiers: { type: IeeeIdentifier as unknown as IdentifierStatic, collection: true },
    },
    extraMappings: keyValue(nestedIdWire("ieee_identifier"), nestedIdWire("adopted_identifiers")),
    wireDelete: { keys: ["publisher"] },
    render: (id) => {
      const ieee = id["ieee_identifier"] as IeeeIdentifier;
      let result = ieee.toHuman();
      const adopted = id["adopted_identifiers"] as IeeeIdentifier[] | undefined;
      if (adopted !== undefined && adopted.length > 0) {
        result += ` (${adopted.map((a) => a.toHuman()).join(" and ")})`;
      }
      return result;
    },
    rootOf: childOf("ieee_identifier"),
    yearForUrnOf: childYearOf("ieee_identifier"),
  },
);

export const CsaDualPublishedClass = ieeeClass(
  { kind: "csa-dual-published" },
  {
    extraDefs: {
      ieee_identifier: { type: IeeeIdentifier as unknown as IdentifierStatic },
      csa_string: { type: "string" },
    },
    // The wrapper serializes its DELEGATED year/typed_stage (Ruby lutaml
    // reads through the reader methods) — the builder copies them onto the
    // wrapper instance. csa_identifier is runtime-only (never serialized).
    extraMappings: keyValue(nestedIdWire("ieee_identifier")),
    render: (id) => {
      const ieee = id["ieee_identifier"] as IeeeIdentifier;
      let csaStr = String(id["csa_string"] ?? "");
      if (!csaStr.startsWith("CSA") && !csaStr.startsWith("CAN/")) csaStr = `CSA ${csaStr}`;
      return `${ieee.toHuman()}/${csaStr}`;
    },
    rootOf: childOf("ieee_identifier"),
    yearForUrnOf: childYearOf("ieee_identifier"),
  },
);

export const MultiNumberedClass = ieeeClass(
  { kind: "multi-numbered-identifier" },
  {
    extraDefs: {
      primary_identifier: { type: IeeeIdentifier as unknown as IdentifierStatic },
      secondary_identifier: { type: IeeeIdentifier as unknown as IdentifierStatic },
    },
    extraMappings: keyValue(nestedIdWire("primary_identifier"), nestedIdWire("secondary_identifier")),
    wireDelete: { keys: ["publisher", "year"] },
    render: (id) => {
      const primary = id["primary_identifier"] as IeeeIdentifier;
      const secondary = id["secondary_identifier"] as IeeeIdentifier | undefined;
      if (secondary === undefined) return primary.toHuman();
      const secondaryCode = secondary.codeObj?.render() ?? "";
      if (secondaryCode.startsWith("C") && /^C\d+\./.test(secondaryCode)) {
        return `${primary.toHuman()}/${secondaryCode}`;
      }
      return `${primary.toHuman()} and ${secondary.toHuman()}`;
    },
    rootOf: childOf("primary_identifier"),
  },
);

export const JointDevelopmentClass = ieeeClass(
  { kind: "joint-development" },
  {
    codeColumns: true,
    extraDefs: {
      publishers: { type: "string", collection: true },
      lead_party: { type: "string" },
      iso_stage: { type: "string" },
      ieee_draft: { type: "string" },
    },
    extraMappings: keyValue(
      { wire: "publishers", to: "publishers" },
      { wire: "lead_party", to: "lead_party" },
      { wire: "iso_stage", to: "iso_stage" },
      { wire: "ieee_draft", to: "ieee_draft" },
    ),
    wireDelete: { keys: ["publisher", "copublisher"] },
    render: (id) => {
      const publishers = id["publishers"] as string[] | undefined;
      const leadParty = id["lead_party"] as string | undefined;
      const isoStage = id["iso_stage"] as string | undefined;
      const ieeeDraft = id["ieee_draft"] as string | undefined;
      const codeObj = id.codeObj;
      if (leadParty === "ISO" && (id.typed_stage !== undefined || isoStage !== undefined)) {
        const parts: string[] = [];
        if (publishers !== undefined && publishers.length > 0) parts.push(publishers.join("/"));
        if (id.typed_stage !== undefined) {
          parts.push(id.typed_stage.record.iso_stage_equivalent ?? id.typed_stage.render());
        } else if (isoStage !== undefined) {
          parts.push(isoStage);
        }
        let codeStr = codeObj?.render().replace(/^P/, "") ?? "";
        if (codeStr !== "") parts.push(codeStr);
        let result = parts.join(" ");
        if (id.year !== undefined) result += `:${id.year}`;
        return result;
      }
      // IEEE format
      const parts: string[] = [];
      if (publishers !== undefined && publishers.length > 0) parts.push(publishers.join("/"));
      let codeStr = codeObj?.render().replace(/^P/, "") ?? "";
      if (id.typed_stage?.projectStatus === true || id.type === "P") codeStr = `P${codeStr}`;
      if (ieeeDraft !== undefined) codeStr += `/${ieeeDraft}`;
      else if (id.typed_stage?.ieeeDraftEquivalent !== undefined) {
        codeStr += `/${id.typed_stage.ieeeDraftEquivalent}`;
      }
      if (codeStr !== "") parts.push(codeStr);
      let result = parts.join(" ");
      if (id.year !== undefined) result += `-${id.year}`;
      return result;
    },
  },
);

export const IecIeeeCopublishedClass = ieeeClass(
  { kind: "iec-ieee-copublished" },
  {
    extraDefs: {
      number: { type: "string" },
      parts: { type: "string", collection: true, default: [] as string[] },
      separators: { type: "string", collection: true, default: [] as string[] },
      year_sep: { type: "string", default: "-" },
      draft_info: { type: "string" },
      iec_year: { type: "string" },
      date_info: { type: "string" },
    },
    extraMappings: keyValue(
      { wire: "number", to: "number" },
      { wire: "parts", to: "parts" },
      { wire: "separators", to: "separators" },
      { wire: "year_sep", to: "year_sep" },
      { wire: "draft_info", to: "draft_info" },
      { wire: "iec_year", to: "iec_year" },
      { wire: "date_info", to: "date_info" },
    ),
    render: (id) => {
      let result = "IEC/IEEE";
      const number = id["number"] as string | undefined;
      if (number !== undefined && number !== "") {
        const parts = (id["parts"] as string[] | undefined) ?? [];
        const separators = (id["separators"] as string[] | undefined) ?? [];
        let code = number;
        separators.forEach((sep, i) => {
          code += `${sep}${parts[i] ?? ""}`;
        });
        if (id.year !== undefined) code += `${id["year_sep"] ?? "-"}${id.year}`;
        result += ` ${code}`;
      }
      const draftInfo = id["draft_info"] as string | undefined;
      if (draftInfo !== undefined) result += draftInfo;
      const iecYear = id["iec_year"] as string | undefined;
      if (iecYear !== undefined) result += ` IEC:${iecYear}`;
      const dateInfo = id["date_info"] as string | undefined;
      if (dateInfo !== undefined) result += ` ${dateInfo}`;
      return result;
    },
  },
);

// --- AIEE / IRE / NESC -------------------------------------------------------

export const AieeClass = ieeeClass(
  { kind: "aiee" },
  {
    codeColumns: true,
    extraDefs: {
      publisher: { type: "string", default: "AIEE" },
      type: { type: "string", default: undefined },
      date_separator: { type: "string" },
      original_format: { type: "string" },
    },
    extraMappings: keyValue(
      { wire: "date_separator", to: "date_separator" },
      { wire: "original_format", to: "original_format" },
    ),
    render: (id) => {
      const result = [id.publisher];
      if (id.type !== undefined && id.type !== "") result.push(id.type);
      if (id.codeObj !== undefined) result.push(id.codeObj.render());
      let base = result.join(" ");
      const format = id["original_format"] as string | undefined;
      if (id.year !== undefined) {
        const month = id.month;
        const dateSep = id["date_separator"] as string | undefined;
        if (format === "short") {
          base += `-${id.year}`;
        } else if (format === "long" || month !== undefined || dateSep !== undefined) {
          const sep = dateSep ?? ",";
          base += `${sep} ${month !== undefined ? `${month} ` : ""}${id.year}`;
        } else {
          base += `-${id.year}`;
        }
      }
      return base;
    },
  },
);

export const IreClass = ieeeClass(
  { kind: "ire" },
  {
    codeColumns: true,
    extraDefs: {
      publisher: { type: "string", default: "IRE" },
      type: { type: "string", default: undefined },
    },
    render: (id) => {
      const shortYear = (() => {
        if (id.year === undefined) return undefined;
        const value = Number.parseInt(id.year, 10);
        return String(value >= 1900 && value <= 1999 ? value - 1900 : value);
      })();
      const result = [shortYear, id.publisher, id.type, id.codeObj?.render()]
        .filter((p): p is string => p !== undefined && p !== "");
      return result.join(" ");
    },
  },
);

const NescDefs: AttributeTable = {
  variant: { type: "string" },
  registered: { type: "boolean" },
  abbr_suffix: { type: "boolean" },
  abbr_suffix_registered: { type: "boolean" },
};
const NescMappings = keyValue(
  { wire: "variant", to: "variant" },
  { wire: "registered", to: "registered" },
  { wire: "abbr_suffix", to: "abbr_suffix" },
  { wire: "abbr_suffix_registered", to: "abbr_suffix_registered" },
);

export const NescEditionClass = ieeeClass(
  { kind: "nesc-edition" },
  {
    codeColumns: true,
    extraDefs: NescDefs,
    extraMappings: NescMappings,
    render: (id) =>
      ["IEEE Std", id.year, nescNamePortion(id)].filter((p) => p !== undefined).join(" "),
  },
);

export const NescHandbookClass = ieeeClass(
  { kind: "nesc-handbook" },
  {
    codeColumns: true,
    extraDefs: { ...NescDefs, edition: { type: "string", default: undefined } },
    extraMappings: NescMappings,
    render: (id) => {
      const abbr = id.registered === true ? "NESC(R)" : "NESC";
      const parts = [["IEEE Std", id.year, `${abbr} Handbook`].filter((p) => p !== undefined).join(" ")];
      if (id.edition !== undefined) parts.push(`, ${id.edition}`);
      return parts.join("");
    },
  },
);

export const NescRedlineClass = ieeeClass(
  { kind: "nesc-redline" },
  {
    codeColumns: true,
    extraDefs: NescDefs,
    extraMappings: NescMappings,
    render: (id) => [id.year, "NESC Redline"].filter((p) => p !== undefined).join(" "),
  },
);

export const NescStandardClass = ieeeClass(
  { kind: "nesc-standard" },
  {
    codeColumns: true,
    extraDefs: NescDefs,
    extraMappings: NescMappings,
    render: (id) => {
      let codePart = "C2";
      if (id.year !== undefined) codePart += `-${id.year}`;
      return `${codePart} National Electrical Safety Code`;
    },
  },
);

export const NescDraftClass = ieeeClass(
  { kind: "nesc-draft" },
  {
    codeColumns: true,
    extraDefs: NescDefs,
    extraMappings: NescMappings,
    render: (id) => {
      const parts = ["Draft National Electrical Safety Code"];
      if (id.month !== undefined && id.year !== undefined) parts.push(`, ${id.month} ${id.year}`);
      return parts.join("");
    },
  },
);

function nescNamePortion(id: IeeeIdentifier & Record<string, unknown>): string {
  let name = "National Electrical Safety Code";
  if (id["registered"] === true) name += "(R)";
  if (id["abbr_suffix"] === true) {
    let suffix = "NESC";
    if (id["abbr_suffix_registered"] === true) suffix += "(R)";
    name += ` (${suffix})`;
  }
  return name;
}

// The RedlinedStandard wrapper exists in Ruby but is unreachable (a redline
// is a flat `redline: true` Standard); not registered.
