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
 * in the human face.
 *
 * The MRN follows the IHO MRN guidance (S-100WG4): the publications
 * namespace urn:mrn:iho:pub: with type spec, the name segment the
 * lowercased letter + number with colon members hyphenated in (the
 * fleet extension for compound publication numbers, pubid#774 —
 * "S-158:102" names s158-102), the base edition the bare dotted
 * segment right after the name, and every other component a trailing
 * token (year<yyyy>, supplement<n>, part<X>, spec<n>[.sub][(variant)],
 * annex<A>, appendix<B>[:<sub>], vol<n>, issue<n>; a component
 * edition is the bare dotted segment after its component token).
 *
 * The S-158 family (pubid#774): checks_for is the typed facet for the
 * S-100 product number whose validation checks the publication
 * specifies; "S-158:<NNN>" is the primary designator (number=158,
 * checks_for=NNN — never an opaque number, never a part), and the
 * legacy draft-era spellings "S-158 Part S-102" / "S-158-S-102" bind
 * the SAME identity as non-normalized aliases (render keeps the input
 * spelling; equality/URN are canonical).
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
  // The colon member captures SEPARATELY ("S-158:102" → number "158" +
  // colon_suffix "102"): the builder re-keys the S-158 member into
  // checks_for and re-glues every other series' member into the number
  // (the C-16:2 opaque face, pubid#637).
  rule("number_suffix", () => str(":").then(digits.as("colon_suffix")));
  rule("number", () => digits.as("number").then(rules["number_suffix"]!.maybe()));

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
  // --- S-4 loose-leaf sections and specifications (issue #691) ---
  // The spec number's vocabulary: the S-4 sections run 100-600 (Part C
  // 100-500), so the leaf number is 3 digits with hundreds digit 1-6 —
  // the same shape the bare citation branch leans on to keep the B
  // Bibliographic series (B-1..B-13 style) distinct from B-4xx specs.
  const specShape = match("[1-6]").then(match("[0-9]").repeat(2, 2));
  // The citation letter is the spec's part (A/B/C); the builder binds
  // it into `part` and rejects a conflicting Part-rule capture.
  rule("spec_citation_body", () =>
    str("A").or(str("B"), str("C")).as("spec_part")
      .then(dash, specShape.as("spec"))
      .then(dot.then(digits.as("spec_sub")).maybe())
      .then(
        str("(").then(match("[A-Z]").repeat(1, Infinity).as("spec_variant"), str(")")).maybe(),
      ),
  );
  // The compact anchor form: the citation follows the code after one
  // space ("IHO S-4 B-401").
  rule("spec_citation", () => space.then(rules["spec_citation_body"]!));
  // The spelled section long form: "Part B, Section 400" — the spelled
  // number becomes the spec (the section-level citation), and a
  // trailing citation (", Section 400, B-401") makes it a cross-check
  // only.
  rule("part_section_tail", () =>
    str(",").then(space, str("Section"), space, specShape.as("spec_section"))
      .then(str(",").then(space, rules["spec_citation_body"]!).maybe()),
  );
  rule("part", () =>
    space.then(str("Part")).then(
      space,
      rules["part_value"]!,
      rules["part_dated"]!.maybe(),
      rules["part_section_tail"]!.maybe(),
    ),
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
        rules["spec_citation"]!.maybe(),
        rules["annex"]!.maybe(),
        rules["appendix"]!.maybe(),
        rules["serial"]!.maybe(),
        rules["year_qualifier"]!.maybe(),
      ),
  );
  // The bare citation branch (the entry's FIRST alternative): "B-401" /
  // "IHO B-401" — implicit S-4 anchor (the builder synthesizes series S
  // number 4). B only: bare C-x stays the Circular Letter series, and
  // the 3-digit [1-6]xx shape keeps the B Bibliographic series (B-12)
  // on the main branch.
  rule("bare_spec_citation", () =>
    str("IHO").then(space).maybe()
      .then(
        str("B").as("spec_part"),
        dash,
        specShape.as("spec"),
        dot.then(digits.as("spec_sub")).maybe(),
        str("(").then(match("[A-Z]").repeat(1, Infinity).as("spec_variant"), str(")")).maybe(),
      ),
  );
  rule("identifier_entry", () =>
    rules["bare_spec_citation"]!.or(rules["identifier"]!),
  );
  rule("root", () => rules["identifier_entry"]!);
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
      // The S-158 family facet (pubid#774): the S-100 product number
      // whose validation checks this publication specifies. The colon
      // designator form "S-158:102" is the primary face; the legacy
      // draft-era part spellings bind the SAME identity.
      checks_for: { type: "string" },
      // The face the input spelled checks_for with: undefined = the
      // primary colon face ("S-158:102"), a series letter = the part/
      // compact face ("Part S-102", "S-158-S-102" — the letter it
      // cited). Spelling-only: outside the mappings whitelist it never
      // serializes, and equality skips it — render keeps the input
      // spelling, equality/URN use the canonical shape.
      checks_face: { type: "string", equalityIgnored: true },
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
      // The S-4 loose-leaf spec citation (issue #691): spec is the leaf
      // number, the dotted sub and the parenthesized variant its
      // children. The citation letter rides `part`; the spelled section
      // is resolve-only (never an atom).
      spec: { type: "string" },
      spec_sub: { type: "string" },
      spec_variant: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "checks_for", to: "checks_for" },
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
      { wire: "spec", to: "spec" },
      { wire: "spec_sub", to: "spec_sub" },
      { wire: "spec_variant", to: "spec_variant" },
    );

    declare readonly number: string;
    declare readonly checks_for: string | undefined;
    declare readonly checks_face: string | undefined;
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
    declare readonly spec: string | undefined;
    declare readonly spec_sub: string | undefined;
    declare readonly spec_variant: string | undefined;

    render(): string {
      let result = `IHO ${letter}-${this.number}`;
      // The S-158 checks face: the primary colon form rides the code
      // ("S-158:102"); the legacy part face keeps its spelling and sits
      // where the Part face sat — after the edition ("S-158 0.2.0
      // Part S-102"). The compact face renders expanded (the S-5A law).
      if (this.checks_for !== undefined && this.checks_face === undefined) {
        result += `:${this.checks_for}`;
      }
      if (this.edition !== undefined) result += ` ${this.edition}`;
      if (this.checks_for !== undefined && this.checks_face !== undefined) {
        result += ` Part ${this.checks_face}-${this.checks_for}`;
      }
      if (this.supplement !== undefined) {
        result += ` Sup ${this.supplement}`;
        if (this.supplement_edition !== undefined) result += ` ${this.supplement_edition}`;
        if (this.supplement_year !== undefined) result += ` (${this.supplement_year})`;
      }
      if (this.spec !== undefined) {
        // The S-4 citation face replaces the Part face (same
        // containment slot: the citation letter IS the part):
        // "B-401", "B-122.1", "B-521(I)".
        result += ` ${this.part}-${this.spec}`;
        if (this.spec_sub !== undefined) result += `.${this.spec_sub}`;
        if (this.spec_variant !== undefined) result += `(${this.spec_variant})`;
      } else if (this.part !== undefined) {
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
      // The IHO MRN guidance (S-100WG4): the publications namespace is
      // urn:mrn:iho:pub:, type spec, the name segment the lowercased
      // series letter + number. The edition keeps its canonical
      // position directly after the name (dotted, bare — never an
      // ed- marker); every other component is a trailing token.
      const parts = ["urn", "mrn", "iho", "pub", "spec"];
      // The name: colon members hyphenate into it (the fleet extension
      // for compound publication numbers, pubid#774 — "C-16:2" names
      // c16-2), and the S-158 checks member rides here too
      // ("S-158:102" → s158-102), so the edition slot stays canonical.
      let name = `${letter.toLowerCase()}${String(id.number).split(":")[0]}`;
      const members = String(id.number).split(":").slice(1);
      if (id.checks_for !== undefined) members.push(id.checks_for);
      name += members.map((m) => `-${m}`).join("");
      parts.push(name);
      // The base edition is the bare positional segment (the guidance's
      // <edition number> slot); the with-year qualifier a trailing
      // year token.
      if (id.edition !== undefined) parts.push(id.edition);
      if (id.year !== undefined) parts.push(`year${id.year}`);
      // Components in containment order; a component edition emits as
      // the bare dotted segment right after its component token (the
      // positional ed- rule of the old scheme, unmarked), a component
      // year as its own year token.
      if (id.supplement !== undefined) {
        parts.push(`supplement${id.supplement}`);
        if (id.supplement_edition !== undefined) parts.push(id.supplement_edition);
        if (id.supplement_year !== undefined) parts.push(`year${id.supplement_year}`);
      }
      if (id.part !== undefined) {
        parts.push(`part${id.part}`);
        if (id.part_edition !== undefined) parts.push(id.part_edition);
        if (id.part_year !== undefined) parts.push(`year${id.part_year}`);
      }
      // The S-4 spec citation: one token shaped like the printed face
      // (spec401, spec351.1(I)); the spelled SECTION is NOT emitted —
      // derivable from the spec's hundreds digit.
      if (id.spec !== undefined) {
        let token = `spec${id.spec}`;
        if (id.spec_sub !== undefined) token += `.${id.spec_sub}`;
        if (id.spec_variant !== undefined) token += `(${id.spec_variant})`;
        parts.push(token);
      }
      if (id.annex !== undefined) {
        parts.push(`annex${id.annex}`);
        if (id.annex_edition !== undefined) parts.push(id.annex_edition);
        if (id.annex_year !== undefined) parts.push(`year${id.annex_year}`);
      }
      if (id.appendix !== undefined) {
        parts.push(`appendix${id.appendix}`);
        // The subnumber is a bare child segment directly after the
        // appendix (the old scheme's bare-atom rule).
        if (id.appendix_subnumber !== undefined) parts.push(id.appendix_subnumber);
        if (id.appendix_edition !== undefined) parts.push(id.appendix_edition);
        if (id.appendix_year !== undefined) parts.push(`year${id.appendix_year}`);
      }
      if (id.volume !== undefined) {
        parts.push(`vol${id.volume}`);
        if (id.issue !== undefined) parts.push(`issue${id.issue}`);
        if (id.volume_edition !== undefined) parts.push(id.volume_edition);
        if (id.volume_year !== undefined) parts.push(`year${id.volume_year}`);
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
  // The S-4 anchor: the loose-leaf publication every spec citation
  // resolves through (bare "B-401" carries it implicitly).
  static S4_TYPE = "S";
  static S4_NUMBER = "4";
  // The S-158 framework publication: its series members (the colon
  // designator and the series-reference part faces) re-key into
  // checks_for (pubid#774).
  static S158_NUMBER = "158";
  // A citation letter is one of S-4's lettered Parts; the section
  // vocabulary (100-600, Part C 100-500) is theirs.
  static SPEC_LETTERS = ["A", "B", "C"];
  // Components an S-4 spec citation cannot carry: the citation is a
  // leaf of the Part, not a wrappable publication.
  static SPEC_FOREIGN_COMPONENTS = [
    "supplement", "annex", "appendix", "appendix_subnumber", "volume", "issue",
  ];

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
    // The S-158 family re-key (pubid#774). The colon designator form
    // "S-158:<NNN>" is the PRIMARY face: number stays 158, the member
    // binds checks_for. On every other series the colon member re-glues
    // into the number (the opaque C-16:2 face, pubid#637). A
    // series-reference part on S-158 ("Part S-102", compact
    // "S-158-S-102") is a LEGACY draft-era spelling of the SAME
    // identity: it binds checks_for, its citation letter rides the
    // spelling-only face (render keeps the input spelling, equality/
    // URN canonical), and its separately-published edition/year slots
    // fold onto the base (the draft rows carry ONE edition wherever it
    // sat — the pubid#775 mis-bind dies with the part capture).
    const colonSuffix = flat["colon_suffix"];
    delete flat["colon_suffix"];
    if (colonSuffix !== undefined) {
      if (flat["number"] === IhoBuilder.S158_NUMBER) {
        if (flat["checks_for"] !== undefined && flat["checks_for"] !== colonSuffix) {
          throw new ParseFailed(
            `IHO: checks_for ${String(flat["checks_for"])} conflicts with the colon member ${String(colonSuffix)}`,
            0,
          );
        }
        flat["checks_for"] = colonSuffix;
      } else {
        flat["number"] = `${String(flat["number"])}:${String(colonSuffix)}`;
      }
    }
    if (flat["number"] === IhoBuilder.S158_NUMBER) {
      const match =
        typeof flat["part"] === "string" ? /^([A-Z])-(\d+)$/.exec(flat["part"]) : null;
      if (match !== null) {
        const seriesRef = match[1]!;
        const member = match[2]!;
        if (flat["checks_for"] !== undefined && flat["checks_for"] !== member) {
          throw new ParseFailed(
            `IHO: checks_for ${String(flat["checks_for"])} conflicts with the part ${String(flat["part"])}`,
            0,
          );
        }
        flat["checks_for"] = member;
        flat["checks_face"] = seriesRef;
        delete flat["part"];
        for (const [slot, base] of [
          ["part_edition", "edition"],
          ["part_year", "year"],
        ] as const) {
          if (flat[slot] === undefined) continue;
          if (flat[base] !== undefined && flat[base] !== flat[slot]) {
            throw new ParseFailed(
              `IHO: the S-158 publication carries one edition — ${String(flat[base])} and the part's ${String(flat[slot])} conflict`,
              0,
            );
          }
          if (flat[base] === undefined) flat[base] = flat[slot];
          delete flat[slot];
        }
      }
    }
    // The S-4 spec citation resolution (ruby resolve_spec_citation!):
    // the citation letter folds into `part` (a Part-rule capture must
    // agree), and the long form's spelled section becomes the spec
    // alone — beside a citation it only cross-checks the citation's
    // derived section ("Part B, Section 400, B-401" stores spec 401;
    // "Part B, Section 500, B-401" is rejected).
    const letter = flat["spec_part"];
    const spelled = flat["spec_section"];
    delete flat["spec_part"];
    delete flat["spec_section"];
    if (letter !== undefined) {
      if (flat["part"] === undefined || flat["part"] === letter) {
        flat["part"] = letter;
      } else {
        throw new ParseFailed(
          `IHO: the citation letter ${String(letter)} conflicts with part ${String(flat["part"])}`,
          0,
        );
      }
    }
    if (spelled !== undefined) {
      if (flat["spec"] === undefined) {
        flat["spec"] = spelled;
      } else {
        const section = `${String(flat["spec"])[0]}00`;
        if (spelled !== section) {
          throw new ParseFailed(
            `IHO: the spelled section ${String(spelled)} disagrees with the citation ${String(flat["part"])}-${String(flat["spec"])}`,
            0,
          );
        }
      }
    }
    if (flat["spec"] !== undefined) {
      if (!IhoBuilder.SPEC_LETTERS.includes(String(flat["part"]))) {
        throw new ParseFailed(
          `IHO: an S-4 spec citation needs a lettered Part (A/B/C), not ${JSON.stringify(flat["part"])}`,
          0,
        );
      }
      if (flat["part_edition"] !== undefined || flat["part_year"] !== undefined) {
        throw new ParseFailed(
          "IHO: a spec citation rides the S-4 edition, not a part edition",
          0,
        );
      }
      const foreign = IhoBuilder.SPEC_FOREIGN_COMPONENTS.filter((k) => flat[k] !== undefined);
      if (foreign.length > 0) {
        throw new ParseFailed(
          `IHO: an S-4 spec citation is a leaf of its Part and cannot carry ${foreign.join(", ")}`,
          0,
        );
      }
      // The series letter: a bare citation branch parse has no series
      // capture, and its anchor is implicitly the S-4 publication (the
      // number binds with it). An explicit series must BE the anchor.
      if (flat["type"] === undefined) {
        flat["type"] = IhoBuilder.S4_TYPE;
        flat["number"] = IhoBuilder.S4_NUMBER;
      } else if (
        flat["type"] !== IhoBuilder.S4_TYPE ||
        flat["number"] !== IhoBuilder.S4_NUMBER
      ) {
        throw new ParseFailed(
          `IHO: an S-4 spec citation requires the S-4 anchor: ${String(flat["type"])}-${String(flat["number"])} cannot carry spec ${String(flat["spec"])}`,
          0,
        );
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
