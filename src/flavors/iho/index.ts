import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/iho/. Series-letter identifiers:
 *   [IHO ]<S|P|M|B|C>-<number[suffix]>[ Appendix|Ap. X][ Part N][ Annex L]
 *   [ Suppl N][ <version>]
 * The number may carry a ":", "/" or "-" suffix segment or a trailing
 * capital letter ("P-1/21", "S-11A"). Version is three dot-separated
 * digit runs. The prefix-less form parses and renders with "IHO ".
 */

type IhoKind = "standard" | "publication" | "miscellaneous" | "bibliographic" | "circular-letter";

const LETTER_KINDS: Record<string, IhoKind> = {
  S: "standard",
  P: "publication",
  M: "miscellaneous",
  B: "bibliographic",
  C: "circular-letter",
};

const KIND_LETTERS: Record<IhoKind, string> = {
  standard: "S",
  publication: "P",
  miscellaneous: "M",
  bibliographic: "B",
  "circular-letter": "C",
};

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const dash = str("-");
  const dot = str(".");
  const digits = match("[0-9]").repeat(1, Infinity);

  rule("series", () =>
    str("S").or(str("P"), str("M"), str("B"), str("C")).as("type"),
  );
  rule(
    "number_suffix",
    () =>
      str(":")
        .then(digits)
        .or(str("/").then(digits))
        .or(dash.then(digits))
        .or(match("[A-Z]")),
  );
  rule(
    "number",
    () => digits.then(rules["number_suffix"]!.maybe()).as("number"),
  );
  rule(
    "appendix",
    () =>
      space
        .then(str("Appendix").or(str("Ap.")))
        .then(
          space,
          match("[A-Z]")
            .then(dash, digits)
            .or(digits)
            .or(match("[A-Z]"))
            .as("appendix"),
        ),
  );
  rule(
    "part",
    () =>
      space.then(str("Part")).then(
        space,
        digits
          .then(match("[a-zA-Z]").repeat(0, Infinity))
          .as("part")
          .or(match("[A-Z]").as("part")),
      ),
  );
  rule(
    "annex",
    () => space.then(str("Annex")).then(space, match("[A-Z]").as("annex")),
  );
  rule(
    "supplement",
    () => space.then(str("Suppl")).then(space, digits.as("supplement")),
  );
  rule(
    "version",
    () =>
      space.then(
        digits.then(dot, digits, dot, digits).as("version"),
      ),
  );
  rule(
    "identifier",
    () =>
      str("IHO")
        .then(space)
        .maybe()
        .then(rules["series"]!, dash, rules["number"]!)
        .then(rules["appendix"]!.maybe())
        .then(rules["part"]!.maybe())
        .then(rules["annex"]!.maybe())
        .then(rules["supplement"]!.maybe())
        .then(rules["version"]!.maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ihoGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface IhoIdentifier {
  kind: IhoKind;
  number: string;
  appendix?: string;
  part?: string;
  annex?: string;
  supplement?: string;
  version?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildIhoIdentifier(tree: Tree): IhoIdentifier {
  if (!isObj(tree) || tree["type"] === undefined || tree["number"] === undefined) {
    throw new ParseFailed("IHO: unexpected parse tree", 0);
  }
  const kind = LETTER_KINDS[String(tree["type"])];
  if (kind === undefined) {
    throw new ParseFailed(`IHO: unknown series ${String(tree["type"])}`, 0);
  }
  const id: IhoIdentifier = { kind, number: String(tree["number"]) };
  for (const key of ["appendix", "part", "annex", "supplement", "version"] as const) {
    if (tree[key] !== undefined && tree[key] !== null) {
      id[key] = String(tree[key]);
    }
  }
  return id;
}

export function toHash(id: IhoIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = { _type: `pubid:iho:${id.kind}`, number: id.number };
  for (const key of ["appendix", "part", "annex", "supplement", "version"] as const) {
    if (id[key] !== undefined) hash[key] = id[key];
  }
  return hash;
}

export function fromHash(hash: Record<string, unknown>): IhoIdentifier {
  const kind = String(hash["_type"]).slice("pubid:iho:".length) as IhoKind;
  if (!(kind in KIND_LETTERS)) {
    throw new ParseFailed(`IHO: unknown _type ${String(hash["_type"])}`, 0);
  }
  const id: IhoIdentifier = { kind, number: String(hash["number"]) };
  for (const key of ["appendix", "part", "annex", "supplement", "version"] as const) {
    if (hash[key] !== undefined && hash[key] !== null) {
      id[key] = String(hash[key]);
    }
  }
  return id;
}

export function toHuman(id: IhoIdentifier): string {
  const letter = KIND_LETTERS[id.kind];
  let result = `IHO ${letter}-${id.number}`;
  if (id.appendix !== undefined) result += ` Ap. ${id.appendix}`;
  if (id.part !== undefined) result += ` Part ${id.part}`;
  if (id.annex !== undefined) result += ` Annex ${id.annex}`;
  if (id.supplement !== undefined) result += ` Suppl ${id.supplement}`;
  if (id.version !== undefined) result += ` ${id.version}`;
  return result;
}

export function toUrn(id: IhoIdentifier): string {
  const parts = ["urn", "iho", KIND_LETTERS[id.kind].toLowerCase(), id.number];
  if (id.appendix !== undefined) parts.push(`ap.${id.appendix}`);
  if (id.part !== undefined) parts.push(`part.${id.part}`);
  if (id.annex !== undefined) parts.push(`annex.${id.annex}`);
  if (id.supplement !== undefined) parts.push(`suppl.${id.supplement}`);
  if (id.version !== undefined) parts.push(id.version);
  return parts.join(":");
}

class IhoIdentifierImpl implements Identifier {
  constructor(private readonly id: IhoIdentifier) {}
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
    return new IhoIdentifierImpl(fromHash(hash));
  }
}

export function ihoGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new IhoIdentifierImpl(buildIhoIdentifier(parseGrammar(ihoGrammar, input)));
    },
  };
}
