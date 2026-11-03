import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";

/**
 * 1:1 port of pubid-grammar's iho.parg (edition 2, v0.2.0) on the
 * unified model. Five series classes (S/P/M/B/C). Component-edition
 * duality: supplement, part, annex, appendix and volume each carry
 * their own edition (+ year qualifier); the base tail is
 * [volume_short] [dated] [supplement] [part] [annex] [appendix]
 * [serial] [year_qualifier]. Canonical faces: "Appendix" spelled out,
 * "Sup" for supplements, "Vol. N" for volumes (the slash chain and
 * the bare year are parse-only aliases), editions render bare dotted
 * in the human face and `ed-x.y.z` in the URN; the URN mirrors the
 * containment tree with marker-prefixed segments
 * (urn:iho:<type>:<number>[:ed-...][:year-...][:sup-...][:part-...]
 * [:annex-...][:appendix-...[:sub]][:vol-...[:issue-...]]).
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
  const letters = match("[A-Za-z]").repeat(0, Infinity);
  const seriesLetter = str("S").or(str("P"), str("M"), str("B"), str("C"));
  const year4 = str("19").or(str("20")).then(match("[0-9]").repeat(2));

  rule("series", () => seriesLetter.as("type"));
  rule("number_suffix", () => str(":").then(digits));
  rule("number", () => digits.then(rules["number_suffix"]!.maybe()).as("number"));

  // The compact part face, hyphenated onto the code: S-5-B (lettered),
  // S-100-1 (numbered) and S-158-S-102 (series reference).
  rule(
    "compact_part",
    () =>
      dash.then(
        seriesLetter
          .then(dash, digits)
          .or(digits.then(letters), match("[A-Z]"))
          .as("part"),
      ),
  );
  // LEGACY glued lettered bases (S-5A): parse-only alias, rendered as
  // "Part A".
  rule("glued", () => match("[A-Z]").as("part"));

  rule(
    "edition",
    () => space.then(digits.then(dot, digits, dot, digits).as("edition")),
  );
  rule(
    "v_edition",
    () =>
      space.then(
        str("v").then(digits.then(str(".").then(digits).maybe()).as("edition_shorthand")),
      ),
  );
  rule(
    "year_qualifier",
    () => space.then(str("(").then(year4.as("year"), str(")"))),
  );

  rule(
    "part_series_ref",
    () => seriesLetter.then(dash, digits),
  );
  rule(
    "part_value",
    () => rules["part_series_ref"]!.or(digits.then(letters), match("[A-Z]")).as("part"),
  );
  rule("part_edition_rule", () =>
    space.then(digits.then(dot, digits, dot, digits).as("part_edition")),
  );
  rule("part_year_rule", () =>
    space.then(str("(").then(year4.as("part_year"), str(")"))),
  );
  rule("part_dated", () =>
    rules["part_edition_rule"]!.then(rules["part_year_rule"]!.maybe()),
  );
  rule("part", () =>
    space.then(str("Part")).then(space, rules["part_value"]!, rules["part_dated"]!.maybe()),
  );

  rule("supplement_edition_rule", () =>
    space.then(digits.then(dot, digits, dot, digits).as("supplement_edition")),
  );
  rule("supplement_year_rule", () =>
    space.then(str("(").then(year4.as("supplement_year"), str(")"))),
  );
  rule("supplement_dated", () =>
    rules["supplement_edition_rule"]!.then(rules["supplement_year_rule"]!.maybe()),
  );
  rule("supplement", () =>
    space
      .then(str("Suppl").or(str("Sup")))
      .then(space, digits.as("supplement"), rules["supplement_dated"]!.maybe()),
  );

  rule("annex_edition_rule", () =>
    space.then(digits.then(dot, digits, dot, digits).as("annex_edition")),
  );
  rule("annex_year_rule", () =>
    space.then(str("(").then(year4.as("annex_year"), str(")"))),
  );
  rule("annex_dated", () =>
    rules["annex_edition_rule"]!.then(rules["annex_year_rule"]!.maybe()),
  );
  rule("annex", () =>
    space.then(str("Annex")).then(space, match("[A-Z]").as("annex"), rules["annex_dated"]!.maybe()),
  );

  rule("appendix_value", () => match("[A-Z]").or(digits).as("appendix"));
  rule("appendix_subnumber", () => dash.then(digits.as("appendix_subnumber")));
  rule("appendix_edition_rule", () =>
    space.then(digits.then(dot, digits, dot, digits).as("appendix_edition")),
  );
  rule("appendix_year_rule", () =>
    space.then(str("(").then(year4.as("appendix_year"), str(")"))),
  );
  rule("appendix_dated", () =>
    rules["appendix_edition_rule"]!.then(rules["appendix_year_rule"]!.maybe()),
  );
  rule("appendix", () =>
    space
      .then(str("Appendix").or(str("App"), str("Ap.")))
      .then(
        space,
        rules["appendix_value"]!,
        rules["appendix_subnumber"]!.maybe(),
        rules["appendix_dated"]!.maybe(),
      ),
  );

  rule("volume_issue", () =>
    space
      .then(str("Issue"))
      .then(space, digits.as("issue"))
      .or(space.then(str("("), digits.as("issue"), str(")"))),
  );
  rule("volume_edition_rule", () =>
    space.then(digits.then(dot, digits, dot, digits).as("volume_edition")),
  );
  rule("volume_year_rule", () =>
    space.then(str("(").then(year4.as("volume_year"), str(")"))),
  );
  rule("volume_dated", () =>
    rules["volume_edition_rule"]!.then(rules["volume_year_rule"]!.maybe()),
  );
  rule("volume", () =>
    space.then(str("Vol.")).then(space, digits.as("volume"), rules["volume_issue"]!.maybe()),
  );
  // The volume's short face — the slash chain ("IHO P-1/21").
  rule("volume_short", () =>
    str("/").then(digits.as("volume"), rules["volume_dated"]!.maybe()),
  );
  // LEGACY bare year ("IHO P-5 2024"): the yearbook year IS a volume.
  rule("volume_bare_year", () => space.then(year4.as("volume")));
  rule("serial", () =>
    rules["volume"]!.or(rules["volume_bare_year"]!).then(rules["volume_dated"]!.maybe()),
  );

  rule("dated", () =>
    rules["edition"]!.or(rules["v_edition"]!).then(rules["year_qualifier"]!.maybe()),
  );

  rule("identifier", () =>
    str("IHO")
      .then(space)
      .maybe()
      .then(
        rules["series"]!,
        dash,
        rules["number"]!,
        rules["compact_part"]!.maybe(),
        rules["glued"]!.maybe(),
        rules["volume_short"]!.maybe(),
        rules["dated"]!.maybe(),
        rules["supplement"]!.maybe(),
        rules["part"]!.maybe(),
        rules["annex"]!.maybe(),
        rules["appendix"]!.maybe(),
        rules["serial"]!.maybe(),
        rules["year_qualifier"]!.maybe(),
      ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ihoGrammar: Grammar = { rules: buildRules(), root: "root" };

function padEditionShorthand(value: string): string {
  const segments = value.split(".");
  while (segments.length < 3) segments.push("0");
  return segments.join(".");
}

function ihoClass(kind: IhoKind): IdentifierStatic {
  const letter = KIND_LETTERS[kind];
  class IhoKindIdentifier extends BaseIdentifier {
    static polymorphicName = `pubid:iho:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, {
      number: { type: "string" },
      part: { type: "string" },
      part_edition: { type: "string" },
      part_year: { type: "string" },
      annex: { type: "string" },
      annex_edition: { type: "string" },
      annex_year: { type: "string" },
      appendix: { type: "string" },
      appendix_subnumber: { type: "string" },
      appendix_edition: { type: "string" },
      appendix_year: { type: "string" },
      supplement: { type: "string" },
      supplement_edition: { type: "string" },
      supplement_year: { type: "string" },
      edition: { type: "string" },
      year: { type: "string" },
      volume: { type: "string" },
      volume_edition: { type: "string" },
      volume_year: { type: "string" },
      issue: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "part", to: "part" },
      { wire: "part_edition", to: "part_edition" },
      { wire: "part_year", to: "part_year" },
      { wire: "annex", to: "annex" },
      { wire: "annex_edition", to: "annex_edition" },
      { wire: "annex_year", to: "annex_year" },
      { wire: "appendix", to: "appendix" },
      { wire: "appendix_subnumber", to: "appendix_subnumber" },
      { wire: "appendix_edition", to: "appendix_edition" },
      { wire: "appendix_year", to: "appendix_year" },
      { wire: "supplement", to: "supplement" },
      { wire: "supplement_edition", to: "supplement_edition" },
      { wire: "supplement_year", to: "supplement_year" },
      { wire: "edition", to: "edition" },
      { wire: "year", to: "year" },
      { wire: "volume", to: "volume" },
      { wire: "volume_edition", to: "volume_edition" },
      { wire: "volume_year", to: "volume_year" },
      { wire: "issue", to: "issue" },
    );

    declare readonly number: string;
    declare readonly part: string | undefined;
    declare readonly part_edition: string | undefined;
    declare readonly part_year: string | undefined;
    declare readonly annex: string | undefined;
    declare readonly annex_edition: string | undefined;
    declare readonly annex_year: string | undefined;
    declare readonly appendix: string | undefined;
    declare readonly appendix_subnumber: string | undefined;
    declare readonly appendix_edition: string | undefined;
    declare readonly appendix_year: string | undefined;
    declare readonly supplement: string | undefined;
    declare readonly supplement_edition: string | undefined;
    declare readonly supplement_year: string | undefined;
    declare readonly edition: string | undefined;
    declare readonly year: string | undefined;
    declare readonly volume: string | undefined;
    declare readonly volume_edition: string | undefined;
    declare readonly volume_year: string | undefined;
    declare readonly issue: string | undefined;

    render(): string {
      let result = `IHO ${letter}-${this.number}`;
      if (this.edition !== undefined) result += ` ${this.edition}`;
      if (this.supplement !== undefined) {
        result += ` Sup ${this.supplement}`;
        if (this.supplement_edition !== undefined) result += ` ${this.supplement_edition}`;
        if (this.supplement_year !== undefined) result += ` (${this.supplement_year})`;
      }
      if (this.part !== undefined) {
        result += ` Part ${this.part}`;
        if (this.part_edition !== undefined) result += ` ${this.part_edition}`;
        if (this.part_year !== undefined) result += ` (${this.part_year})`;
      }
      if (this.annex !== undefined) {
        result += ` Annex ${this.annex}`;
        if (this.annex_edition !== undefined) result += ` ${this.annex_edition}`;
        if (this.annex_year !== undefined) result += ` (${this.annex_year})`;
      }
      if (this.appendix !== undefined) {
        result += ` Appendix ${this.appendix}`;
        if (this.appendix_subnumber !== undefined) result += `-${this.appendix_subnumber}`;
        if (this.appendix_edition !== undefined) result += ` ${this.appendix_edition}`;
        if (this.appendix_year !== undefined) result += ` (${this.appendix_year})`;
      }
      if (this.volume !== undefined) {
        result += ` Vol. ${this.volume}`;
        if (this.issue !== undefined) result += ` (${this.issue})`;
        if (this.volume_edition !== undefined) result += ` ${this.volume_edition}`;
        if (this.volume_year !== undefined) result += ` (${this.volume_year})`;
      }
      // The base year qualifier prints last, parenthesized ("IHO
      // S-100 1.0.0 Part A (2024)").
      if (this.year !== undefined) result += ` (${this.year})`;
      return result;
    }
  }
  class IhoUrnGenerator extends BaseUrnGenerator<IhoKindIdentifier> {
    generate(): string {
      const id = this.identifier;
      const parts = ["urn", "iho", letter.toLowerCase(), id.number];
      // Each component is a marker-prefixed segment; its own edition
      // (ed-) and year (year-) follow it directly. The base edition
      // and year come first (they attach to the base node).
      if (id.edition !== undefined) parts.push(`ed-${id.edition}`);
      if (id.year !== undefined) parts.push(`year-${id.year}`);
      if (id.supplement !== undefined) {
        parts.push(`sup-${id.supplement}`);
        if (id.supplement_edition !== undefined) parts.push(`ed-${id.supplement_edition}`);
        if (id.supplement_year !== undefined) parts.push(`year-${id.supplement_year}`);
      }
      if (id.part !== undefined) {
        parts.push(`part-${id.part}`);
        if (id.part_edition !== undefined) parts.push(`ed-${id.part_edition}`);
        if (id.part_year !== undefined) parts.push(`year-${id.part_year}`);
      }
      if (id.annex !== undefined) {
        parts.push(`annex-${id.annex}`);
        if (id.annex_edition !== undefined) parts.push(`ed-${id.annex_edition}`);
        if (id.annex_year !== undefined) parts.push(`year-${id.annex_year}`);
      }
      if (id.appendix !== undefined) {
        parts.push(`appendix-${id.appendix}`);
        // The subnumber is a bare child segment directly after the
        // appendix ("appendix-D:2").
        if (id.appendix_subnumber !== undefined) parts.push(id.appendix_subnumber);
        if (id.appendix_edition !== undefined) parts.push(`ed-${id.appendix_edition}`);
        if (id.appendix_year !== undefined) parts.push(`year-${id.appendix_year}`);
      }
      if (id.volume !== undefined) {
        parts.push(`vol-${id.volume}`);
        if (id.issue !== undefined) parts.push(`issue-${id.issue}`);
        if (id.volume_edition !== undefined) parts.push(`ed-${id.volume_edition}`);
        if (id.volume_year !== undefined) parts.push(`year-${id.volume_year}`);
      }
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

  build(
    data: Record<string, unknown> | Record<string, unknown>[],
  ): BaseIdentifier {
    const flat: Record<string, unknown> = Array.isArray(data)
      ? Object.assign({}, ...data)
      : { ...data };
    // A component year without its component edition attaches to the
    // nearest preceding edition node — the base ("IHO S-100 1.0.0
    // Part A (2024)" binds the base year, never part_year). With the
    // component's own edition present it stays component-scoped
    // ("IHO S-98 Part A 1.0.0 (2024)" keeps part_year).
    for (const component of ["part", "supplement", "annex", "appendix", "volume"]) {
      const yearKey = `${component}_year`;
      if (
        flat[yearKey] !== undefined &&
        flat[`${component}_edition`] === undefined &&
        flat["edition"] !== undefined
      ) {
        if (flat["year"] === undefined) flat["year"] = flat[yearKey];
        delete flat[yearKey];
      }
    }
    return super.build(flat);
  }

  protected cast(key: string, value: unknown): unknown {
    if (key === "type") return null; // the kind is encoded in _type
    if (key === "edition_shorthand") {
      return { edition: padEditionShorthand(String(value)) };
    }
    return value;
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
