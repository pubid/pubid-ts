import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/iana/ on the unified model. Registry slugs; the
 * top-level slug is stored as `number`, the optional sub-slug under the
 * `sub_registry` wire name. URN: urn:iana:<slug>[:<sub-slug>] (the Ruby
 * flavor's own urn_generator, mirrored as a template subclass).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const slug = match("[a-zA-Z0-9._\\-]").repeat(1, Infinity);
  rule("slug", () => slug);
  rule("iana_prefix", () => str("IANA").then(str(" ")).maybe());
  rule("identifier", () =>
    rules["iana_prefix"]!
      .then(slug.as("registry"), str("/").then(slug.as("sub_registry")).maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ianaGrammar: Grammar = { rules: buildRules(), root: "root" };

class IanaUrnGenerator extends BaseUrnGenerator<IanaIdentifier> {
  generate(): string {
    const parts = ["urn", "iana", this.identifier.number];
    if (this.identifier.sub_registry !== undefined) parts.push(this.identifier.sub_registry);
    return parts.join(":");
  }
}

export class IanaIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:iana:registry";
  static attributes = extendAttributes(BaseIdentifier, {
    number: { type: "string" },
    sub_registry: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "sub_registry", to: "sub_registry" },
  );
  static urnGenerator = IanaUrnGenerator;

  declare readonly number: string;
  declare readonly sub_registry: string | undefined;

  render(): string {
    return this.sub_registry === undefined
      ? `IANA ${this.number}`
      : `IANA ${this.number}/${this.sub_registry}`;
  }
}

registerType(IanaIdentifier as unknown as IdentifierStatic);

class IanaBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return IanaIdentifier as unknown as IdentifierStatic;
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "registry") return { number: String(value) };
    return value;
  }
}

export function ianaGrammarImplementation(): FlavorImplementation {
  const builder = new IanaBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(ianaGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("IANA: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
