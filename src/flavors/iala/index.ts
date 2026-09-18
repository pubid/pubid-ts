import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";

/**
 * 1:1 port of lib/pubid/iala/ — 706 corpus rows. Typed prefixes
 * (S/R/G/M/C/A/GA/L/X/P), class-driven zero-padding (4 for S/R/G/M/C,
 * 2+2 dotted for GA, verbatim for the rest), "Ed 2.0" and ":ed2.0"
 * edition forms, (F) languages, and Annex wrappers. URN is the MRN
 * form: urn:mrn:iala:pub:<lower-code>[:ed<n>][:<lang>].
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
  // mis-captured as an annex letter.
  rule("annex_identifier", () =>
    rules["publisher"]!
      .then(rules["type_letter"]!, rules["number_with_dots"]!, rules["subpart"]!.maybe())
      .as("base")
      .then(
        space,
        str("Annex").or(str("ANNEX")).as("annex_marker"),
        space
          .then(match("[A-Z]").as("annex_letter"), match("[a-z]").absent())
          .maybe(),
        rules["edition"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("identifier", () =>
    rules["annex_identifier"]!.or(
      rules["publisher"]!
        .then(rules["code"]!, rules["edition"]!.maybe(), rules["language"]!.maybe()),
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
    if (id instanceof IalaAnnex) {
      const parts = ["urn:mrn:iala:pub", `${id.base!.typeLetter()?.toLowerCase()}${id.base!.number}`];
      parts.push(id.letter !== undefined ? `annex-${id.letter.toLowerCase()}` : "annex");
      if (id.edition !== undefined) parts.push(`ed${id.edition}`);
      if (id.language !== undefined) parts.push(id.language.toLowerCase());
      return parts.join(":");
    }
    const parts = ["urn:mrn:iala:pub", `${id.typeLetter()?.toLowerCase()}${id.number}`];
    if (id.edition !== undefined) parts.push(`ed${id.edition}`);
    if (id.language !== undefined) parts.push(id.language.toLowerCase());
    return parts.join(":");
  }
}

/** Class-driven canonical padding (number_width / dotted_segment_width). */
interface IalaTypeSpec {
  kind: string;
  letter: string;
  numberWidth?: number;
  dottedSegmentWidth?: number;
}

const IALA_TYPES: IalaTypeSpec[] = [
  { kind: "standard", letter: "S", numberWidth: 4 },
  { kind: "recommendation", letter: "R", numberWidth: 4 },
  { kind: "guideline", letter: "G", numberWidth: 4 },
  { kind: "manual", letter: "M", numberWidth: 4 },
  { kind: "model-course", letter: "C", numberWidth: 4 },
  { kind: "advice", letter: "A" },
  { kind: "general-assembly", letter: "GA", numberWidth: 2, dottedSegmentWidth: 2 },
  { kind: "letter", letter: "L" },
  { kind: "report", letter: "X" },
  { kind: "resolution", letter: "P" },
];

const TYPE_SPECS = new Map<string, IalaTypeSpec>(IALA_TYPES.map((t) => [t.letter, t]));

function ialaClass(spec: IalaTypeSpec): IdentifierStatic {
  class IalaTypeIdentifier extends IalaIdentifier {
    static polymorphicName = `pubid:iala:${spec.kind}`;
    static urnGenerator = IalaUrnGenerator;
    static typeLetter = spec.letter;
  }
  registerType(IalaTypeIdentifier as unknown as IdentifierStatic);
  return IalaTypeIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES = new Map<string, IdentifierStatic>(
  IALA_TYPES.map((spec) => [spec.letter, ialaClass(spec)]),
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
    let rendered = `${this.base?.toHuman() ?? ""} ${this.annex_form ?? ""}`;
    if (this.letter !== undefined) rendered += ` ${this.letter}`;
    if (this.edition !== undefined) rendered += ` Ed ${this.edition}`;
    if (this.language !== undefined) rendered += ` (${this.language})`;
    return rendered;
  }
}
registerType(IalaAnnex as unknown as IdentifierStatic);

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

  private buildAnnex(hash: TreeObject): BaseIdentifier {
    const baseHash = flatten(hash["base"] as Tree);
    const base = this.buildFlat(baseHash);
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
      const annexMatch = /^annex(-([a-z]))?$/i.exec(seg);
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
