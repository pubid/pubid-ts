import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";

/**
 * 1:1 port of lib/pubid/bipm/ — 90 corpus rows across six families:
 * committee documents (REC/RES/DECN/ACT/DECL in short and long EN/FR
 * forms), meetings (EN ordinals, FR <sup>e</sup> réunion), the
 * Metrologia journal, the SI Brochure and its derived products, mises
 * en pratique (incl. Rapport BIPM-YYYY/NN), and CC guides. Historic
 * group names (CCDS) and two-letter language codes (EN/FR) normalize
 * at parse time and never reach the hash.
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

  // The trailing date is optional so "CCTF REC 2" parses date-less.
  rule("committee_short", () =>
    rules["group"]!
      .then(
        space,
        rules["type_abbrev"]!,
        space.then(rules["number"]!).maybe(),
        space.then(rules["year_paren"]!).maybe(),
      )
      .as("committee_short"),
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
    str("BIPM SI Brochure")
      .or(str("SI Brochure"))
      .then(
        space,
        str("sur le SI").then(space).maybe(),
        rules["edition"]!,
        space,
        rules["version"]!,
        space,
        str("("),
        rules["years"]!,
        str(", "),
        lang(),
        str(")"),
      )
      .as("si_brochure"),
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
      rules["mep"]!,
      rules["guide"]!,
      rules["committee_long_fr"]!,
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
      const parts = [
        "urn", "bipm", id.group?.toLowerCase() ?? "",
        id.type_code?.toLowerCase() ?? "", id.number ?? "",
      ];
      if (id.year !== undefined) parts.push(String(id.year));
      return parts.join(":");
    }
    if (id instanceof BipmMeeting) {
      const parts = ["urn", "bipm", id.group?.toLowerCase() ?? "", "meeting", id.number ?? ""];
      if (id.year !== undefined) parts.push(String(id.year));
      return parts.join(":");
    }
    if (id instanceof BipmMetrologiaArticle) {
      const parts = ["urn", "bipm", "metrologia", String(id.volume())];
      if (id.issue !== undefined) parts.push(id.issue);
      if (id.article !== undefined) parts.push(id.article);
      return parts.join(":");
    }
    if (id instanceof BipmSiBrochure) {
      return [
        "urn", "bipm", "si-brochure", id.language?.toLowerCase() ?? "",
        id.edition ?? "", id.version ?? "", id.years ?? "",
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
        return `${name}${this.numberSegment()} ${frenchConnective(this.group ?? "")} ${this.group}${this.yearSegment()}`;
      }
      const name = TYPE_NAME_EN[this.type_code ?? ""] ?? "";
      return `${this.group ?? ""} ${name}${this.numberSegment()}${this.yearSegment()}`;
    }
    const lang = this.language === undefined ? "" : `, ${this.language}`;
    const type = this.type_code === undefined ? "" : ` ${this.type_code}`;
    return `${this.group ?? ""}${type}${this.numberSegment()}${this.yearSegment(lang)}`;
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
    const phrase = this.language === "F" ? "sur le SI " : "";
    const lang = this.language === undefined ? "" : `, ${this.language}`;
    return `BIPM SI Brochure ${phrase}${this.edition} ${this.version} (${this.years}${lang})`;
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
    parseUrn(urn: string): Identifier {
      const body = urn.replace(/^urn:bipm:/, "");
      // Keep trailing empty segments (gem splits with -1).
      const parts = body.split(":");
      const presence = (v: string | undefined) =>
        v === undefined || v === "" ? undefined : v;
      if (parts[0] === "metrologia") {
        return new BipmMetrologiaArticle({
          number: presence(parts[1]),
          issue: parts[2],
          article: parts[3],
        }) as unknown as Identifier;
      }
      if (parts[0] === "si-brochure") {
        return new BipmSiBrochure({
          number: presence(parts[2]),
          language: (parts[1] ?? "").toUpperCase(),
          edition: parts[2],
          version: parts[3],
          years: parts[4],
        }) as unknown as Identifier;
      }
      const group = (parts[0] ?? "").toUpperCase();
      if (parts[1] === "meeting") {
        return new BipmMeeting({
          group,
          number: parts[2] ?? "",
          year: parts[3] ? Number(parts[3]) : undefined,
        }) as unknown as Identifier;
      }
      return new BipmCommitteeDocument({
        group,
        type_code: presence(parts[1])?.toUpperCase(),
        number: presence(parts[2]),
        year: parts[3] ? Number(parts[3]) : undefined,
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
