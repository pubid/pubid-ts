import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of lib/pubid/iho/ on the unified model. Five series classes
 * (S/P/M/B/C); "Appendix" renders as the canonical "Ap."; the URN
 * labels each optional segment (ap./part./annex./suppl.).
 */

type IhoKind = "standard" | "publication" | "miscellaneous" | "bibliographic" | "circular-letter";

const KIND_LETTERS: Record<IhoKind, string> = {
  standard: "S",
  publication: "P",
  miscellaneous: "M",
  bibliographic: "B",
  "circular-letter": "C",
};

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const dash = str("-");
  const dot = str(".");
  const digits = match("[0-9]").repeat(1, Infinity);

  rule("series", () => str("S").or(str("P"), str("M"), str("B"), str("C")).as("type"));
  rule(
    "number_suffix",
    () =>
      str(":").then(digits).or(str("/").then(digits)).or(dash.then(digits)).or(match("[A-Z]")),
  );
  rule("number", () => digits.then(rules["number_suffix"]!.maybe()).as("number"));
  rule(
    "appendix",
    () =>
      space
        .then(str("Appendix").or(str("Ap.")))
        .then(space, match("[A-Z]").then(dash, digits).or(digits).or(match("[A-Z]")).as("appendix")),
  );
  rule("part", () =>
    space.then(str("Part")).then(
      space,
      digits.then(match("[a-zA-Z]").repeat(0, Infinity)).as("part").or(match("[A-Z]").as("part")),
    ),
  );
  rule("annex", () => space.then(str("Annex")).then(space, match("[A-Z]").as("annex")));
  rule("supplement", () => space.then(str("Suppl")).then(space, digits.as("supplement")));
  rule("version", () => space.then(digits.then(dot, digits, dot, digits).as("version")));
  // The tail discriminators (pubid#635 + grammar#90): a dotted version,
  // a 4-digit year ("P-5 2024" — the identity form for the
  // year-identified series), or a volume with an optional issue
  // ("P-1 Vol. 30 (2)"; "Issue N" is an input alias only). A
  // two-segment version is deliberately unsupported — neither rule
  // swallows it.
  rule("year", () => space.then(str("19").or(str("20")).then(match("[0-9]").repeat(2)).as("year")));
  rule(
    "volume_tail",
    () =>
      space
        .then(str("Vol.").then(space, digits.as("volume")))
        .then(
          space
            .then(str("Issue"), space, digits.as("issue"))
            .or(space.then(str("("), digits.as("issue"), str(")")))
            .maybe(),
        ),
  );
  rule("tail", () => space.then(digits.then(dot, digits, dot, digits).as("version")).or(rules["year"]!, rules["volume_tail"]!));
  rule("identifier", () =>
    str("IHO")
      .then(space)
      .maybe()
      .then(rules["series"]!, dash, rules["number"]!)
      .then(rules["appendix"]!.maybe())
      .then(rules["part"]!.maybe())
      .then(rules["annex"]!.maybe())
      .then(rules["supplement"]!.maybe())
      .then(rules["tail"]!.maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ihoGrammar: Grammar = { rules: buildRules(), root: "root" };

function ihoClass(kind: IhoKind): IdentifierStatic {
  const letter = KIND_LETTERS[kind];
  class IhoKindIdentifier extends BaseIdentifier {
    static polymorphicName = `pubid:iho:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, {
      number: { type: "string" },
      appendix: { type: "string" },
      part: { type: "string" },
      annex: { type: "string" },
      supplement: { type: "string" },
      version: { type: "string" },
      year: { type: "string" },
      volume: { type: "string" },
      issue: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "appendix", to: "appendix" },
      { wire: "part", to: "part" },
      { wire: "annex", to: "annex" },
      { wire: "supplement", to: "supplement" },
      { wire: "version", to: "version" },
      { wire: "year", to: "year" },
      { wire: "volume", to: "volume" },
      { wire: "issue", to: "issue" },
    );

    declare readonly number: string;
    declare readonly appendix: string | undefined;
    declare readonly part: string | undefined;
    declare readonly annex: string | undefined;
    declare readonly supplement: string | undefined;
    declare readonly version: string | undefined;
    declare readonly year: string | undefined;
    declare readonly volume: string | undefined;
    declare readonly issue: string | undefined;

    render(): string {
      let result = `IHO ${letter}-${this.number}`;
      if (this.appendix !== undefined) result += ` Ap. ${this.appendix}`;
      if (this.part !== undefined) result += ` Part ${this.part}`;
      if (this.annex !== undefined) result += ` Annex ${this.annex}`;
      if (this.supplement !== undefined) result += ` Suppl ${this.supplement}`;
      // The tail picks exactly one discriminator: a dotted version, a
      // year, or a volume (with an optional issue). The issue prints
      // parenthesized; "Issue N" is an input alias only.
      if (this.version !== undefined) result += ` ${this.version}`;
      if (this.year !== undefined) result += ` ${this.year}`;
      if (this.volume !== undefined) result += ` Vol. ${this.volume}`;
      if (this.issue !== undefined) result += ` (${this.issue})`;
      return result;
    }
  }
  class IhoUrnGenerator extends BaseUrnGenerator<IhoKindIdentifier> {
    generate(): string {
      const id = this.identifier;
      const parts = ["urn", "iho", letter.toLowerCase(), id.number];
      if (id.appendix !== undefined) parts.push(`ap.${id.appendix}`);
      if (id.part !== undefined) parts.push(`part.${id.part}`);
      if (id.annex !== undefined) parts.push(`annex.${id.annex}`);
      if (id.supplement !== undefined) parts.push(`suppl.${id.supplement}`);
      // A volume carries an optional issue beside it; a version or a
      // year is a bare segment.
      if (id.volume !== undefined) parts.push(`vol.${id.volume}`);
      if (id.issue !== undefined) parts.push(`issue.${id.issue}`);
      if (id.version !== undefined) parts.push(id.version);
      if (id.year !== undefined) parts.push(id.year);
      return parts.join(":");
    }
  }
  (IhoKindIdentifier as unknown as Record<string, unknown>).urnGenerator = IhoUrnGenerator;
  registerType(IhoKindIdentifier as unknown as IdentifierStatic);
  return IhoKindIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES: Record<IhoKind, IdentifierStatic> = {
  standard: ihoClass("standard"),
  publication: ihoClass("publication"),
  miscellaneous: ihoClass("miscellaneous"),
  bibliographic: ihoClass("bibliographic"),
  "circular-letter": ihoClass("circular-letter"),
};

const LETTER_TO_CLASS = new Map<string, IdentifierStatic>(
  (Object.keys(KIND_LETTERS) as IhoKind[]).map((kind) => [KIND_LETTERS[kind], KIND_CLASSES[kind]]),
);

class IhoBuilder extends BaseBuilder {
  protected selectClass(data: Record<string, unknown>): IdentifierStatic {
    const kind = LETTER_TO_CLASS.get(String(data["type"]));
    if (kind === undefined) {
      throw new ParseFailed(`IHO: unknown series ${String(data["type"])}`, 0);
    }
    return kind;
  }

  protected defaultIdentifierClass(): IdentifierStatic {
    return KIND_CLASSES["standard"];
  }
}

export function ihoGrammarImplementation(): FlavorImplementation {
  const builder = new IhoBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(ihoGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("IHO: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
