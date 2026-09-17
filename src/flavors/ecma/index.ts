import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/ecma/. Four printed forms:
 *   ECMA-411 / ECMA-418-1 (standard, optional part)
 *   ECMA TR/101 (technical report) / ECMA MEM/1970 (memento)
 * any of which may carry " ed<E>" (decimal editions exist: ECMA-262 ed5.1)
 * then " vol<V>". The space separator ("ECMA 6") parses and normalizes to
 * the hyphen. Numbers stay strings to preserve leading zeros.
 */

type EcmaKind = "standard" | "technical-report" | "memento";

const KIND_TYPES: Record<EcmaKind, string> = {
  standard: "pubid:ecma:standard",
  "technical-report": "pubid:ecma:technical-report",
  memento: "pubid:ecma:memento",
};

const KIND_PREFIXES: Record<EcmaKind, string | undefined> = {
  standard: undefined,
  "technical-report": "TR",
  memento: "MEM",
};

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const digits = match("[0-9]").repeat(1, Infinity);

  rule("digits", () => digits);
  rule("prefix", () => str("ECMA"));
  rule("tr", () => str(" TR/").then(digits.as("tr_number")));
  rule("mem", () => str(" MEM/").then(digits.as("mem_number")));
  rule("standard_separator", () => str("-").or(str(" ")));
  rule(
    "standard",
    () =>
      rules["standard_separator"]!
        .then(digits.as("number"))
        .then(str("-").then(digits.as("part")).maybe()),
  );
  // Editions are not all integers (ECMA-402 ed5.1); stored verbatim.
  rule(
    "edition",
    () =>
      str(" ed")
        .then(
          digits.then(str(".").then(digits).repeat(0, Infinity)).as("edition"),
        ),
  );
  rule("volume", () => str(" vol").then(digits.as("volume")));
  // The DISJOINT FIRST CHARACTER of " TR/" and " MEM/" against the digit
  // demand of `standard` is what keeps the branches unambiguous.
  rule(
    "identifier",
    () =>
      rules["prefix"]!
        .then(rules["tr"]!.or(rules["mem"]!, rules["standard"]!))
        .then(rules["edition"]!.maybe())
        .then(rules["volume"]!.maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ecmaGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface EcmaIdentifier {
  kind: EcmaKind;
  number: string;
  part?: string;
  edition?: string;
  volume?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function kindForType(type: string): EcmaKind {
  const kind = type.slice("pubid:ecma:".length) as EcmaKind;
  if (!(kind in KIND_TYPES)) {
    throw new ParseFailed(`ECMA: unknown _type ${type}`, 0);
  }
  return kind;
}

export function buildEcmaIdentifier(tree: Tree): EcmaIdentifier {
  if (!isObj(tree)) throw new ParseFailed("ECMA: unexpected parse tree", 0);
  let id: EcmaIdentifier;
  if (tree["tr_number"] !== undefined && tree["tr_number"] !== null) {
    id = { kind: "technical-report", number: String(tree["tr_number"]) };
  } else if (tree["mem_number"] !== undefined && tree["mem_number"] !== null) {
    id = { kind: "memento", number: String(tree["mem_number"]) };
  } else if (tree["number"] !== undefined && tree["number"] !== null) {
    id = { kind: "standard", number: String(tree["number"]) };
    if (tree["part"] !== undefined && tree["part"] !== null) {
      id.part = String(tree["part"]);
    }
  } else {
    throw new ParseFailed("ECMA: unexpected parse tree", 0);
  }
  if (tree["edition"] !== undefined && tree["edition"] !== null) {
    id.edition = String(tree["edition"]);
  }
  if (tree["volume"] !== undefined && tree["volume"] !== null) {
    id.volume = String(tree["volume"]);
  }
  return id;
}

export function toHash(id: EcmaIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = { _type: KIND_TYPES[id.kind], number: id.number };
  if (id.part !== undefined) hash["part"] = id.part;
  if (id.edition !== undefined) hash["edition"] = id.edition;
  if (id.volume !== undefined) hash["volume"] = id.volume;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): EcmaIdentifier {
  const id: EcmaIdentifier = {
    kind: kindForType(String(hash["_type"])),
    number: String(hash["number"]),
  };
  if (hash["part"] !== undefined && hash["part"] !== null) {
    id.part = String(hash["part"]);
  }
  if (hash["edition"] !== undefined && hash["edition"] !== null) {
    id.edition = String(hash["edition"]);
  }
  if (hash["volume"] !== undefined && hash["volume"] !== null) {
    id.volume = String(hash["volume"]);
  }
  return id;
}

export function toHuman(id: EcmaIdentifier): string {
  const prefix = KIND_PREFIXES[id.kind];
  let core: string;
  if (prefix === undefined) {
    core = `ECMA-${id.number}${id.part === undefined ? "" : `-${id.part}`}`;
  } else {
    core = `ECMA ${prefix}/${id.number}`;
  }
  if (id.edition !== undefined) core += ` ed${id.edition}`;
  if (id.volume !== undefined) core += ` vol${id.volume}`;
  return core;
}

export function toUrn(id: EcmaIdentifier): string {
  const prefix = KIND_PREFIXES[id.kind];
  const parts = ["urn", "ecma"];
  if (prefix !== undefined) parts.push(prefix.toLowerCase());
  parts.push(id.number);
  if (id.part !== undefined) parts.push(`part-${id.part}`);
  if (id.edition !== undefined) parts.push(`ed-${id.edition}`);
  if (id.volume !== undefined) parts.push(`vol-${id.volume}`);
  return parts.join(":");
}

class EcmaIdentifierImpl implements Identifier {
  constructor(private readonly id: EcmaIdentifier) {}
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
    return new EcmaIdentifierImpl(fromHash(hash));
  }
}

export function ecmaGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new EcmaIdentifierImpl(buildEcmaIdentifier(parseGrammar(ecmaGrammar, input)));
    },
  };
}
