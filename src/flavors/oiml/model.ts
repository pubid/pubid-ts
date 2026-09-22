import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed } from "../../grammar/engine.js";
import { BaseIdentifier, registerType, resolveType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import type { AttributeTable } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * The OIML identifier model on the unified model — one BaseIdentifier
 * subclass per Ruby class (lib/pubid/oiml/identifiers/*). Attribute
 * names are snake_case so the default wire mapping matches the Ruby
 * key_value; parsed_format defaults to "short" (dropped from the hash),
 * space_suffix/trailing/joined/year_on_base default false (dropped).
 * Supplements declare a mapping list so supp_year serializes under the
 * "year" wire key and the nested base round-trips polymorphically.
 */

type OimlKind =
  | "recommendation"
  | "basic-publication"
  | "document"
  | "guide"
  | "vocabulary"
  | "expert-report"
  | "seminar-report"
  | "bulletin"
  | "amendment"
  | "errata"
  | "annex";

const KIND_BY_TYPE: Record<string, OimlKind> = {
  B: "basic-publication",
  D: "document",
  E: "expert-report",
  G: "guide",
  R: "recommendation",
  S: "seminar-report",
  V: "vocabulary",
};

const TYPE_STRINGS: Record<string, string> = {
  "basic-publication": "B",
  document: "D",
  "expert-report": "E",
  guide: "G",
  recommendation: "R",
  "seminar-report": "S",
  vocabulary: "V",
};

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: Tree): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

/** Ruby Builder#extract_language. */
function extractLanguage(langData: Tree): string | undefined {
  if (isObj(langData)) return str(langData["language"]);
  return str(langData);
}

/** ---- shared attribute tables (snake_case = default wire names) ---- */

const SINGLE_ATTRS = {
  publisher: { type: "string" },
  language: { type: "string" },
  parsed_format: { type: "string", default: "short" },
  number: { type: "string" },
  part: { type: "string" },
  subpart: { type: "string" },
  suffix: { type: "string" },
  space_suffix: { type: "boolean", default: false },
  year: { type: "string" },
  edition: { type: "string" },
  stage: { type: "string" },
  iteration: { type: "string" },
} as const;


abstract class OimlBase extends BaseIdentifier {
  declare readonly publisher: string | undefined;
  declare readonly language: string | undefined;
  declare readonly parsed_format: string | undefined;

  effectiveFormat(): "long" | "short" {
    return this.parsed_format === "long" ? "long" : "short";
  }
}

/** ---- single documents (CodeNumber + Bulletin) ---- */

abstract class OimlSingle extends OimlBase {
  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly subpart: string | undefined;
  declare readonly suffix: string | undefined;
  declare readonly space_suffix: boolean | undefined;
  declare readonly year: string | undefined;
  declare readonly edition: string | undefined;
  declare readonly stage: string | undefined;
  declare readonly iteration: string | undefined;

  /** Ruby Identifiers::CodeNumber#code. */
  composedCode(): string | undefined {
    if (this.number === undefined) return undefined;
    let result = this.number;
    if (this.part) result += `-${this.part}`;
    if (this.subpart) result += `-${this.subpart}`;
    if (this.suffix) result += `${this.space_suffix ? " " : "-"}${this.suffix}`;
    return result;
  }

  typeString(): string {
    return TYPE_STRINGS[this.constructor.polymorphicName.slice("pubid:oiml:".length)] ?? "R";
  }

  /** renderSingle — the formatOverride threads through supplement rendering. */
  render(formatOverride?: string): string {
    const format = formatOverride ?? this.effectiveFormat();
    let result = `${this.publisher} ${this.typeString()} ${this.composedCode()}`;
    let usingEditionFormat = false;

    if (this.edition && this.year) {
      result += ` ${this.edition} Edition ${this.year}`;
      usingEditionFormat = true;
    } else if (this.edition) {
      result += ` ${this.edition}`;
      usingEditionFormat = true;
    } else if (this.year) {
      if (format === "long") {
        result += ` Edition ${this.year}`;
        usingEditionFormat = true;
      } else {
        result += `:${this.year}`;
      }
    }

    if (this.stage || this.iteration) {
      result += " ";
      if (this.iteration) result += this.iteration;
      if (this.stage) result += this.stage;
    }

    if (this.language) {
      result +=
        usingEditionFormat || this.parsed_format === "short_with_space"
          ? ` (${this.language})`
          : `(${this.language})`;
    }
    return result;
  }
}

function oimlSingleClass(kind: OimlKind): IdentifierStatic {
  const isBulletin = kind === "bulletin";
  class OimlSingleIdentifier extends OimlSingle {
    static polymorphicName = `pubid:oiml:${kind}`;
    static attributes = isBulletin
      ? extendAttributes(BaseIdentifier, { ...SINGLE_ATTRS, sequence: { type: "string" } })
      : extendAttributes(BaseIdentifier, SINGLE_ATTRS);
    declare readonly sequence: string | undefined;

    render(formatOverride?: string): string {
      if (!isBulletin) return super.render(formatOverride);
      // renderBulletin
      if (
        this.parsed_format === "citation" &&
        this.year &&
        this.number &&
        this.sequence
      ) {
        return `${this.publisher} Bulletin ${toRoman(Number(this.year) - 1959)}(${Number(this.number)}) ${this.year}${this.number}${this.sequence}`;
      }
      let result = `${this.publisher} Bulletin`;
      if (this.year) {
        result += ` ${this.year}`;
        if (this.number) result += `-${this.number}`;
        if (this.sequence) result += `-${this.sequence}`;
      }
      if (this.language) result += ` (${this.language})`;
      return result;
    }
  }
  registerType(OimlSingleIdentifier as unknown as IdentifierStatic);
  return OimlSingleIdentifier as unknown as IdentifierStatic;
}

const SUPP_ATTRS: AttributeTable = {
  language: { type: "string" },
  parsed_format: { type: "string", default: "short" },
  base: { type: OimlSingle as unknown as IdentifierStatic },
  supp_year: { type: "string" },
  trailing: { type: "boolean", default: false },
  joined: { type: "boolean", default: false },
  letter: { type: "string" },
  year_on_base: { type: "boolean", default: false },
} as const;

const SUPP_MAPPINGS = keyValue(
  { wire: "language", to: "language" },
  { wire: "parsed_format", to: "parsed_format" },
  { wire: "base", to: "base" },
  { wire: "year", to: "supp_year" },
  { wire: "trailing", to: "trailing" },
  { wire: "joined", to: "joined" },
  { wire: "letter", to: "letter" },
  { wire: "year_on_base", to: "year_on_base" },
);

/** ---- supplements (Amendment / Errata) and Annex ---- */

abstract class OimlSupplement extends OimlBase {
  declare readonly base: OimlSingle;
  declare readonly supp_year: string | undefined;
  declare readonly trailing: boolean | undefined;
  declare readonly joined: boolean | undefined;
  declare readonly letter: string | undefined;
  declare readonly year_on_base: boolean | undefined;

  supplementType(): string {
    const kind = this.constructor.polymorphicName.slice("pubid:oiml:".length);
    if (kind === "annex") return this.letter ? `Annex ${this.letter}` : "Annexes";
    return kind === "errata" ? "Errata" : "Amendment";
  }

  render(): string {
    const kind = this.constructor.polymorphicName.slice("pubid:oiml:".length);
    if (kind === "annex") return this.renderAnnex();
    return this.renderSupplement();
  }

  /** renderSupplement */
  private renderSupplement(): string {
    if (this.joined) {
      let result = `${stripLanguage(this.base.render())}+${this.supplementType()}`;
      if (this.supp_year) result += `:${this.supp_year}`;
      if (this.language) result += ` (${this.language})`;
      return result;
    }

    if (this.trailing) {
      let result = `${stripLanguage(this.base.render())} ${this.supplementType()}`;
      if (this.language) result += ` (${this.language})`;
      return result;
    }

    const baseFormat =
      this.effectiveFormat() !== "short"
        ? this.effectiveFormat()
        : this.base.parsed_format === "long"
          ? "long"
          : "short";
    const baseStr = stripLanguage(this.base.render(baseFormat));

    let result = `${this.supplementType()} (${this.supp_year}) to ${baseStr}`;
    if (this.language) result += ` (${this.language})`;
    return result;
  }

  /** renderAnnex */
  private renderAnnex(): string {
    if (this.year_on_base) {
      const marker = this.letter ? `Annex ${this.letter}` : "Annexes";
      let result = `${stripLanguage(this.base.render())} ${marker}`;
      if (this.language) result += ` (${this.language})`;
      return result;
    }

    const annexFormat = this.effectiveFormat();
    const baseStr = this.base
      .render(this.base.parsed_format === "long" ? "long" : "short")
      .replace(/:.*/, "")
      .replace(/\s+Edition\s+\d{4}/, "")
      .replace(/\(.*\)/, "")
      .trim();

    let result = baseStr;
    if (this.letter) {
      result += ` Annex ${this.letter}`;
      if (this.supp_year) result += ` Edition ${this.supp_year}`;
    } else {
      result += " Annexes";
      if (this.supp_year) {
        if (annexFormat === "long") {
          result += ` Edition ${this.supp_year}`;
        } else {
          result += `:${this.supp_year}`;
        }
      }
    }
    if (this.language) result += ` (${this.language})`;
    return result;
  }
}

function oimlSupplementClass(kind: "amendment" | "errata" | "annex"): IdentifierStatic {
  class OimlSupplementIdentifier extends OimlSupplement {
    static polymorphicName = `pubid:oiml:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, SUPP_ATTRS);
    static mappings = SUPP_MAPPINGS;
  }
  registerType(OimlSupplementIdentifier as unknown as IdentifierStatic);
  return OimlSupplementIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES: Partial<Record<OimlKind, IdentifierStatic>> = {};
for (const kind of [
  "recommendation", "basic-publication", "document", "guide", "vocabulary",
  "expert-report", "seminar-report", "bulletin",
] as const) {
  KIND_CLASSES[kind] = oimlSingleClass(kind);
}
KIND_CLASSES["amendment"] = oimlSupplementClass("amendment");
KIND_CLASSES["errata"] = oimlSupplementClass("errata");
KIND_CLASSES["annex"] = oimlSupplementClass("annex");

/** ---- URN generator (lib/pubid/oiml/urn_generator.rb, all kinds) ---- */

class OimlUrnGenerator extends BaseUrnGenerator<OimlBase> {
  generate(): string {
    const id = this.identifier;
    const kind = id.constructor.polymorphicName.slice("pubid:oiml:".length);
    if (kind === "bulletin") {
      const b = id as unknown as OimlSingle & { sequence?: string };
      const parts = ["urn", "oiml", "bulletin"];
      if (b.year) {
        let locator = b.year;
        if (b.number) locator += `-${b.number}`;
        if (b.sequence) locator += `-${b.sequence}`;
        parts.push(locator);
      }
      if (id.language) parts.push(id.language.toLowerCase());
      return parts.join(":");
    }

    const isSupp = kind === "amendment" || kind === "errata" || kind === "annex";
    const single = (isSupp ? (id as unknown as OimlSupplement).base : (id as unknown as OimlSingle));
    const parts = ["urn", "oiml"];
    // Ruby: `return "r" unless identifier.type` — a supplement has no
    // type letter, so its URN carries the default "r" (corpus quirk).
    parts.push(isSupp ? "r" : (TYPE_STRINGS[kind] ?? "r").toLowerCase());
    // Ruby SupplementIdentifier#code delegates to the wrapped standard.
    const code = single.composedCode();
    if (code) parts.push(code);
    const year = (id as unknown as { year?: string }).year ??
      (id as unknown as OimlSupplement).supp_year;
    if (year) parts.push(year);
    const stage = (id as unknown as { stage?: string }).stage;
    if (stage) parts.push(stage.toLowerCase());
    const iteration = (id as unknown as { iteration?: string }).iteration;
    if (iteration) parts.push(iteration);
    if (id.language) parts.push(id.language.toLowerCase());
    return parts.join(":");
  }
}
for (const klass of Object.values(KIND_CLASSES)) {
  (klass as unknown as Record<string, unknown>).urnGenerator = OimlUrnGenerator;
}

/** ---- builder (lib/pubid/oiml/builder.rb) ---- */

// OIML co-publishes some documents jointly with another SDO (ISO so
// far); the printed reference carries both identifiers joined by "|":
// "ISO 4064-1:2024|OIML R 49-1:2024". The URN is the OIML side's.
export class OimlDualPublished extends OimlBase {
  static polymorphicName = "pubid:oiml:dual-published";
  static get attributes() {
    return extendAttributes(OimlBase, {
      // "string" keeps objects passing through the scalar coercion
      // untouched (the ieee AdoptedStandard precedent for cross-flavor
      // members); the constructor coerces bare hashes via the registry.
      first: { type: "string" },
      second: { type: "string" },
    });
  }
  static get mappings() {
    return [
      { wire: "first", to: "first" } as never,
      { wire: "second", to: "second" } as never,
    ];
  }

  declare readonly first: BaseIdentifier;
  declare readonly second: BaseIdentifier;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    // The members are cross-flavor (the co-publisher's side arrives as a
    // bare hash with _type); coerce through the registry - the abstract
    // BaseIdentifier attribute type cannot dispatch polymorphically.
    const coerceMember = (v: unknown): BaseIdentifier | undefined => {
      if (v instanceof BaseIdentifier) return v;
      if (typeof v === "object" && v !== null && "_type" in (v as Record<string, unknown>)) {
        const klass = resolveType((v as Record<string, unknown>)["_type"] as string);
        if (klass !== undefined) {
          return klass.fromHash(v as Record<string, unknown>) as unknown as BaseIdentifier;
        }
      }
      return undefined;
    };
    const self = this as unknown as Record<string, unknown>;
    const f = coerceMember(self["first"]);
    const s = coerceMember(self["second"]);
    if (f !== undefined) self["first"] = f;
    if (s !== undefined) self["second"] = s;
  }

  render(): string {
    return `${this.first.toHuman()}|${this.second.toHuman()}`;
  }

  toUrn(): string {
    // The URN is the OIML side's, whichever position it prints in.
    const oimlSide =
      this.second instanceof OimlBase ? this.second : this.first;
    return oimlSide.toUrn();
  }

  root(): BaseIdentifier {
    return this.second instanceof OimlBase ? this.second : this.first;
  }
}
registerType(OimlDualPublished as unknown as IdentifierStatic);

export function buildOimlIdentifier(tree: Tree): BaseIdentifier {
  if (!isObj(tree)) throw new ParseFailed("OIML: unexpected parse tree", 0);

  if (tree["amd_marker"] !== undefined) return buildShortAmendment(tree);
  if (tree["base"] !== undefined) return buildSupplement(tree);
  return buildBaseDocument(tree);
}

function buildShortAmendment(tree: TreeObject): BaseIdentifier {
  const baseCode = isObj(tree["base_code"]) ? tree["base_code"] : undefined;
  const base = buildBaseDocument({
    publisher: tree["publisher"],
    type: tree["type"],
    number: baseCode?.["number"],
    part: baseCode?.["part"],
    subpart: baseCode?.["subpart"],
  }) as unknown as OimlSingle;

  const editionFormat = isObj(tree["edition_format"]) ? tree["edition_format"] : undefined;
  const yearValue = editionFormat ? editionFormat["year"] : tree["year"];

  const attrs: Record<string, unknown> = {
    publisher: "OIML",
    base,
    parsed_format: editionFormat ? "long" : "short",
  };
  const suppYear = str(yearValue);
  if (suppYear !== undefined) attrs["supp_year"] = suppYear;
  const language = extractLanguage(tree["language"]);
  if (language !== undefined) attrs["language"] = language;
  return new (KIND_CLASSES["amendment"] as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
}

function buildSupplement(tree: TreeObject): BaseIdentifier {
  const marker = str(tree["trailing_marker"]);
  const plusMarker = str(tree["plus_marker"]);

  let kind: "amendment" | "errata" | "annex";
  if (tree["annex_letter"] !== undefined || tree["annex_marker"] !== undefined) {
    kind = "annex";
  } else if (marker === "Errata" || plusMarker === "Errata") {
    kind = "errata";
  } else {
    kind = "amendment";
  }

  const base = buildOimlIdentifier(tree["base"]) as unknown as OimlSingle;

  const editionFormat = isObj(tree["edition_format"]) ? tree["edition_format"] : undefined;
  const yearValue = editionFormat ? editionFormat["year"] : tree["year"];

  const attrs: Record<string, unknown> = {
    publisher: "OIML",
    base,
    parsed_format: editionFormat ? "long" : "short",
  };
  const suppYear = str(yearValue);
  if (suppYear !== undefined) attrs["supp_year"] = suppYear;
  const language = extractLanguage(tree["language"]);
  if (language !== undefined) attrs["language"] = language;
  if (marker !== undefined) attrs["trailing"] = true;
  if (plusMarker !== undefined) attrs["joined"] = true;
  const letter = str(tree["annex_letter"]);
  if (letter !== undefined) attrs["letter"] = letter;

  // Annex with no year of its own but a dated base: the year belongs to
  // the base and must render glued to it.
  if (kind === "annex" && !yearValue && base.year) attrs["year_on_base"] = true;

  return new (KIND_CLASSES[kind] as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
}

function buildBaseDocument(tree: TreeObject): BaseIdentifier {
  const type = str(tree["type"]);
  const kind: OimlKind = type === "Bulletin" ? "bulletin" : KIND_BY_TYPE[type ?? ""] ?? "recommendation";

  const attrs: Record<string, unknown> = {
    publisher: str(tree["publisher"]) ?? "OIML",
  };
  const number = str(tree["number"]);
  if (number !== undefined) attrs["number"] = number;
  const part = str(tree["part"]);
  if (part !== undefined) attrs["part"] = part;
  const subpart = str(tree["subpart"]);
  if (subpart !== undefined) attrs["subpart"] = subpart;
  const codeSuffix = str(tree["code_suffix"]);
  if (codeSuffix !== undefined) attrs["suffix"] = codeSuffix;
  if ("space_suffix" in tree) attrs["space_suffix"] = true;

  const editionFormat = isObj(tree["edition_format"]) ? tree["edition_format"] : undefined;
  let yearValue: Tree;
  if (editionFormat) {
    yearValue = editionFormat["year"];
    const edition = str(editionFormat["edition"]);
    if (edition !== undefined) attrs["edition"] = edition;
  } else {
    yearValue = tree["year"];
  }
  const year = str(yearValue);
  if (year !== undefined) attrs["year"] = year;

  if (kind === "bulletin") applyBulletinLocator(attrs, tree);

  attrs["parsed_format"] = editionFormat
    ? "long"
    : tree["space_before_lang"] !== undefined
      ? "short_with_space"
      : tree["article_id"] !== undefined
        ? "citation"
        : "short";

  const stage = str(tree["stage"]);
  if (stage !== undefined) attrs["stage"] = stage;
  const iteration = str(tree["iteration"]);
  if (iteration !== undefined) attrs["iteration"] = iteration;
  const language = extractLanguage(tree["language"]);
  if (language !== undefined) attrs["language"] = language;

  return new (KIND_CLASSES[kind] as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
}

function applyBulletinLocator(attrs: Record<string, unknown>, tree: TreeObject): void {
  const articleId = str(tree["article_id"]);
  if (articleId) {
    attrs["year"] = articleId.slice(0, 4);
    attrs["number"] = articleId.slice(4, 6);
    attrs["sequence"] = articleId.slice(6, 8);
    return;
  }
  const issue = str(tree["issue"]);
  if (issue !== undefined) attrs["number"] = issue;
  const sequence = str(tree["sequence"]);
  if (sequence !== undefined) attrs["sequence"] = sequence;
}

/** ---- shared render helpers ---- */

function stripLanguage(s: string): string {
  return s.replace(/\s*\([^)]+\)\s*$/, "").trim();
}

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"],
    [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"],
    [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [value, sym] of table) {
    while (n >= value) {
      out += sym;
      n -= value;
    }
  }
  return out;
}
