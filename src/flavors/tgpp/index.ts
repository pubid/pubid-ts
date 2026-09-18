import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/tgpp/ on the unified model. Release tokens are
 * colon/slash-free by grammar; a version-shaped segment after ":" is
 * rejected (mistyped separator). URN drops TRAILING empty segments but
 * keeps interior ones ("urn:3gpp:ts:29.215::2.0.0"); the printed form
 * carries no publisher token. `parts` uses initializeEmpty (always []).
 */

type TgppKind = "technical-report" | "technical-specification";

const KIND_PREFIXES: Record<TgppKind, string> = {
  "technical-report": "TR",
  "technical-specification": "TS",
};

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const digits = match("[0-9]").repeat(1, Infinity);
  const space = str(" ");
  const any = match("[\\s\\S]");

  rule("publisher_prefix", () => str("3GPP").then(space));
  rule("type", () => str("TR").or(str("TS")).as("type"));
  rule("number_core", () => digits.then(str("."), digits).as("number"));
  rule("suffix", () => match("[A-Za-z]").repeat(1, Infinity).as("suffix"));
  rule("part", () => str("-").then(digits.as("part")));
  rule("parts", () => rules["part"]!.repeat(0, Infinity).as("parts"));
  rule("version_core", () => digits.then(str("."), digits, str("."), digits));
  rule(
    "release",
    () =>
      rules["version_core"]!
        .then(any.absent())
        .absent()
        .then(match("[^/:]").repeat(1, Infinity).as("release")),
  );
  rule("version", () => rules["version_core"]!.as("version"));
  rule(
    "identifier",
    () =>
      rules["publisher_prefix"]!
        .maybe()
        .then(rules["type"]!, space, rules["number_core"]!)
        .then(rules["suffix"]!.maybe())
        .then(rules["parts"]!)
        .then(str(":").then(rules["release"]!).maybe())
        .then(str("/").then(rules["version"]!).maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const tgppGrammar: Grammar = { rules: buildRules(), root: "root" };

function tgppClass(kind: TgppKind): IdentifierStatic {
  const prefix = KIND_PREFIXES[kind];
  class TgppKindIdentifier extends BaseIdentifier {
    static polymorphicName = `pubid:3gpp:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, {
      number: { type: "string" },
      suffix: { type: "string" },
      parts: { type: "string", collection: true, initializeEmpty: true },
      release: { type: "string" },
      version: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "suffix", to: "suffix" },
      { wire: "parts", to: "parts" },
      { wire: "release", to: "release" },
      { wire: "version", to: "version" },
    );

    declare readonly number: string;
    declare readonly suffix: string | undefined;
    declare readonly parts: string[];
    declare readonly release: string | undefined;
    declare readonly version: string | undefined;

    code(): string {
      let result = this.number + (this.suffix ?? "");
      if (this.parts.length > 0) result += this.parts.map((p) => `-${p}`).join("");
      return result;
    }

    render(): string {
      let result = `${prefix} ${this.code()}`;
      if (this.release !== undefined && this.release !== "") result += `:${this.release}`;
      if (this.version !== undefined && this.version !== "") result += `/${this.version}`;
      return result;
    }
  }
  class TgppUrnGenerator extends BaseUrnGenerator<TgppKindIdentifier> {
    generate(): string {
      const id = this.identifier;
      const tail: (string | undefined)[] = [id.release, id.version];
      while (tail.length > 0 && (tail[tail.length - 1] === undefined || tail[tail.length - 1] === "")) {
        tail.pop();
      }
      return ["urn", "3gpp", prefix.toLowerCase(), id.code(), ...tail.map((s) => s ?? "")].join(":");
    }
  }
  (TgppKindIdentifier as unknown as Record<string, unknown>).urnGenerator = TgppUrnGenerator;
  registerType(TgppKindIdentifier as unknown as IdentifierStatic);
  return TgppKindIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES: Record<TgppKind, IdentifierStatic> = {
  "technical-report": tgppClass("technical-report"),
  "technical-specification": tgppClass("technical-specification"),
};

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractParts(raw: Tree): string[] {
  if (Array.isArray(raw)) {
    return raw.map((p) => (isObj(p) ? String(p["part"]) : String(p)));
  }
  if (isObj(raw) && raw["part"] !== undefined) return [String(raw["part"])];
  return [];
}

class TgppBuilder extends BaseBuilder {
  protected selectClass(data: Record<string, unknown>): IdentifierStatic {
    return KIND_CLASSES[String(data["type"]) === "TR" ? "technical-report" : "technical-specification"];
  }

  protected defaultIdentifierClass(): IdentifierStatic {
    return KIND_CLASSES["technical-specification"];
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "parts") return { parts: extractParts(value as Tree) };
    return value;
  }
}

export function tgppGrammarImplementation(): FlavorImplementation {
  const builder = new TgppBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(tgppGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("3GPP: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
