import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/doi/ on the unified model. DOIs per ISO 26324;
 * the Ruby flavor has no urn_generator, so toUrn() resolves to the base
 * template ("urn:doi" — no attribute hits a template slot).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const slash = str("/");
  rule("url_prefix", () =>
    str("https://").or(str("http://")).maybe().then(str("doi.org").maybe()),
  );
  rule("scheme_prefix", () =>
    str("doi:").or(str("DOI:")).or(str("Doi:")).maybe(),
  );
  const dot = str(".");
  rule("prefix", () => str("10").then(dot, match("[0-9]").repeat(2, Infinity).as("prefix_digits")));
  rule("suffix", () =>
    match("[A-Za-z0-9._\\-/()]").repeat(1, Infinity).as("suffix"),
  );
  rule("identifier", () =>
    rules["url_prefix"]!
      .maybe()
      .then(
        rules["scheme_prefix"]!.maybe(),
        slash.maybe(),
        rules["prefix"]!,
        slash,
        rules["suffix"]!,
      ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const doiGrammar: Grammar = {
  rules: buildRules(),
  root: "root",
};

export class DoiIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:doi:resource";
  static attributes = extendAttributes(BaseIdentifier, {
    prefix: { type: "string" },
    suffix: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "prefix", to: "prefix" },
    { wire: "suffix", to: "suffix" },
  );

  render(): string {
    return `doi:${this.prefix}/${this.suffix}`;
  }

  declare readonly prefix: string;
  declare readonly suffix: string;
}
registerType(DoiIdentifier as unknown as IdentifierStatic);

class DoiBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return DoiIdentifier as unknown as IdentifierStatic;
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "prefix_digits") return { prefix: `10.${String(value)}` };
    return value;
  }
}

export function doiGrammarImplementation(): FlavorImplementation {
  const builder = new DoiBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(doiGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("DOI: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
