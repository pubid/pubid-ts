import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/omg/ on the unified model. The Ruby flavor has
 * no urn_generator, so toUrn() resolves to the base template: only
 * `part` hits a slot, deriving "urn:omg:-PDF" / bare "urn:omg".
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const acronymChar = match("[A-Za-z0-9+]");
  const wordBoundary = match("[A-Za-z0-9]").absent();
  const beta = str(" beta").then(
    wordBoundary,
    space.then(match("[0-9]").repeat(1, Infinity), wordBoundary).maybe(),
  );
  const partSeparator = space.or(str("/"));

  rule("acronym", () =>
    match("[A-Za-z]")
      .then(
        acronymChar.repeat(0, Infinity),
        match("[-/]")
          .then(acronymChar.repeat(1, Infinity))
          .repeat(0, Infinity),
      )
      .as("acronym"),
  );
  rule("version", () =>
    match("[0-9]")
      .repeat(1, Infinity)
      .then(
        str(".").then(match("[0-9]").repeat(1, Infinity)).repeat(0, Infinity),
        beta.maybe(),
      )
      .as("version"),
  );
  rule("part", () => match("[A-Za-z0-9]").repeat(1, Infinity).as("part"));
  rule("identifier", () =>
    str("OMG").then(
      space,
      rules["acronym"]!,
      space
        .then(rules["version"]!, partSeparator.then(rules["part"]!).maybe())
        .or(space.then(rules["part"]!))
        .maybe(),
    ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const omgGrammar: Grammar = { rules: buildRules(), root: "root" };

export class OmgIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:omg:specification";
  static attributes = extendAttributes(BaseIdentifier, {
    acronym: { type: "string" },
    version: { type: "string" },
    part: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "acronym", to: "acronym" },
    { wire: "version", to: "version" },
    { wire: "part", to: "part" },
  );

  declare readonly acronym: string;
  declare readonly version: string | undefined;
  declare readonly part: string | undefined;

  render(): string {
    let result = `OMG ${this.acronym}`;
    if (this.version !== undefined) result += ` ${this.version}`;
    if (this.part !== undefined) result += ` ${this.part}`;
    return result;
  }
}
registerType(OmgIdentifier as unknown as IdentifierStatic);

class OmgBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return OmgIdentifier as unknown as IdentifierStatic;
  }
}

export function omgGrammarImplementation(): FlavorImplementation {
  const builder = new OmgBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(omgGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("OMG: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
