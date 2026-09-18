import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * 1:1 port of lib/pubid/plateau/ on the unified model. Handbook/Technical
 * Report with INTEGER number/annex, 第X.Y版 editions, legacy Latin forms.
 * The handbook rule also matches TR text; the builder dispatches on :type
 * and drops the edition for TR. Annex supplements ("… Annex A") crash on
 * construction in Ruby (pubid#407) — rejected here to match. URN:
 * urn:plateau:handbook|tr:<nn>[:<aa>] with %02d padding.
 */

type PlateauKind = "handbook" | "technical-report";

const KIND_TYPES: Record<PlateauKind, string> = {
  handbook: "pubid:plateau:handbook",
  "technical-report": "pubid:plateau:technical-report",
};

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digits = match("[0-9]").repeat(1, Infinity);
  rule("doc_type", () => str("Handbook").or(str("Technical Report")).as("type"));
  rule("number", () => str("#").then(digits.as("number")));
  rule("annex", () => str("-").or(str("_")).then(digits.as("annex")));
  rule("edition_part", () =>
    str("第").then(
      digits.then(str("."), digits).as("edition"),
      str("版"),
    ),
  );
  rule("edition_latin", () => digits.then(str("."), digits).as("edition"));
  rule("edition", () => space.then(rules["edition_part"]!.or(rules["edition_latin"]!)));
  rule("annex_supplement", () =>
    space.then(str("Annex")).then(space, match("[A-Z]").as("annex_letter")),
  );
  rule("handbook", () =>
    str("PLATEAU")
      .then(space, rules["doc_type"]!, space, rules["number"]!)
      .then(rules["annex"]!.maybe())
      .then(rules["edition"]!.maybe()),
  );
  rule("identifier", () =>
    rules["handbook"]!
      .then(rules["annex_supplement"]!)
      .as("base")
      .or(rules["handbook"]!),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const plateauGrammar: Grammar = { rules: buildRules(), root: "root" };

const pad2 = (n: number): string => String(n).padStart(2, "0");

function plateauClass(kind: PlateauKind): IdentifierStatic {
  const isHandbook = kind === "handbook";
  class PlateauKindIdentifier extends BaseIdentifier {
    static polymorphicName = KIND_TYPES[kind];
    static attributes = extendAttributes(BaseIdentifier, {
      number: { type: "integer" },
      annex: { type: "integer" },
      edition: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "edition", to: "edition" },
      { wire: "annex", to: "annex" },
    );

    declare readonly number: number;
    declare readonly annex: number | undefined;
    declare readonly edition: string | undefined;

    render(): string {
      let result = `PLATEAU ${isHandbook ? "Handbook" : "Technical Report"} #${pad2(this.number)}`;
      if (this.annex !== undefined) result += `-${this.annex}`;
      if (isHandbook && this.edition !== undefined) result += ` 第${this.edition}版`;
      return result;
    }
  }
  class PlateauUrnGenerator extends BaseUrnGenerator<InstanceType<IdentifierStatic>> {
    generate(): string {
      const id = this.identifier as unknown as { number: number; annex?: number };
      const parts = ["urn", "plateau", isHandbook ? "handbook" : "tr", pad2(id.number)];
      if (id.annex !== undefined) parts.push(pad2(id.annex));
      return parts.join(":");
    }
  }
  (PlateauKindIdentifier as unknown as Record<string, unknown>).urnGenerator = PlateauUrnGenerator;
  registerType(PlateauKindIdentifier as unknown as IdentifierStatic);
  return PlateauKindIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES: Record<PlateauKind, IdentifierStatic> = {
  handbook: plateauClass("handbook"),
  "technical-report": plateauClass("technical-report"),
};

export function plateauGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(plateauGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("PLATEAU: unexpected parse tree", 0);
      }
      const data = tree as Record<string, unknown>;
      if (data["base"] !== undefined) {
        throw new ParseFailed("PLATEAU: Annex supplements are unsupported upstream", 0);
      }
      const kind: PlateauKind = String(data["type"]) === "Handbook" ? "handbook" : "technical-report";
      const attrs: Record<string, unknown> = { number: Number(data["number"]) };
      if (data["annex"] !== undefined && data["annex"] !== null) {
        attrs["annex"] = Number(data["annex"]);
      }
      // A legacy Latin TR edition is captured by the shared handbook
      // rule and dropped for Technical Report (Ruby builder parity).
      if (data["edition"] !== undefined && data["edition"] !== null && kind === "handbook") {
        attrs["edition"] = String(data["edition"]);
      }
      return new (KIND_CLASSES[kind] as new (attrs?: Record<string, unknown>) => BaseIdentifier)(attrs) as unknown as Identifier;
    },
  };
}
