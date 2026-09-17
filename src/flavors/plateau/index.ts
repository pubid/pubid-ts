import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/plateau/ — MLIT PLATEAU (Japan 3D urban mapping).
 * "PLATEAU Handbook #00 第1.0版" / "PLATEAU Technical Report #46-1".
 * number and annex are INTEGERS on the wire; the human form renders the
 * number and the URN number/annex zero-padded to 2 digits, but the human
 * annex unpadded. The handbook rule also matches Technical Report text
 * (doc_type matches either keyword) — the builder dispatches on :type and
 * drops the edition for Technical Report, as in Ruby.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  rule("space", () => space);
  rule("digit", () => digit);
  rule("digits", () => digits);
  rule("publisher", () => str("PLATEAU"));
  rule("doc_type", () => str("Handbook").or(str("Technical Report")).as("type"));
  rule("number", () => str("#").then(digits.as("number")));
  // Legacy Latin references use "_" as the sub-number separator; both
  // render as the canonical dash.
  rule("annex", () => str("-").or(str("_")).then(digits.as("annex")));
  rule("edition_part", () =>
    str("第").then(
      digits.then(str("."), digits).as("edition"),
      str("版"),
    ),
  );
  rule("edition_latin", () => digits.then(str("."), digits).as("edition"));
  rule("edition", () => space.then(rules["edition_part"]!.or(rules["edition_latin"]!)));
  rule("annex_letter", () => match("[A-Z]").as("annex_letter"));
  rule("annex_supplement", () =>
    space.then(str("Annex")).then(space, rules["annex_letter"]!),
  );
  rule("handbook", () =>
    rules["publisher"]!
      .then(space, rules["doc_type"]!, space, rules["number"]!)
      .then(rules["annex"]!.maybe())
      .then(rules["edition"]!.maybe()),
  );
  rule("technical_report", () =>
    rules["publisher"]!
      .then(space, rules["doc_type"]!, space, rules["number"]!)
      .then(rules["annex"]!.maybe()),
  );
  rule("annex_identifier", () =>
    rules["handbook"]!
      .or(rules["technical_report"]!)
      .as("base")
      .then(rules["annex_supplement"]!),
  );
  rule("identifier", () =>
    rules["annex_identifier"]!
      .or(rules["handbook"]!)
      .or(rules["technical_report"]!),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const plateauGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface PlateauIdentifier {
  kind: "handbook" | "technical-report";
  number: number;
  annex?: number;
  edition?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildPlateauIdentifier(tree: Tree): PlateauIdentifier {
  if (!isObj(tree) || tree["type"] === undefined || tree["number"] === undefined) {
    if (isObj(tree) && tree["base"] !== undefined) {
      // Upstream pubid (Ruby) crashes on Annex supplements: construction
      // raises Lutaml::Model::IncorrectModelError (publisher String vs
      // Components::Publisher), so "… Annex A" never parses there either.
      // Rejecting here matches the reference implementation until it
      // defines the supplement wire shape.
      throw new ParseFailed("PLATEAU: Annex supplements are unsupported upstream", 0);
    }
    throw new ParseFailed("PLATEAU: unexpected parse tree", 0);
  }
  const type = String(tree["type"]);
  if (type !== "Handbook" && type !== "Technical Report") {
    throw new ParseFailed(`PLATEAU: unknown type ${type}`, 0);
  }
  const id: PlateauIdentifier = {
    kind: type === "Handbook" ? "handbook" : "technical-report",
    number: Number(tree["number"]),
  };
  if (tree["annex"] !== undefined && tree["annex"] !== null) {
    id.annex = Number(tree["annex"]);
  }
  if (tree["edition"] !== undefined && tree["edition"] !== null && id.kind === "handbook") {
    id.edition = String(tree["edition"]);
  }
  return id;
}

const TYPE_STRINGS: Record<PlateauIdentifier["kind"], string> = {
  handbook: "Handbook",
  "technical-report": "Technical Report",
};

export function toHash(id: PlateauIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = { _type: `pubid:plateau:${id.kind}`, number: id.number };
  if (id.edition !== undefined) hash["edition"] = id.edition;
  if (id.annex !== undefined) hash["annex"] = id.annex;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): PlateauIdentifier {
  const type = String(hash["_type"]);
  if (type !== "pubid:plateau:handbook" && type !== "pubid:plateau:technical-report") {
    throw new ParseFailed(`PLATEAU: unknown _type ${type}`, 0);
  }
  const id: PlateauIdentifier = { kind: type === "pubid:plateau:handbook" ? "handbook" : "technical-report", number: Number(hash["number"]) };
  if (hash["edition"] !== undefined && hash["edition"] !== null) id.edition = String(hash["edition"]);
  if (hash["annex"] !== undefined && hash["annex"] !== null) id.annex = Number(hash["annex"]);
  return id;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function toHuman(id: PlateauIdentifier): string {
  let result = `PLATEAU ${TYPE_STRINGS[id.kind]} #${pad2(id.number)}`;
  if (id.annex !== undefined) result += `-${id.annex}`;
  if (id.kind === "handbook" && id.edition !== undefined) result += ` 第${id.edition}版`;
  return result;
}

export function toUrn(id: PlateauIdentifier): string {
  const typeCode = id.kind === "handbook" ? "handbook" : "tr";
  const parts = ["urn", "plateau", typeCode, pad2(id.number)];
  if (id.annex !== undefined) parts.push(pad2(id.annex));
  return parts.join(":");
}

class PlateauIdentifierImpl implements Identifier {
  constructor(private readonly id: PlateauIdentifier) {}
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
    return new PlateauIdentifierImpl(fromHash(hash));
  }
}

export function plateauGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new PlateauIdentifierImpl(buildPlateauIdentifier(parseGrammar(plateauGrammar, input)));
    },
  };
}
