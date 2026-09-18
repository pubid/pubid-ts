import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { Tree } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseBuilder } from "../../model/builder.js";
import { PubidDate } from "../../model/component.js";

/**
 * 1:1 port of lib/pubid/un/ on the unified model. The builder derives a
 * runtime `date` (a 4-digit path token) exactly like Ruby; un's key_value
 * maps ONLY path/number, so the date never serializes (the mapping
 * whitelist) while the base URN generator still reads it: the year-only
 * render of a degenerate PubidDate yields "urn:un:<number>[:<year>]".
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const slash = str("/");
  const token = match("[A-Z0-9.]").repeat(1, Infinity);
  rule("un_prefix", () => str("UN").then(str(" ")).maybe());
  rule("identifier", () =>
    rules["un_prefix"]!
      .then(
        token.as("token"),
        slash.then(token.as("token")).repeat(1, Infinity),
      ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const unGrammar: Grammar = { rules: buildRules(), root: "root" };

export class UnIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:un:document";
  static attributes = extendAttributes(BaseIdentifier, {
    path: { type: "string", collection: true, default: [] },
    number: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "path", to: "path" },
    { wire: "number", to: "number" },
  );

  declare readonly path: string[];
  declare readonly number: string;

  render(): string {
    return [...this.path, this.number].join("/");
  }
}
registerType(UnIdentifier as unknown as IdentifierStatic);

class UnBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return UnIdentifier as unknown as IdentifierStatic;
  }

  protected cast(key: string, value: unknown): unknown {
    if (key !== "token") return value;
    void value;
    return null; // handled in handleKey below (needs the full token list)
  }

  protected handleKey(_identifier: BaseIdentifier, key: string, value: unknown): boolean {
    return key === "token";
  }

  build(data: Record<string, unknown> | Record<string, unknown>[] | Tree): BaseIdentifier {
    // The parslet tree is a top-level ARRAY of {token: …} hashes (the
    // repeat-of-captures shape); extract directly — merging would
    // collide the repeated key (Ruby's builder iterates the array too).
    const tokens = this.extractTokens(Array.isArray(data) ? data : (data as Record<string, unknown>)["token"]);
    if (tokens.length === 0) throw new ParseFailed("UN identifier has no tokens", 0);
    const path = tokens.slice(0, -1);
    // Only a PATH token is the date year ("TRADE/WP.4/1068" has none —
    // a 4-digit NUMBER is not a year).
    const yearToken = [...path].reverse().find((t) => /^\d{4}$/.test(t));
    const attrs: Record<string, unknown> = {
      number: tokens[tokens.length - 1]!,
      path,
    };
    if (yearToken) attrs["date"] = new PubidDate({ year: yearToken });
    return new UnIdentifier(attrs);
  }

  private extractTokens(raw: unknown): string[] {
    const toStrings = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.flatMap(toStrings)
        : typeof v === "object" && v !== null
          ? toStrings((v as Record<string, unknown>)["token"])
          : v === undefined || v === null
            ? []
            : [String(v)];
    return toStrings(raw);
  }
}

export function unGrammarImplementation(): FlavorImplementation {
  const builder = new UnBuilder();
  return {
    parse(input: string): Identifier {
      return builder.build(parseGrammar(unGrammar, input)) as unknown as Identifier;
    },
  };
}
