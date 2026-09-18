import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/oasis/. The grammar only strips the "OASIS "
 * prefix and captures the slug verbatim; the Builder decomposes it
 * order-independently into number/version/stage/part/label by
 * classifying WHOLE dash-fragments (so a stage-like substring inside a
 * spec name is never mistaken for a stage). `original` alone drives
 * to_s and the URN ("urn:oasis:<slug>"), so the printed form always
 * round-trips exactly.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  rule("prefix", () => str("OASIS").then(str(" ")));
  rule("slug", () => match("[\\s\\S]").repeat(1, Infinity).as("original"));
  rule("identifier", () => rules["prefix"]!.then(rules["slug"]!));
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const oasisGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface OasisIdentifier {
  kind: "standard";
  original: string;
  number?: string;
  version?: string;
  stage?: string;
  part?: string;
  label?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// v?N(.N)+ (bare integers are deliberately NOT versions — too ambiguous
// with spec-name tokens).
const VERSION_RE = /^v?\d+(?:\.\d+)+$/i;
// Approval-stage tokens + optional revision digits; case-sensitive as in
// Ruby (longest-first matters only within the regex alternation).
const STAGE_RE = /^(?:CSPRD|CSD|COS|CS|WD|OS|PS|PRD|CD|Errata)\d*$/;
// Part tokens across the three observed spellings, plus bare "Pt"/"P".
const PART_RE = /^(?:Part|Pt|part|P)\d*$/;

type FragmentKind = "version" | "stage" | "part" | undefined;

function classify(fragment: string): FragmentKind {
  if (VERSION_RE.test(fragment)) return "version";
  if (STAGE_RE.test(fragment)) return "stage";
  if (PART_RE.test(fragment)) return "part";
  return undefined;
}

export function decompose(original: string): {
  number: string | undefined;
  version: string | undefined;
  stage: string | undefined;
  part: string | undefined;
  label: string | undefined;
} {
  const pairs = original.split("-").map((f) => [f, classify(f)] as const);
  const leadEnd = pairs.findIndex(([, kind]) => kind !== undefined);
  const lead = leadEnd === -1 ? pairs : pairs.slice(0, leadEnd);
  const rest = leadEnd === -1 ? [] : pairs.slice(leadEnd);
  const names = (ps: readonly (readonly [string, FragmentKind])[]): string | undefined => {
    const fragments = ps.filter(([, kind]) => kind === undefined).map(([f]) => f);
    return fragments.length === 0 ? undefined : fragments.join("-");
  };
  const firstOf = (kind: Exclude<FragmentKind, undefined>): string | undefined =>
    rest.find(([, k]) => k === kind)?.[0];
  return {
    number: names(lead),
    version: firstOf("version"),
    stage: firstOf("stage"),
    part: firstOf("part"),
    label: names(rest),
  };
}

export function buildOasisIdentifier(tree: Tree): OasisIdentifier {
  if (!isObj(tree) || tree["original"] === undefined || tree["original"] === null) {
    throw new ParseFailed("OASIS: unexpected parse tree", 0);
  }
  const original = String(tree["original"]);
  const parts = decompose(original);
  const id: OasisIdentifier = { kind: "standard", original };
  for (const key of ["number", "version", "stage", "part", "label"] as const) {
    if (parts[key] !== undefined) id[key] = parts[key];
  }
  return id;
}

export function toHash(id: OasisIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = {
    _type: "pubid:oasis:standard",
    original: id.original,
  };
  if (id.number !== undefined) hash["number"] = id.number;
  if (id.version !== undefined) hash["version"] = id.version;
  if (id.stage !== undefined) hash["stage"] = id.stage;
  if (id.part !== undefined) hash["part"] = id.part;
  if (id.label !== undefined) hash["label"] = id.label;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): OasisIdentifier {
  if (hash["_type"] !== "pubid:oasis:standard") {
    throw new ParseFailed(`OASIS: unknown _type ${String(hash["_type"])}`, 0);
  }
  const id: OasisIdentifier = { kind: "standard", original: String(hash["original"]) };
  for (const key of ["number", "version", "stage", "part", "label"] as const) {
    if (hash[key] !== undefined && hash[key] !== null) {
      id[key] = String(hash[key]);
    }
  }
  return id;
}

export function toHuman(id: OasisIdentifier): string {
  return `OASIS ${id.original}`;
}

// The URN echoes the slug as a single segment; the only non-URN-safe
// characters real OASIS slugs contain are space and a stray "]" (a few
// malformed records), percent-encoded explicitly so clean slugs pass
// through unchanged.
export function toUrn(id: OasisIdentifier): string {
  return `urn:oasis:${id.original.replace(/[ \]]/g, (c) => (c === " " ? "%20" : "%5D"))}`;
}

class OasisIdentifierImpl implements Identifier {
  constructor(private readonly id: OasisIdentifier) {}
  toHash(): Record<string, unknown> {
    return toHash(this.id);
  }
  toHuman(): string {
    return toHuman(this.id);
  }
  toUrn(): string | undefined {
    return toUrn(this.id);
  }
  fromHash(hash: Record<string, unknown>): Identifier {
    return new OasisIdentifierImpl(fromHash(hash));
  }
}

export function oasisGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new OasisIdentifierImpl(buildOasisIdentifier(parseGrammar(oasisGrammar, input)));
    },
  };
}
