import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";

/**
 * 1:1 port of lib/pubid/iala/ — 880 corpus rows. Typed prefixes
 * (S/R/G/M/C/GA/L/X/P plus the legacy A session letter, which routes to
 * GeneralAssembly — there is no Advice type, pubid#734), class-driven
 * zero-padding (4 for S/R/G/M/C, 2+2 dotted for GA, verbatim for the
 * rest), "Ed 2.0" and ":ed2.0" edition forms, (F) languages, and Annex
 * wrappers. URN is the MRN form:
 * urn:mrn:iala:pub:<lower-code>[:ed<n>][:<lang>].
 *
 * The S-100-family product specifications (pubid#777, grammar#146): the
 * IHO-granted S-201..S-299 range hyphenated ("S-201"), the dotted x.y.z
 * edition on the BARE designation face ("S-201 2.0.0", iala.int's own
 * citation form) with "Ed 2.0.0" and the compact ":ed2.0.0" as
 * normalizing aliases; the hundreds digit is fixed to 2 by the grant and
 * S-200 is excluded, so WMO's S-4xx and IHO's S-1xx never parse here.
 * The annex wrapper rides the same class (the S-201 package's
 * sub-numbered letters "ANNEX B2" widen the shared letter rule to an
 * optional trailing digit); the annex edition face follows the base's
 * family (bare for S-100, "Ed" for the legacy series).
 *
 * The codeless slug publications (gem #772, relaton#604): iala.int
 * reports/proceedings with no code, named by their product-URL slug
 * ("IALA arctic-seminar-report (E)"). The slug is two or more
 * hyphen-joined [a-z0-9] runs whose FIRST run must not look like a code
 * (0-2 letters then digits), so a lower-case or letterless typo of a
 * typed code ("IALA s1070", "IALA 1070 Ed 2.0") still fails; the
 * "IALA " prefix is mandatory for a slug (optional for a typed code).
 * The slug is `number` — the index key — and the type has no MRN URN
 * (the gem's Publication#to_urn → nil).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const dash = str("-");
  const colon = str(":");
  const dot = str(".");
  const digits = match("[0-9]").repeat(1, Infinity);

  // GA before G, or G is left with a dangling "A".
  rule("type_letter", () =>
    str("GA")
      .or(str("S"), str("R"), str("G"), str("M"), str("C"), str("A"), str("L"), str("X"), str("P"))
      .as("type_letter"),
  );

  // Any length: the dataset zero-pads ("S1070") but canonical unpadded
  // forms ("M1", "GA1.1") also round-trip.
  rule("doc_number", () => match("[0-9]").repeat(1, Infinity).as("doc_number"));

  rule("dotted_number", () => dot.then(digits));

  rule("number_with_dots", () =>
    rules["doc_number"]!.then(rules["dotted_number"]!.repeat(0, Infinity).as("doc_number_dots")),
  );

  // "-1", "-9-10" — repeated, captured as a list.
  rule("subpart", () =>
    dash.then(digits.as("subpart_number")).repeat(1, Infinity).as("subpart"),
  );

  rule("code", () =>
    rules["type_letter"]!.then(rules["number_with_dots"]!, rules["subpart"]!.maybe()),
  );

  const editionValue = () =>
    digits.then(dot.then(digits).repeat(0, Infinity)).as("edition_value");

  rule("edition_human", () =>
    space.then(str("Ed"), space, editionValue()).as("edition"),
  );
  rule("edition_compact", () => colon.then(str("ed"), editionValue()).as("edition"));
  rule("edition", () => rules["edition_human"]!.or(rules["edition_compact"]!));

  rule("language", () =>
    space
      .maybe()
      .then(
        str("("),
        str("E").or(str("F"), str("S"), str("C"), str("A"), str("R")).as("language"),
        str(")"),
      )
      .as("language_group"),
  );

  rule("publisher", () => str("IALA").then(space).maybe());

  // The letter's absent-lowercase guard keeps "Ed 1"'s E from being
  // mis-captured as an annex letter. The letter takes an optional
  // trailing digit (the S-201 package's sub-numbered annexes "Annex B2"
  // / "Annex D1"), grammar#146.
  const annexLetter = () =>
    space
      .then(
        match("[A-Z]").then(match("[0-9]").maybe()).as("annex_letter"),
        match("[a-z]").absent(),
      )
      .maybe();

  rule("annex_identifier", () =>
    rules["publisher"]!
      .then(rules["type_letter"]!, rules["number_with_dots"]!, rules["subpart"]!.maybe())
      .as("base")
      .then(
        space,
        str("Annex").or(str("ANNEX")).as("annex_marker"),
        annexLetter(),
        rules["edition"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("plain_identifier", () =>
    rules["publisher"]!
      .then(rules["code"]!, rules["edition"]!.maybe(), rules["language"]!.maybe()),
  );

  // The S-100-family code: the hyphenated grant ("S-201"), the hundreds
  // digit fixed to 2 and exactly "200" excluded ("spans from S-201"),
  // so WMO's S-4xx and IHO's S-1xx never parse here.
  rule("s100_number", () =>
    str("200")
      .absent()
      .then(str("2").then(match("[0-9]"), match("[0-9]")))
      .as("s100_number"),
  );
  // The lower-case code spelling ("IALA s-201", the site-URL shape)
  // binds the typed form, never the codeless slug.
  rule("s100_code", () => str("S").or(str("s")).then(dash, rules["s100_number"]!));
  // The bare dotted edition is canonical; "Ed 2.0.0" is the alias.
  rule("s100_edition", () =>
    space.then(str("Ed").then(space).maybe(), editionValue()).as("edition"),
  );

  rule("s100_annex_identifier", () =>
    rules["publisher"]!
      .then(rules["s100_code"]!)
      .then(
        space,
        str("Annex").or(str("ANNEX")).as("annex_marker"),
        annexLetter(),
        rules["edition"]!.or(rules["s100_edition"]!).maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("s100_identifier", () =>
    rules["publisher"]!
      .then(rules["s100_code"]!)
      .then(
        rules["edition"]!.or(rules["s100_edition"]!).maybe(),
        rules["language"]!.maybe(),
      ),
  );

  // The codeless slug (gem #772): two or more hyphen-joined [a-z0-9]
  // runs, the first run NOT code-like (0-2 letters then digits — "s1070",
  // "ga01", "1070"), so a typed-code typo still fails. Last alternative:
  // every typed code keeps priority, and the mandatory "IALA " prefix
  // keeps any lower-case word from parsing.
  rule("slug_segment", () => match("[a-z0-9]").repeat(1, Infinity));
  rule("slug_code_like", () =>
    match("[a-z]")
      .repeat(0, 2)
      .then(match("[0-9]").repeat(1, Infinity), match("[a-z0-9]").absent()),
  );
  rule("slug", () =>
    rules["slug_code_like"]!
      .absent()
      .then(
        rules["slug_segment"]!,
        dash.then(rules["slug_segment"]!).repeat(1, Infinity),
      )
      .as("slug"),
  );
  rule("slug_identifier", () =>
    str("IALA ")
      .then(rules["slug"]!, rules["edition_human"]!.maybe(), rules["language"]!.maybe()),
  );

  rule("identifier", () =>
    rules["annex_identifier"]!.or(
      rules["plain_identifier"]!,
      rules["s100_annex_identifier"]!,
      rules["s100_identifier"]!,
      rules["slug_identifier"]!,
    ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ialaGrammar: Grammar = { rules: buildRules(), root: "root" };

const BASE_MAPPINGS = keyValue(
  { wire: "number", to: "number" },
  { wire: "edition", to: "edition" },
  { wire: "language", to: "language" },
);

export class IalaIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:iala:identifier";
  static attributes = extendAttributes(BaseIdentifier, {
    publisher: { type: "string", default: "IALA" },
    number: { type: "string" },
    edition: { type: "string" },
    language: { type: "string" },
  });
  static mappings = BASE_MAPPINGS;

  declare readonly number: string | undefined;
  declare readonly edition: string | undefined;
  declare readonly language: string | undefined;

  /** Single-letter type code (S, R, GA, …). */
  typeLetter(): string | undefined {
    return (this.constructor as unknown as { typeLetter?: string }).typeLetter;
  }

  render(): string {
    let rendered = `IALA ${this.typeLetter() ?? ""}${this.number ?? ""}`;
    if (this.edition !== undefined) rendered += ` Ed ${this.edition}`;
    if (this.language !== undefined) rendered += ` (${this.language})`;
    return rendered;
  }
}

class IalaUrnGenerator extends BaseUrnGenerator<IalaIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts: string[] = ["urn:mrn:iala:pub"];
    if (id instanceof IalaAnnex) {
      parts.push(this.baseCode(id.base!));
      parts.push(id.letter !== undefined ? `annex-${id.letter.toLowerCase()}` : "annex");
    } else {
      parts.push(this.baseCode(id));
    }
    if (id.edition !== undefined) parts.push(`ed${id.edition}`);
    if (id.language !== undefined) parts.push(id.language.toLowerCase());
    return parts.join(":");
  }

  // The lowercase document identifier in IALA's managed namespace
  // (G1143 §5.1.3): the legacy series codes join letter and number
  // ("s1070"), the S-100-family codes hyphenate ("s-201").
  private baseCode(base: IalaIdentifier): string {
    if (base instanceof IalaProductSpecification) return `s-${base.number}`;
    return `${base.typeLetter()?.toLowerCase()}${base.number}`;
  }
}

/** Class-driven canonical padding (number_width / dotted_segment_width). */
interface IalaTypeSpec {
  kind: string;
  letter: string;
  numberWidth?: number;
  dottedSegmentWidth?: number;
  /**
   * Additional type letters that route to this class — the Ruby
   * `type_letter_aliases` DSL (GeneralAssembly aliases the legacy "A"
   * session letter; there is no Advice type, pubid#734).
   */
  typeLetterAliases?: string[];
}

const IALA_TYPES: IalaTypeSpec[] = [
  { kind: "standard", letter: "S", numberWidth: 4 },
  { kind: "recommendation", letter: "R", numberWidth: 4 },
  { kind: "guideline", letter: "G", numberWidth: 4 },
  { kind: "manual", letter: "M", numberWidth: 4 },
  { kind: "model-course", letter: "C", numberWidth: 4 },
  // The A letter is GeneralAssembly's legacy session form, not a
  // separate series: all 11 A-shaped primary docidentifiers in
  // relaton-data-iala (A12-01, A13-01 through A13-04) are GA
  // resolutions, the covers read "GA Resolution A12-01", and no
  // Advice-series document exists in the catalogue (pubid#734).
  { kind: "general-assembly", letter: "GA", numberWidth: 2, dottedSegmentWidth: 2, typeLetterAliases: ["A"] },
  { kind: "letter", letter: "L" },
  { kind: "report", letter: "X" },
  { kind: "resolution", letter: "P" },
];

const TYPE_SPECS = new Map<string, IalaTypeSpec>(
  IALA_TYPES.flatMap((t) => [[t.letter, t] as [string, IalaTypeSpec]]
    .concat((t.typeLetterAliases ?? []).map((a) => [a, t] as [string, IalaTypeSpec]))),
);

function ialaClass(spec: IalaTypeSpec): IdentifierStatic {
  class IalaTypeIdentifier extends IalaIdentifier {
    static polymorphicName = `pubid:iala:${spec.kind}`;
    static urnGenerator = IalaUrnGenerator;
    static typeLetter = spec.letter;
    static typeLetterAliases: string[] = spec.typeLetterAliases ?? [];
  }
  if (spec.typeLetterAliases !== undefined) {
    // The legacy A-session letter renders for dashed numbers (A12-01);
    // dotted numbers carry the canonical GA letter. Derived from the
    // number shape, no extra attribute is stored — mirrors the Ruby
    // GeneralAssembly#type_letter override (pubid#734).
    IalaTypeIdentifier.prototype.typeLetter = function (this: IalaIdentifier) {
      return (this.number ?? "").includes("-")
        ? spec.typeLetterAliases![0]
        : (this.constructor as unknown as { typeLetter: string }).typeLetter;
    };
  }
  registerType(IalaTypeIdentifier as unknown as IdentifierStatic);
  return IalaTypeIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES = new Map<string, IdentifierStatic>(
  IALA_TYPES.flatMap((spec) => {
    const klass = ialaClass(spec);
    return [[spec.letter, klass] as [string, IdentifierStatic]]
      .concat((spec.typeLetterAliases ?? []).map((a) => [a, klass] as [string, IdentifierStatic]));
  }),
);

export class IalaAnnex extends IalaIdentifier {
  static polymorphicName = "pubid:iala:annex";
  static attributes = extendAttributes(IalaIdentifier, {
    base: { type: IalaIdentifier as unknown as IdentifierStatic },
    annex_form: { type: "string" },
    letter: { type: "string" },
  });
  // The inherited block merges with the annex's own maps (lutaml
  // semantics): number/edition/language + base/annex_form/letter.
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "edition", to: "edition" },
    { wire: "language", to: "language" },
    { wire: "base", to: "base" },
    { wire: "annex_form", to: "annex_form" },
    { wire: "letter", to: "letter" },
  );
  static urnGenerator = IalaUrnGenerator;

  declare readonly base: IalaIdentifier | undefined;
  declare readonly annex_form: string | undefined;
  declare readonly letter: string | undefined;

  typeLetter(): string | undefined {
    return undefined;
  }

  render(): string {
    const baseStr = this.base?.toHuman() ?? "";
    const s100Base = this.base instanceof IalaProductSpecification;
    let rendered = `${baseStr} ${this.annex_form ?? ""}`;
    if (this.letter !== undefined) rendered += ` ${this.letter}`;
    if (this.edition !== undefined) {
      // The edition face follows the base's family: bare for an
      // S-100-family base ("S-201 Annex A 1.0.0"), "Ed" for the legacy
      // series ("G1128 ANNEX A Ed 1.6").
      rendered += s100Base ? ` ${this.edition}` : ` Ed ${this.edition}`;
    }
    if (this.language !== undefined) rendered += ` (${this.language})`;
    return rendered;
  }
}
registerType(IalaAnnex as unknown as IdentifierStatic);

/**
 * The S-100-family product specification — the IHO-granted S-201..S-299
 * range (pubid#777). The hyphenated code face is rendered by the
 * renderer/URN generator directly; there is no type letter (an "S"
 * short would collide with Standard's). The canonical face is bare —
 * the designation carries no publisher token (the WMO S-100 rule).
 */
export class IalaProductSpecification extends IalaIdentifier {
  static polymorphicName = "pubid:iala:product-specification";
  static urnGenerator = IalaUrnGenerator;

  typeLetter(): string | undefined {
    return undefined;
  }

  render(): string {
    let rendered = `S-${this.number ?? ""}`;
    if (this.edition !== undefined) rendered += ` ${this.edition}`;
    if (this.language !== undefined) rendered += ` (${this.language})`;
    return rendered;
  }
}
registerType(IalaProductSpecification as unknown as IdentifierStatic);

/**
 * The codeless slug publication (gem #772): iala.int reports and
 * proceedings with no code, named by their product-URL slug. The slug
 * is held in the inherited `number` attribute — the index key — and no
 * padding applies. There is no type letter: "IALA <slug>".
 */
export class IalaPublication extends IalaIdentifier {
  static polymorphicName = "pubid:iala:publication";
  static urnGenerator = IalaUrnGenerator;

  typeLetter(): string | undefined {
    return undefined;
  }

  // IALA assigns no MRN to a codeless publication, so it has no
  // official URN (the gem's Publication#to_urn → nil); to_pubid_urn
  // still names it.
  toUrn(): string {
    return undefined as unknown as string;
  }
}
registerType(IalaPublication as unknown as IdentifierStatic);

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const isObj = (v: Tree): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const s = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const str = Array.isArray(v) ? v.join("") : String(v);
  return str.length > 0 ? str : undefined;
};

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

function subpartToS(subpart: Tree): string {
  if (Array.isArray(subpart)) {
    return subpart
      .map((h) => (isObj(h) ? s(h["subpart_number"]) : undefined))
      .filter((v): v is string => v !== undefined)
      .join("-");
  }
  return s(subpart) ?? "";
}

function canonicalBase(base: string, spec: IalaTypeSpec): string {
  return spec.numberWidth !== undefined ? base.padStart(spec.numberWidth, "0") : base;
}

function canonicalDots(dots: string, spec: IalaTypeSpec): string {
  if (dots === "") return "";
  if (spec.dottedSegmentWidth === undefined) return dots;
  return dots
    .split(".")
    .map((seg) => (seg === "" ? seg : seg.padStart(spec.dottedSegmentWidth!, "0")))
    .join(".");
}

function buildNumber(hash: TreeObject, spec: IalaTypeSpec): string | undefined {
  const base = s(hash["doc_number"]);
  if (base === undefined) return undefined;
  const dots = canonicalDots(s(hash["doc_number_dots"]) ?? "", spec);
  let subpartStr = hash["subpart"] !== undefined ? `-${subpartToS(hash["subpart"])}` : "";
  if (subpartStr === "-") subpartStr = "";
  return `${canonicalBase(base, spec)}${dots}${subpartStr}`;
}

class IalaBuilder {
  build(data: Tree): BaseIdentifier {
    const hash = flatten(data);
    if (hash["annex_marker"] !== undefined) return this.buildAnnex(hash);
    if (hash["s100_number"] !== undefined) return this.buildProductSpec(hash);
    if (hash["slug"] !== undefined) return this.buildPublication(hash);
    return this.buildFlat(hash);
  }

  private buildFlat(hash: TreeObject): BaseIdentifier {
    const typeLetter = s(hash["type_letter"])?.toUpperCase();
    const spec = TYPE_SPECS.get(typeLetter ?? "");
    if (spec === undefined) throw new ParseFailed(`IALA: unknown type letter ${typeLetter}`, 0);
    const klass = KIND_CLASSES.get(spec.letter)!;
    const attrs: Record<string, unknown> = {};
    const number = buildNumber(hash, spec);
    if (number !== undefined) attrs["number"] = number;
    const editionHash = isObj(hash["edition"]) ? flatten(hash["edition"] as Tree) : undefined;
    const edition = editionHash !== undefined ? s(editionHash["edition_value"]) : undefined;
    if (edition !== undefined) attrs["edition"] = edition;
    const languageHash = isObj(hash["language_group"]) ? flatten(hash["language_group"] as Tree) : undefined;
    const language = languageHash !== undefined ? s(languageHash["language"])?.toUpperCase() : undefined;
    if (language !== undefined) attrs["language"] = language;
    return new (klass as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }

  // The S-100-family product specification: the s100_number capture
  // (the digits after "S-", e.g. "201") is the whole identity; the
  // hyphen and the S are the code face the renderer and the URN
  // generator add. The edition is the S-100 dotted x.y.z, verbatim.
  private buildProductSpec(hash: TreeObject): BaseIdentifier {
    const attrs: Record<string, unknown> = {};
    const number = s(hash["s100_number"]);
    if (number !== undefined) attrs["number"] = number;
    const editionHash = isObj(hash["edition"]) ? flatten(hash["edition"] as Tree) : undefined;
    const edition = editionHash !== undefined ? s(editionHash["edition_value"]) : undefined;
    if (edition !== undefined) attrs["edition"] = edition;
    const languageHash = isObj(hash["language_group"]) ? flatten(hash["language_group"] as Tree) : undefined;
    const language = languageHash !== undefined ? s(languageHash["language"])?.toUpperCase() : undefined;
    if (language !== undefined) attrs["language"] = language;
    return new IalaProductSpecification(attrs);
  }

  // The codeless publication: the slug is its whole identity and goes
  // into `number`, verbatim (no padding applies).
  private buildPublication(hash: TreeObject): BaseIdentifier {
    const attrs: Record<string, unknown> = {};
    const number = s(hash["slug"]);
    if (number !== undefined) attrs["number"] = number;
    const editionHash = isObj(hash["edition"]) ? flatten(hash["edition"] as Tree) : undefined;
    const edition = editionHash !== undefined ? s(editionHash["edition_value"]) : undefined;
    if (edition !== undefined) attrs["edition"] = edition;
    const languageHash = isObj(hash["language_group"]) ? flatten(hash["language_group"] as Tree) : undefined;
    const language = languageHash !== undefined ? s(languageHash["language"])?.toUpperCase() : undefined;
    if (language !== undefined) attrs["language"] = language;
    return new IalaPublication(attrs);
  }

  private buildAnnex(hash: TreeObject): BaseIdentifier {
    // The S-100 annex stays flat (the grammar's base composite is
    // unbound there — the s100_number capture is the only occurrence of
    // its name on the annex path); the legacy annex nests its base
    // composite under "base".
    const s100Number = s(hash["s100_number"]);
    const base =
      s100Number !== undefined
        ? new IalaProductSpecification({ number: s100Number })
        : this.buildFlat(flatten(hash["base"] as Tree));
    const attrs: Record<string, unknown> = {
      base,
      annex_form: s(hash["annex_marker"]),
    };
    const letter = s(hash["annex_letter"]);
    if (letter !== undefined) attrs["letter"] = letter;
    const editionHash = isObj(hash["edition"]) ? flatten(hash["edition"] as Tree) : undefined;
    const edition = editionHash !== undefined ? s(editionHash["edition_value"]) : undefined;
    if (edition !== undefined) attrs["edition"] = edition;
    const languageHash = isObj(hash["language_group"]) ? flatten(hash["language_group"] as Tree) : undefined;
    const language = languageHash !== undefined ? s(languageHash["language"])?.toUpperCase() : undefined;
    if (language !== undefined) attrs["language"] = language;
    return new IalaAnnex(attrs);
  }
}

export function ialaGrammarImplementation(): FlavorImplementation {
  const builder = new IalaBuilder();
  const parseHuman = (input: string): BaseIdentifier => {
    const tree = parseGrammar(ialaGrammar, input.trim());
    if (typeof tree !== "object" || tree === null) {
      throw new ParseFailed("IALA: unexpected parse tree", 0);
    }
    return builder.build(tree);
  };

  const URN_PREFIX = "urn:mrn:iala:pub:";

  /**
   * Parses an MRN URN by reconstructing the human form and re-parsing
   * (lib/pubid/iala/urn_parser.rb). The edition marker is
   * case-insensitive with an optional dot ("Ed1.0" / "ed.1.0"), and
   * the annex casing mirrors the generator: bare "annex" → "Annex",
   * lettered "annex-a" → "ANNEX A".
   */
  const parseUrn = (urn: string): BaseIdentifier => {
    if (!urn.toLowerCase().startsWith(URN_PREFIX)) {
      throw new ParseFailed(`Invalid IALA URN: ${JSON.stringify(urn)}`, 0);
    }
    const parts = urn.slice(URN_PREFIX.length).split(":");
    const code = parts[0] ?? "";
    let edition: string | undefined;
    let language: string | undefined;
    let annexForm: string | undefined;
    let annexLetter: string | undefined;
    for (const seg of parts.slice(1)) {
      // The letter carries the sub-numbered S-100 annex letters
      // ("annex-b2"); the generator emits "annex" (bare) for the
      // Annex-without-letter form and "annex-X" for the uppercase
      // ANNEX form — mirror it so the round-trip is exact.
      const annexMatch = /^annex(-([a-z]\d?))?$/i.exec(seg);
      if (annexMatch !== null) {
        annexLetter = annexMatch[2]?.toUpperCase();
        annexForm = annexLetter !== undefined ? "ANNEX" : "Annex";
      } else if (/^ed\.?/i.test(seg)) {
        edition = seg.replace(/^ed\.?/i, "");
      } else if (/^[a-z]$/i.test(seg)) {
        language = seg.toUpperCase();
      }
    }
    let text = `IALA ${code.toUpperCase()}`;
    if (annexForm !== undefined) text += ` ${annexForm}`;
    if (annexLetter !== undefined) text += ` ${annexLetter}`;
    if (edition !== undefined) text += ` Ed ${edition}`;
    if (language !== undefined) text += ` (${language})`;
    return parseHuman(text);
  };

  return {
    parse(input: string): Identifier {
      const identifier = input.toLowerCase().startsWith(URN_PREFIX) ? parseUrn(input) : parseHuman(input);
      return identifier as unknown as Identifier;
    },
  };
}
