import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/ecma/ on the unified model. Four printed forms
 * (standard[-part], TR/, MEM/) with optional decimal " ed<E>" and
 * " vol<V>"; the space separator ("ECMA 6") normalizes to the hyphen.
 * URN: urn:ecma[:tr|mem]:<n>[:part-P][:ed-E][:vol-V].
 */

type EcmaKind = "standard" | "technical-report" | "memento";

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
  rule(
    "edition",
    () =>
      str(" ed")
        .then(
          digits.then(str(".").then(digits).repeat(0, Infinity)).as("edition"),
        ),
  );
  rule("volume", () => str(" vol").then(digits.as("volume")));
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

function ecmaClass(kind: EcmaKind): IdentifierStatic {
  const prefix = KIND_PREFIXES[kind];
  class EcmaKindIdentifier extends BaseIdentifier {
    static polymorphicName = `pubid:ecma:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, {
      number: { type: "string" },
      part: { type: "string" },
      edition: { type: "string" },
      volume: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "part", to: "part" },
      { wire: "edition", to: "edition" },
      { wire: "volume", to: "volume" },
    );

    declare readonly number: string;
    declare readonly part: string | undefined;
    declare readonly edition: string | undefined;
    declare readonly volume: string | undefined;

    render(): string {
      let core: string;
      if (prefix === undefined) {
        core = `ECMA-${this.number}${this.part === undefined ? "" : `-${this.part}`}`;
      } else {
        core = `ECMA ${prefix}/${this.number}`;
      }
      if (this.edition !== undefined) core += ` ed${this.edition}`;
      if (this.volume !== undefined) core += ` vol${this.volume}`;
      return core;
    }
  }
  class EcmaUrnGenerator extends BaseUrnGenerator<EcmaKindIdentifier> {
    generate(): string {
      const parts = ["urn", "ecma"];
      if (prefix !== undefined) parts.push(prefix.toLowerCase());
      parts.push(this.identifier.number);
      if (this.identifier.part !== undefined) parts.push(`part-${this.identifier.part}`);
      if (this.identifier.edition !== undefined) parts.push(`ed-${this.identifier.edition}`);
      if (this.identifier.volume !== undefined) parts.push(`vol-${this.identifier.volume}`);
      return parts.join(":");
    }
  }
  (EcmaKindIdentifier as unknown as Record<string, unknown>).urnGenerator = EcmaUrnGenerator;
  registerType(EcmaKindIdentifier as unknown as IdentifierStatic);
  return EcmaKindIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES: Record<EcmaKind, IdentifierStatic> = {
  standard: ecmaClass("standard"),
  "technical-report": ecmaClass("technical-report"),
  memento: ecmaClass("memento"),
};

class EcmaBuilder extends BaseBuilder {
  protected selectClass(data: Record<string, unknown>): IdentifierStatic {
    if (data["tr_number"] !== undefined && data["tr_number"] !== null) {
      return KIND_CLASSES["technical-report"];
    }
    if (data["mem_number"] !== undefined && data["mem_number"] !== null) {
      return KIND_CLASSES["memento"];
    }
    return KIND_CLASSES["standard"];
  }

  protected defaultIdentifierClass(): IdentifierStatic {
    return KIND_CLASSES["standard"];
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "tr_number" || key === "mem_number") {
      return { number: String(value) };
    }
    return value;
  }
}

export function ecmaGrammarImplementation(): FlavorImplementation {
  const builder = new EcmaBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(ecmaGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("ECMA: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
