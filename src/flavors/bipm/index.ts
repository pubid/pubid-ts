import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";

/**
 * 1:1 port of lib/pubid/bipm/ — corpus rows across six families:
 * committee documents (REC/RES/DECN/ACT/DECL in short and long EN/FR
 * forms, with the appendix/annex complement and the publisher-prefixed
 * decision spelling), meetings (EN ordinals and double-dash forms, FR
 * <sup>e</sup> réunion), the Metrologia journal, the SI Brochure and
 * its derived products, mises en pratique (incl. Rapport BIPM-YYYY/NN),
 * and CC guides. Historic group names (CCDS) and two-letter language
 * codes (EN/FR) normalize at parse time and never reach the hash.
 */

const GROUPS = [
  "CIPM", "CGPM", "JCRB", "CCTF", "CCQM", "CCT", "CCL", "CCAUV",
  "CCU", "CCM", "CCEM", "CCPR", "CCRI",
];
const GROUP_ALIASES: Record<string, string> = { CCDS: "CCTF" };
const PARSEABLE_GROUPS = [...GROUPS, ...Object.keys(GROUP_ALIASES)];

const TYPE_CODES = ["REC", "RES", "DECN", "ACT", "DECL"] as const;
const TYPE_NAME_EN: Record<string, string> = {
  REC: "Recommendation", RES: "Resolution", DECN: "Decision",
  ACT: "Action", DECL: "Statement",
};
const TYPE_NAME_FR: Record<string, string> = {
  REC: "Recommandation", RES: "Résolution", DECN: "Décision",
  ACT: "Action", DECL: "Statement",
};
const TYPE_WORD_ALIASES: Record<string, string> = {
  Declaration: "DECL", "Déclaration": "DECL",
};
const TYPE_WORD_TO_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = { ...TYPE_WORD_ALIASES };
  for (const code of TYPE_CODES) {
    map[code] = code;
    map[TYPE_NAME_EN[code]!] = code;
    map[TYPE_NAME_FR[code]!] = code;
  }
  return map;
})();

const LANGUAGE_ALIASES: Record<string, string> = { EN: "E", FR: "F" };

/** Longest-first literal alternation, so "CCTF" beats "CCT". */
function alternation(tokens: string[]): P {
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  return sorted.map((t) => str(t)).reduce((a, b) => a.or(b));
}

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digits = match("[0-9]").repeat(1, Infinity);
  const alnum = match("[0-9A-Za-z]").repeat(1, Infinity);

  rule("number", () =>
    digits.then(str("-").then(digits).repeat(0, Infinity)).as("number"),
  );
  rule("year", () => match("[0-9]").repeat(4, 4).as("year"));
  // Two-letter consumer codes first, so "EN" is never a bare "E".
  const lang = () => alternation(["EN", "FR", "E", "F"]).as("language");
  rule("year_paren", () =>
    str("(").then(
      rules["year"]!,
      str(", ").then(lang()).maybe(),
      str(")"),
    ),
  );
  rule("year_paren_nolang", () => str("(").then(rules["year"]!, str(")")));

  rule("group", () => alternation(PARSEABLE_GROUPS).as("group"));
  rule("type_abbrev", () => alternation([...TYPE_CODES]).as("type_word"));
  rule("type_name_en", () =>
    alternation([...new Set([...Object.values(TYPE_NAME_EN), "Declaration"])]).as("type_word"),
  );
  rule("type_name_fr", () =>
    alternation([...new Set([...Object.values(TYPE_NAME_FR), "Déclaration"])]).as("type_word"),
  );
  const connective = () => str("de la").or(str("du"));
  const ordinal = () => str("st").or(str("nd"), str("rd"), str("th"));
  const meetingWordFr = () => str("Réunion").or(str("réunion"));

  // The trailing date is optional so "CCTF REC 2" parses date-less. The
  // appendix/annex complement tail ("CIPM DECN 112 A3.5 (2022, F)")
  // rides the number: "A" + digits [ "." + digits ].
  rule("committee_short", () =>
    rules["group"]!
      .then(
        space,
        rules["type_abbrev"]!,
        space.then(
          rules["number"]!,
          space
            .then(
              str("A").then(digits.as("appendix"), str(".").then(digits.as("annex")).maybe()),
            )
            .maybe(),
        ).maybe(),
        space.then(rules["year_paren"]!).maybe(),
      )
      .as("committee_short"),
  );
  // The publisher-prefixed decision form the corpus cites
  // ("BIPM DECN CIPM/101-1 (2012, EN)"): a literal BIPM publisher lead,
  // the outcome type, then the body-qualified resource-specific-id
  // "{body}/{id}". It names the same document as the unprefixed
  // "<body> <TYPE> <id>" form, so the builder dispatches it through the
  // same CommitteeDocument path.
  rule("committee_prefixed", () =>
    str("BIPM")
      .then(
        space,
        rules["type_abbrev"]!,
        space,
        rules["group"]!,
        str("/"),
        rules["number"]!,
        space.then(rules["year_paren"]!).maybe(),
      )
      .as("committee_prefixed"),
  );
  rule("committee_long_en", () =>
    rules["group"]!
      .then(
        space,
        rules["type_name_en"]!,
        space.then(rules["number"]!).maybe(),
        space.then(rules["year_paren_nolang"]!).maybe(),
      )
      .as("committee_long_en"),
  );
  rule("committee_long_fr", () =>
    rules["type_name_fr"]!
      .then(
        space.then(rules["number"]!).maybe(),
        space,
        connective(),
        space,
        rules["group"]!,
        space.then(rules["year_paren_nolang"]!).maybe(),
      )
      // The corpus-cited French body-qualified form ("Décision
      // CIPM/101-1 (2012)").
      .or(
        rules["type_name_fr"]!.then(
          space,
          rules["group"]!,
          str("/"),
          rules["number"]!,
          space.then(rules["year_paren_nolang"]!).maybe(),
        ),
      )
      .as("committee_long_fr"),
  );
  // Loose consumer form: a French type name in group-leading order.
  rule("committee_group_fr", () =>
    rules["group"]!
      .then(
        space,
        rules["type_name_fr"]!,
        space.then(rules["number"]!).maybe(),
        space.then(rules["year_paren_nolang"]!).maybe(),
      )
      .as("committee_long_fr"),
  );
  // Bare MRA form: group + number, no type word ("CIPM 2005-06").
  rule("committee_bare", () =>
    rules["group"]!
      .then(
        space,
        rules["number"]!,
        space.then(rules["year_paren"]!).maybe(),
      )
      .as("committee_bare"),
  );

  rule("meeting_en", () =>
    rules["group"]!
      .then(space, rules["number"]!, ordinal(), space, str("Meeting"), space.then(rules["year_paren"]!).maybe())
      .or(
        rules["group"]!.then(
          space,
          str("Meeting"),
          space,
          rules["number"]!,
          space.then(rules["year_paren"]!).maybe(),
        ),
      )
      // The double-dash consumer spellings ("CGPM -- Meeting 1 (1889)").
      .or(
        rules["group"]!.then(
          space,
          str("--"),
          space,
          rules["number"]!,
          ordinal(),
          space,
          str("Meeting"),
          space.then(rules["year_paren"]!).maybe(),
        ),
      )
      .or(
        rules["group"]!.then(
          space,
          str("--"),
          space,
          str("Meeting"),
          space,
          rules["number"]!,
          space.then(rules["year_paren"]!).maybe(),
        ),
      )
      .as("meeting_en"),
  );
  rule("meeting_fr", () =>
    rules["group"]!
      .then(space, rules["number"]!, str("<sup>e</sup>"), space, str("réunion"), space.then(rules["year_paren"]!).maybe())
      .or(
        rules["group"]!.then(
          space,
          rules["number"]!,
          str("e"),
          space,
          meetingWordFr(),
          space.then(rules["year_paren"]!).maybe(),
        ),
        rules["group"]!.then(
          space,
          meetingWordFr(),
          space,
          rules["number"]!,
          space.then(rules["year_paren"]!).maybe(),
        ),
      )
      .as("meeting_fr"),
  );

  rule("metrologia", () =>
    str("Metrologia")
      .then(
        space
          .then(
            digits.as("volume"),
            space
              .then(
                alnum.as("issue"),
                space.then(alnum.as("article")).maybe(),
              )
              .maybe(),
          )
          .maybe(),
      )
      .as("metrologia"),
  );

  rule("edition", () => digits.then(str("e")).as("edition"));
  rule("version", () => str("v").then(match("[0-9.]").repeat(1, Infinity)).as("version"));
  rule("years", () => digits.then(str("/").then(digits).maybe()).as("years"));
  rule("si_brochure", () =>
    // The guide's French publication identifier leads with
    // "Brochure sur le SI" instead of the English brochure name; all
    // three leads render in the canonical "BIPM SI Brochure …" spelling.
    str("BIPM SI Brochure")
      .or(str("SI Brochure"))
      .or(str("Brochure sur le SI"))
      .then(
        space,
        str("sur le SI").then(space).maybe(),
        rules["edition"]!,
        // The version and the trailing parenthetical are optional (the
        // guide's language-independent form "SI Brochure 9e (2019, E)";
        // the year-less editions "BIPM SI Brochure 9e" and "… (E)" must
        // re-parse as canonically rendered, pubid#694 ruling R1).
        space.then(rules["version"]!).maybe(),
        space
          .then(
            str("(")
              .then(rules["years"]!, str(", ").then(lang()).maybe(), str(")"))
              .or(str("(").then(lang(), str(")"))),
          )
          .maybe(),
      )
      .as("si_brochure"),
  );
  // The corpus-cited ordinal-edition spelling ("SI Brochure 9th edition
  // (2019)") normalizes the English ordinal onto the canonical "9e".
  rule("si_brochure_ordinal_edition", () =>
    str("SI Brochure")
      .then(
        space,
        digits.then(ordinal()).as("ordinal_edition"),
        space,
        str("edition"),
        space.then(rules["year_paren"]!).maybe(),
      )
      .as("si_brochure_ordinal_edition"),
  );

  // The unmerged si-brochure-id proposal's bare-number edition spellings
  // ("SI Brochure 9", "SI Brochure 9 (E)", "SI Brochure 9 (2024) (F)"):
  // the edition carries no trailing "e", and the year and the language
  // may each sit in their own parentheses (pubid#694 ruling R1). A
  // parse-in alias of the canonical "9e" edition — the builder appends
  // the "e" the proposal drops.
  rule("si_brochure_bare_edition", () =>
    str("SI Brochure")
      .then(
        space,
        digits.as("bare_edition"),
        space.then(str("("), rules["years"]!, str(")")).maybe(),
        space.then(str("("), lang(), str(")")).maybe(),
      )
      .as("si_brochure_bare_edition"),
  );

  rule("brochure_variant", () =>
    str("Appendix")
      .then(space, digits)
      .or(str("Concise"), str("FAQ"))
      .as("variant"),
  );
  rule("si_brochure_variant", () =>
    str("BIPM SI Brochure")
      .or(str("SI Brochure"))
      .then(space, rules["brochure_variant"]!)
      .as("si_brochure_variant"),
  );
  rule("si_brochure_section", () =>
    str("BIPM SI Brochure")
      .or(str("SI Brochure"))
      .then(space.then(str("Part"), space, digits.as("part")).maybe())
      .as("si_brochure_section"),
  );

  // Shared "Appendix N [Annex N] Part N[.M]" tail of MEPs and guides.
  rule("appendix_part", () =>
    str("Appendix").then(
      space,
      digits.as("appendix"),
      space.then(str("Annex"), space, digits.as("annex")).maybe(),
      space,
      str("Part"),
      space,
      digits.then(str(".").then(digits).maybe()).as("part"),
    ),
  );

  rule("mep_code", () => match("[0-9A-Za-z]").repeat(1, Infinity).as("mep_code"));
  rule("report_code", () =>
    str("BIPM-").then(digits, str("/"), digits).as("report_code"),
  );
  const mepBody = () =>
    str("SI MEP").then(space, rules["mep_code"]!).or(
      str("Rapport").then(space, rules["report_code"]!),
    );
  rule("mep", () =>
    str("BIPM")
      .then(space, mepBody(), space, rules["appendix_part"]!)
      .or(mepBody())
      .as("mep"),
  );

  rule("guide_kind", () => str("MeP").or(str("RSI")).as("guide_kind"));
  const guideBody = () =>
    rules["group"]!.then(
      str("-GD-"),
      rules["guide_kind"]!,
      str("-"),
      digits.as("number"),
    );
  rule("guide", () =>
    str("BIPM")
      .then(space, guideBody(), space, rules["appendix_part"]!)
      .or(guideBody())
      .as("guide"),
  );

  rule("group_leading", () =>
    rules["meeting_en"]!.or(
      rules["meeting_fr"]!,
      rules["committee_short"]!,
      rules["committee_long_en"]!,
      rules["committee_group_fr"]!,
      rules["committee_bare"]!,
    ),
  );

  rule("identifier", () =>
    rules["metrologia"]!.or(
      rules["si_brochure"]!,
      rules["si_brochure_variant"]!,
      rules["si_brochure_section"]!,
      rules["si_brochure_ordinal_edition"]!,
      rules["si_brochure_bare_edition"]!,
      rules["mep"]!,
      rules["guide"]!,
      rules["committee_long_fr"]!,
      rules["committee_prefixed"]!,
      rules["group_leading"]!,
    ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const bipmGrammar: Grammar = { rules: buildRules(), root: "root" };

/** data/bipm/update_codes.yaml — full-line legacy spellings. */
const UPDATE_CODES: Record<string, string> = {
  "CIPM/2005-06(REV)": "CIPM 2005-06",
  "CIPM 2005-06(REV)": "CIPM 2005-06",
};

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const BIPM_ATTRS = {
  group: { type: "string" },
  type_code: { type: "string" },
  number: { type: "string" },
  year: { type: "integer" },
  language: { type: "string" },
  form: { type: "string", default: "short" },
  issue: { type: "string" },
  article: { type: "string" },
  edition: { type: "string" },
  version: { type: "string" },
  years: { type: "string" },
  variant: { type: "string" },
  mep_code: { type: "string" },
  report_code: { type: "string" },
  guide_kind: { type: "string" },
  appendix: { type: "string" },
  annex: { type: "string" },
  part: { type: "string" },
} as const;

const BIPM_MAPPINGS = keyValue(
  { wire: "group", to: "group" },
  { wire: "type_code", to: "type_code" },
  { wire: "number", to: "number" },
  { wire: "year", to: "year" },
  { wire: "language", to: "language" },
  { wire: "form", to: "form" },
  { wire: "issue", to: "issue" },
  { wire: "article", to: "article" },
  { wire: "edition", to: "edition" },
  { wire: "version", to: "version" },
  { wire: "years", to: "years" },
  { wire: "variant", to: "variant" },
  { wire: "mep_code", to: "mep_code" },
  { wire: "report_code", to: "report_code" },
  { wire: "guide_kind", to: "guide_kind" },
  { wire: "appendix", to: "appendix" },
  { wire: "annex", to: "annex" },
  { wire: "part", to: "part" },
);

/** Naive source-data ordinals: 1→st, 2→nd, 3→rd, else→th (11→"11st"). */
function ordinalSuffix(number: string): string {
  const first = number.split("-")[0] ?? "";
  const last = first.at(-1);
  if (last === "1") return "st";
  if (last === "2") return "nd";
  if (last === "3") return "rd";
  return "th";
}

function frenchConnective(group: string): string {
  return group === "CGPM" ? "de la" : "du";
}

/** The appendix/annex complement folds into the identifier segment as
 *  "-a{appendix}[.{annex}]" (ruby committee_number_segment); a bare
 *  number is digits and dashes only, so the suffix is unambiguous. */
function committeeNumberSegment(id: BipmCommitteeDocument): string {
  if (id.number === undefined) return "";
  if (id.appendix === undefined) return id.number;
  return `${id.number}-a${id.appendix}${id.annex === undefined ? "" : `.${id.annex}`}`;
}

export abstract class BipmIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, BIPM_ATTRS);
  static mappings = BIPM_MAPPINGS;

  declare readonly group: string | undefined;
  declare readonly type_code: string | undefined;
  declare readonly number: string | undefined;
  declare readonly year: number | undefined;
  declare readonly language: string | undefined;
  declare readonly form: string | undefined;
  declare readonly issue: string | undefined;
  declare readonly article: string | undefined;
  declare readonly edition: string | undefined;
  declare readonly version: string | undefined;
  declare readonly years: string | undefined;
  declare readonly variant: string | undefined;
  declare readonly mep_code: string | undefined;
  declare readonly report_code: string | undefined;
  declare readonly guide_kind: string | undefined;
  declare readonly appendix: string | undefined;
  declare readonly annex: string | undefined;
  declare readonly part: string | undefined;

  numberSegment(): string {
    return this.number === undefined ? "" : ` ${this.number}`;
  }

  yearSegment(lang = ""): string {
    return this.year === undefined ? "" : ` (${this.year}${lang})`;
  }

  fullContentWrap(body: string): string {
    if (this.part === undefined) return body;
    const annex = this.annex === undefined ? "" : ` Annex ${this.annex}`;
    return `BIPM ${body} Appendix ${this.appendix}${annex} Part ${this.part}`;
  }
}

class BipmUrnGenerator extends BaseUrnGenerator<BipmIdentifier> {
  generate(): string {
    const id = this.identifier;
    if (id instanceof BipmCommitteeDocument) {
      // The guide-of-record faces (pubid#694, ruling R2): the v1 version
      // segment leads every family and the type segment spells the English
      // type name lowercased ("decision"), never the REC/RES/DECN code.
      // type_code is nil for the bare MRA form -> empty type segment.
      const typeSegment = id.type_code === undefined
        ? ""
        : (TYPE_NAME_EN[id.type_code] ?? id.type_code).toLowerCase();
      const parts = [
        "urn", "bipm", "v1", id.group?.toLowerCase() ?? "",
        typeSegment, committeeNumberSegment(id),
      ];
      if (id.year !== undefined) parts.push(String(id.year));
      return parts.join(":");
    }
    if (id instanceof BipmMeeting) {
      const parts = ["urn", "bipm", "v1", id.group?.toLowerCase() ?? "", "meeting", id.number ?? ""];
      if (id.year !== undefined) parts.push(String(id.year));
      return parts.join(":");
    }
    if (id instanceof BipmMetrologiaArticle) {
      const parts = ["urn", "bipm", "v1", "metrologia", String(id.volume())];
      if (id.issue !== undefined) parts.push(id.issue);
      if (id.article !== undefined) parts.push(id.article);
      return parts.join(":");
    }
    if (id instanceof BipmSiBrochure) {
      // The guide's edition-number carries no "e" ("9e" emits "9"); the
      // version drops its "v"; the year is the latest of the years range;
      // the language segment is dropped entirely.
      return [
        "urn", "bipm", "v1", "bipm", "si-brochure",
        (id.edition ?? "").replace(/e$/i, ""),
        (id.version ?? "").replace(/^v/i, ""),
        (id.years ?? "").split("/").pop() ?? "",
      ].join(":");
    }
    throw new ParseFailed(`Cannot build URN for BIPM identifier: ${id.constructor.polymorphicName}`, 0);
  }
}

class BipmCommitteeDocument extends BipmIdentifier {
  static polymorphicName = "pubid:bipm:committee-document";
  static urnGenerator = BipmUrnGenerator;

  render(): string {
    if (this.form === "long") {
      if (this.language === "F") {
        const name = TYPE_NAME_FR[this.type_code ?? ""] ?? "";
        // The guide's body-prefixed French pattern ("Décision CIPM/111-10
        // (2022)") is the canonical long face (pubid#694, ruling R3): the
        // group qualifies the resource-specific id with a slash. A
        // number-less document keeps the connective spelling the guide's
        // general French pattern uses ("Statement de la CGPM (1889)").
        if (this.number !== undefined) {
          return `${name} ${this.group}/${this.number}${this.yearSegment()}`;
        }
        return `${name}${this.numberSegment()} ${frenchConnective(this.group ?? "")} ${this.group}${this.yearSegment()}`;
      }
      const name = TYPE_NAME_EN[this.type_code ?? ""] ?? "";
      return `${this.group ?? ""} ${name}${this.numberSegment()}${this.yearSegment()}`;
    }
    const lang = this.language === undefined ? "" : `, ${this.language}`;
    const type = this.type_code === undefined ? "" : ` ${this.type_code}`;
    return `${this.group ?? ""}${type}${this.numberSegment()}${this.appendixSegment()}${this.yearSegment(lang)}`;
  }

  /** The complement tail "{identifier} A{appendix}[.{annex}]" — parts and
   *  subparts are dash forms inside `number` itself; appendices and
   *  annexes are this separate tail. */
  private appendixSegment(): string {
    if (this.appendix === undefined) return "";
    return ` A${this.appendix}${this.annex === undefined ? "" : `.${this.annex}`}`;
  }
}
registerType(BipmCommitteeDocument as unknown as IdentifierStatic);

class BipmMeeting extends BipmIdentifier {
  static polymorphicName = "pubid:bipm:meeting";
  static urnGenerator = BipmUrnGenerator;

  render(): string {
    if (this.language === "F") {
      return `${this.group ?? ""} ${this.number ?? ""}<sup>e</sup> réunion${this.yearSegment()}`;
    }
    return `${this.group ?? ""} ${this.number ?? ""}${ordinalSuffix(this.number ?? "")} Meeting${this.yearSegment()}`;
  }
}
registerType(BipmMeeting as unknown as IdentifierStatic);

class BipmMetrologiaArticle extends BipmIdentifier {
  static polymorphicName = "pubid:bipm:metrologia-article";
  static urnGenerator = BipmUrnGenerator;

  /** The volume IS the index key — derived from `number`, never stored. */
  volume(): number | undefined {
    return this.number === undefined ? undefined : Number(this.number);
  }

  render(): string {
    let result = "Metrologia";
    if (this.volume() !== undefined) result += ` ${this.volume()}`;
    if (this.issue !== undefined) result += ` ${this.issue}`;
    if (this.article !== undefined) result += ` ${this.article}`;
    return result;
  }
}
registerType(BipmMetrologiaArticle as unknown as IdentifierStatic);

class BipmSiBrochure extends BipmIdentifier {
  static polymorphicName = "pubid:bipm:si-brochure";
  static urnGenerator = BipmUrnGenerator;

  render(): string {
    if (this.variant !== undefined) return `BIPM SI Brochure ${this.variant}`;
    if (this.edition === undefined) {
      const part = this.part === undefined ? "" : ` Part ${this.part}`;
      return `BIPM SI Brochure${part}`;
    }
    // The parens carry the year, the language or both, and stay off
    // entirely when the reference names neither ("SI Brochure 9e", the
    // bare edition without a year — pubid#694's renderer fix).
    const phrase = this.language === "F" ? "sur le SI " : "";
    const lang = this.language === undefined ? "" : `, ${this.language}`;
    const version = this.version === undefined ? "" : ` ${this.version}`;
    const tail = this.years !== undefined ? `${this.years}${lang}` : (this.language ?? "");
    let result = `BIPM SI Brochure ${phrase}${this.edition}${version}`;
    if (this.years !== undefined || this.language !== undefined) {
      result += ` (${tail})`;
    }
    return result;
  }
}
registerType(BipmSiBrochure as unknown as IdentifierStatic);

class BipmMep extends BipmIdentifier {
  static polymorphicName = "pubid:bipm:mep";
  static urnGenerator = BipmUrnGenerator;

  render(): string {
    const body =
      this.report_code !== undefined
        ? `Rapport ${this.report_code}`
        : `SI MEP ${this.mep_code}`;
    return this.fullContentWrap(body);
  }
}
registerType(BipmMep as unknown as IdentifierStatic);

class BipmGuide extends BipmIdentifier {
  static polymorphicName = "pubid:bipm:guide";
  static urnGenerator = BipmUrnGenerator;

  render(): string {
    return this.fullContentWrap(`${this.group}-GD-${this.guide_kind}-${this.number}`);
  }
}
registerType(BipmGuide as unknown as IdentifierStatic);

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const isObj = (v: Tree): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const s = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(v);

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

const normalizeGroup = (token: string): string => GROUP_ALIASES[token] ?? token;
const normalizeLanguage = (token: string | undefined): string | undefined =>
  token === undefined ? undefined : LANGUAGE_ALIASES[token] ?? token;

class BipmBuilder {
  build(data: Tree): BaseIdentifier {
    const tree = flatten(data);
    const node = (key: string): TreeObject => {
      const v = tree[key];
      return isObj(v) ? flatten(v) : {};
    };

    if (tree["committee_short"] !== undefined) return this.buildCommittee(node("committee_short"), "short");
    if (tree["committee_prefixed"] !== undefined) {
      // The corpus's "BIPM DECN CIPM/101-1 (2012, EN)" publisher-prefixed
      // spelling names the same document as the unprefixed short form; the
      // BIPM lead is the constant publisher, so it carries no attribute.
      return this.buildCommittee(node("committee_prefixed"), "short");
    }
    if (tree["committee_long_en"] !== undefined) return this.buildCommittee(node("committee_long_en"), "long", "E");
    if (tree["committee_bare"] !== undefined) return this.buildCommittee(node("committee_bare"), "short");
    if (tree["committee_long_fr"] !== undefined) return this.buildCommittee(node("committee_long_fr"), "long", "F");
    if (tree["meeting_en"] !== undefined) return this.buildMeeting(node("meeting_en"));
    if (tree["meeting_fr"] !== undefined) return this.buildMeeting(node("meeting_fr"), "F");
    if (tree["metrologia"] !== undefined) {
      const n = node("metrologia");
      return new BipmMetrologiaArticle({
        number: s(n["volume"]),
        issue: s(n["issue"]),
        article: s(n["article"]),
      });
    }
    if (tree["si_brochure"] !== undefined) {
      const n = node("si_brochure");
      const edition = s(n["edition"])!;
      return new BipmSiBrochure({
        number: edition,
        edition,
        version: s(n["version"]),
        years: s(n["years"]),
        language: normalizeLanguage(s(n["language"])),
      });
    }
    if (tree["si_brochure_variant"] !== undefined) {
      const variant = s(node("si_brochure_variant")["variant"])!;
      return new BipmSiBrochure({ number: variant, variant });
    }
    if (tree["si_brochure_section"] !== undefined) {
      const n = node("si_brochure_section");
      return new BipmSiBrochure({ part: s(n["part"]) });
    }
    if (tree["si_brochure_ordinal_edition"] !== undefined) {
      // The guide prints the edition "9e"; the corpus-cited "9th edition"
      // spelling is the English ordinal form of the same edition,
      // normalized onto the canonical "9e" value. The version is absent
      // from the input, so it stays nil and drops from the hash.
      const n = node("si_brochure_ordinal_edition");
      const edition = `${(s(n["ordinal_edition"]) ?? "").replace(/(st|nd|rd|th)$/, "")}e`;
      const year = s(n["year"]);
      return new BipmSiBrochure({
        number: edition,
        edition,
        ...(year !== undefined ? { years: year } : {}),
        language: normalizeLanguage(s(n["language"])),
      });
    }
    if (tree["si_brochure_bare_edition"] !== undefined) {
      // The proposal drops the trailing "e"; the builder appends it back
      // so the bare-number spellings are parse-in aliases of the canonical
      // "9e" edition (pubid#694 ruling R1). The year and the language sit
      // in separate parentheses; an absent year stays undefined (a partial
      // reference, like "SI Brochure 9th edition" without a year).
      const n = node("si_brochure_bare_edition");
      const edition = `${s(n["bare_edition"])}e`;
      const year = s(n["year"]);
      const language = normalizeLanguage(s(n["language"]));
      return new BipmSiBrochure({
        number: edition,
        edition,
        ...(year !== undefined ? { years: year } : {}),
        ...(language !== undefined ? { language } : {}),
      });
    }
    if (tree["mep"] !== undefined) {
      const n = node("mep");
      const mepCode = s(n["mep_code"]);
      const reportCode = s(n["report_code"]);
      return new BipmMep({
        number: mepCode ?? reportCode,
        mep_code: mepCode,
        report_code: reportCode,
        appendix: s(n["appendix"]),
        annex: s(n["annex"]),
        part: s(n["part"]),
      });
    }
    if (tree["guide"] !== undefined) {
      const n = node("guide");
      return new BipmGuide({
        group: normalizeGroup(s(n["group"])!),
        guide_kind: s(n["guide_kind"])!,
        number: s(n["number"])!,
        appendix: s(n["appendix"]),
        part: s(n["part"]),
      });
    }
    throw new ParseFailed(`Unrecognized BIPM parse tree: ${JSON.stringify(tree)}`, 0);
  }

  private buildCommittee(n: TreeObject, form: string, language?: string): BaseIdentifier {
    const year = s(n["year"]);
    return new BipmCommitteeDocument({
      group: normalizeGroup(s(n["group"])!),
      type_code: TYPE_WORD_TO_CODE[s(n["type_word"]) ?? ""],
      number: s(n["number"]),
      ...(year !== undefined ? { year: Number(year) } : {}),
      language: normalizeLanguage(language ?? s(n["language"])),
      form,
      appendix: s(n["appendix"]),
      annex: s(n["annex"]),
    });
  }

  private buildMeeting(n: TreeObject, language?: string): BaseIdentifier {
    const year = s(n["year"]);
    return new BipmMeeting({
      group: normalizeGroup(s(n["group"])!),
      number: s(n["number"])!,
      ...(year !== undefined ? { year: Number(year) } : {}),
      language: normalizeLanguage(language ?? s(n["language"])),
    });
  }
}

export function bipmGrammarImplementation(): FlavorImplementation {
  const builder = new BipmBuilder();
  return {
    // Inverse of BipmUrnGenerator (lib/pubid/bipm/urn_parser.rb): rebuild
    // the identifier DIRECTLY from the URN fields — the printed forms carry
    // surface detail (meeting ordinals, French wording) the URN omits.
    //
    // Two URN generations parse (pubid#694): the canonical face leads with
    // the guide's `v1` version segment; the pre-adoption face this flavor
    // emitted for years stays parseable as a documented parse-in alias of
    // the same identity. The EMITTER is the new shape; an alias never
    // renders back as itself, it rebuilds the identifier whose toUrn is
    // the v1 face.
    parseUrn(urn: string): Identifier {
      const body = urn.replace(/^urn:bipm:/, "");
      // Keep trailing empty segments (gem splits with -1).
      const parts = body.split(":");
      const presence = (v: string | undefined) =>
        v === undefined || v === "" ? undefined : v;
      const canonical = parts[0] === "v1";
      const p = canonical ? parts.slice(1) : parts;
      if (p[0] === "metrologia") {
        return new BipmMetrologiaArticle({
          number: presence(p[1]),
          issue: p[2],
          article: p[3],
        }) as unknown as Identifier;
      }
      if (canonical && p[0] === "bipm") {
        // `bipm:si-brochure:<edition-number>:<version-number>:<year>` —
        // the guide strips the "e" off the edition and the "v" off the
        // version and drops the language segment, so they are restored
        // here; the year stores back verbatim (idempotent emission).
        const edition = presence(p[2]);
        const version = presence(p[3]);
        return new BipmSiBrochure({
          number: edition ? `${edition}e` : undefined,
          edition: edition ? `${edition}e` : undefined,
          version: version ? `v${version}` : undefined,
          years: presence(p[4]),
        }) as unknown as Identifier;
      }
      if (p[0] === "si-brochure") {
        // Legacy face: `si-brochure:<lang>:<edition>:<version>:<years>`.
        return new BipmSiBrochure({
          number: presence(p[2]),
          language: (p[1] ?? "").toUpperCase(),
          edition: p[2],
          version: p[3],
          years: p[4],
        }) as unknown as Identifier;
      }
      const group = (p[0] ?? "").toUpperCase();
      if (p[1] === "meeting") {
        return new BipmMeeting({
          group,
          number: p[2] ?? "",
          year: p[3] ? Number(p[3]) : undefined,
        }) as unknown as Identifier;
      }
      // The legacy face carried the lowercase type abbreviation ("res");
      // the v1 face carries the lowercase English type name ("resolution").
      // Both resolve through TYPE_WORD_TO_CODE, so an empty segment (the
      // bare MRA form) stays a nil type_code on either face.
      const segment = presence(p[1]);
      const word = segment === undefined
        ? undefined
        : canonical
        ? segment.charAt(0).toUpperCase() + segment.slice(1)
        : segment.toUpperCase();
      // Inverse of committeeNumberSegment: split the folded
      // "-a{appendix}[.{annex}]" tail back out of the identifier segment.
      // A bare number is digits and dashes only, so the letter-prefixed
      // tail is unambiguous.
      const raw = p[2] ?? "";
      const folded = /^(.+?)-a(\d+)(?:\.(\d+))?$/.exec(raw);
      const number = folded ? folded[1] : raw;
      return new BipmCommitteeDocument({
        group,
        type_code: word === undefined ? undefined : TYPE_WORD_TO_CODE[word],
        number: presence(number),
        year: p[3] ? Number(p[3]) : undefined,
        ...(folded
          ? { appendix: folded[2], ...(folded[3] !== undefined ? { annex: folded[3] } : {}) }
          : {}),
      }) as unknown as Identifier;
    },

    parse(input: string): Identifier {
      const normalized = UPDATE_CODES[input] ?? input;
      const tree = parseGrammar(bipmGrammar, normalized);
      if (typeof tree !== "object" || tree === null) {
        throw new ParseFailed("BIPM: unexpected parse tree", 0);
      }
      return builder.build(tree) as unknown as Identifier;
    },
  };
}
