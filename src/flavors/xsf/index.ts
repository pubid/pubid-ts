import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/xsf/ on the unified model. XEP numbers, plus the
 * two named documents ("XEP README", "XEP xxxx") kept verbatim. URN:
 * urn:xsf:xep:<number> (the Ruby flavor's own generator).
 */

// The editor README and the xep-xxxx template reach pubid as real
// primary docids.
const SPECIAL_NUMBERS = ["README", "xxxx"];

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const specialNumber = SPECIAL_NUMBERS.map((name) => str(name)).reduce((a, b) => a.or(b));
  rule("special_number", () => specialNumber);
  const digits = match("[0-9]").repeat(1, Infinity);
  rule("digits", () => digits);
  rule("identifier", () =>
    str("XEP").then(str(" "), digits.or(specialNumber).as("number")),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const xsfGrammar: Grammar = {
  rules: buildRules(),
  root: "root",
};

class XsfUrnGenerator extends BaseUrnGenerator<XsfIdentifier> {
  generate(): string {
    return ["urn", "xsf", "xep", this.identifier.number].join(":");
  }
}

export class XsfIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:xsf:xep";
  static attributes = extendAttributes(BaseIdentifier, {
    number: { type: "string" },
  });
  static mappings = keyValue({ wire: "number", to: "number" });
  static urnGenerator = XsfUrnGenerator;

  declare readonly number: string;

  render(): string {
    return `XEP ${this.number}`;
  }
}

registerType(XsfIdentifier as unknown as IdentifierStatic);

class XsfBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return XsfIdentifier as unknown as IdentifierStatic;
  }
}

export function xsfGrammarImplementation(): FlavorImplementation {
  const builder = new XsfBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(xsfGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("XSF: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
