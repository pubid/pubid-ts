import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/oasis/ on the unified model. The grammar strips
 * "OASIS " and captures the slug verbatim; the builder decomposes it
 * order-independently by classifying WHOLE dash-fragments (stage tokens
 * are case-sensitive). `original` alone drives the human form; the URN
 * percent-encodes only the space and stray "]" of malformed records.
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

class OasisUrnGenerator extends BaseUrnGenerator<OasisIdentifier> {
  generate(): string {
    const slug = this.identifier.original.replace(/[ \]]/g, (c) => (c === " " ? "%20" : "%5D"));
    return `urn:oasis:${slug}`;
  }
}

export class OasisIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:oasis:standard";
  static attributes = extendAttributes(BaseIdentifier, {
    original: { type: "string" },
    number: { type: "string" },
    version: { type: "string" },
    stage: { type: "string" },
    part: { type: "string" },
    label: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "original", to: "original" },
    { wire: "number", to: "number" },
    { wire: "version", to: "version" },
    { wire: "stage", to: "stage" },
    { wire: "part", to: "part" },
    { wire: "label", to: "label" },
  );
  static urnGenerator = OasisUrnGenerator;

  declare readonly original: string;
  declare readonly number: string | undefined;
  declare readonly version: string | undefined;
  declare readonly stage: string | undefined;
  declare readonly part: string | undefined;
  declare readonly label: string | undefined;

  render(): string {
    return `OASIS ${this.original}`;
  }
}
registerType(OasisIdentifier as unknown as IdentifierStatic);

// v?N(.N)+ (bare integers deliberately NOT versions); stage tokens are
// CASE-SENSITIVE; part spellings incl. bare "Pt"/"P".
const VERSION_RE = /^v?\d+(?:\.\d+)+$/i;
const STAGE_RE = /^(?:CSPRD|CSD|COS|CS|WD|OS|PS|PRD|CD|Errata)\d*$/;
const PART_RE = /^(?:Part|Pt|part|P)\d*$/;

type FragmentKind = "version" | "stage" | "part" | undefined;

function classify(fragment: string): FragmentKind {
  if (VERSION_RE.test(fragment)) return "version";
  if (STAGE_RE.test(fragment)) return "stage";
  if (PART_RE.test(fragment)) return "part";
  return undefined;
}

class OasisBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return OasisIdentifier as unknown as IdentifierStatic;
  }

  protected cast(key: string, value: unknown): unknown {
    if (key !== "original") return value;
    const original = String(value);
    const attrs: Record<string, unknown> = { original };
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
    const number = names(lead);
    if (number !== undefined) attrs["number"] = number;
    const version = firstOf("version");
    if (version !== undefined) attrs["version"] = version;
    const stage = firstOf("stage");
    if (stage !== undefined) attrs["stage"] = stage;
    const part = firstOf("part");
    if (part !== undefined) attrs["part"] = part;
    const label = names(rest);
    if (label !== undefined) attrs["label"] = label;
    return attrs;
  }
}

export function oasisGrammarImplementation(): FlavorImplementation {
  const builder = new OasisBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(oasisGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("OASIS: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
