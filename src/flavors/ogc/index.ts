import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/ogc/ on the unified model. "<yy>-<nnn>[<revision>]"
 * with no publisher token in the printed form; strings preserve zero
 * padding; the revision normalizes to lower case. URN:
 * urn:ogc:<year>:<number>[:<revision>] (the Ruby flavor's generator).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = match("[\\s]").repeat(1, Infinity);
  const digits = match("[0-9]").repeat(1, Infinity);
  const revision = match("[A-Za-z0-9]").repeat(1, Infinity).as("revision");

  rule("publisher", () => str("OGC").then(space).maybe());
  rule("identifier", () =>
    rules["publisher"]!
      .then(digits.as("year"), str("-"), digits.as("number"))
      .then(revision.maybe())
      .then(space.maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ogcGrammar: Grammar = { rules: buildRules(), root: "root" };

class OgcUrnGenerator extends BaseUrnGenerator<OgcIdentifier> {
  generate(): string {
    const parts = ["urn", "ogc", this.identifier.year, this.identifier.number];
    if (this.identifier.revision !== undefined) parts.push(this.identifier.revision);
    return parts.join(":");
  }
}

export class OgcIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:ogc:document";
  static attributes = extendAttributes(BaseIdentifier, {
    year: { type: "string" },
    number: { type: "string" },
    revision: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "year", to: "year" },
    { wire: "number", to: "number" },
    { wire: "revision", to: "revision" },
  );
  static urnGenerator = OgcUrnGenerator;

  declare readonly year: string;
  declare readonly number: string;
  declare readonly revision: string | undefined;

  render(): string {
    return `${this.year}-${this.number}${this.revision ?? ""}`;
  }
}
registerType(OgcIdentifier as unknown as IdentifierStatic);

class OgcBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return OgcIdentifier as unknown as IdentifierStatic;
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "revision") {
      const normalized = String(value).trim().toLowerCase();
      return normalized === "" ? null : { revision: normalized };
    }
    return value;
  }
}

export function ogcGrammarImplementation(): FlavorImplementation {
  const builder = new OgcBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(ogcGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("OGC: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
