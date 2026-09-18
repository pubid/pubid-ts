import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { BaseBuilder } from "../../model/builder.js";
import { PubidDate, Language } from "../../model/component.js";

/**
 * Port of lib/pubid/jcgm/ on the unified model. Five concrete classes
 * (guide, gum-guide, meeting, amendment, corrigendum); the date
 * serializes FLAT as year/month/day through the converter mapping trio
 * (Ruby's year_to_kv pattern); the ordinal suffix ("11st") is computed
 * from the number at render time; supplements hold a nested base. The
 * typed_stage is runtime-derived from the class (never serialized).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digits = match("[0-9]").repeat(1, Infinity);
  // CommonParseRules year_digits: 19xx/20xx not followed by a digit.
  const yearDigits = str("19").or(str("20")).then(match("\\d").repeat(2, 2), digits.absent());
  const monthDigits = match("[0-9]").repeat(2, 2);
  const dayDigits = match("[0-9]").repeat(2, 2);
  const fullDate = yearDigits.then(str("-"), monthDigits, str("-"), dayDigits).as("date");
  const datePortion = str(":").then(fullDate.or(yearDigits.as("date")));

  rule("publisher", () => str("JCGM").as("publisher"));
  rule(
    "number_portion",
    () => str("GUM-").then(digits.as("gum_number")).or(digits.as("number")),
  );
  rule("language_portion", () =>
    str("(")
      .then(
        (str("E/F").or(str("F/E")).or(match("[A-Z]"))).as("languages"),
        str(")"),
      ),
  );
  rule("base", () =>
    rules["publisher"]!
      .then(space, rules["number_portion"]!)
      .then(datePortion.maybe())
      .then(rules["language_portion"]!.maybe()),
  );
  rule("ordinal_suffix", () => str("st").or(str("nd"), str("rd"), str("th")));
  rule("meeting_identifier", () =>
    rules["publisher"]!
      .then(space, digits.as("number"), rules["ordinal_suffix"]!)
      .then(space, str("Meeting").as("type_with_stage"))
      .then(space.then(str("("), yearDigits.as("date"), str(")")).maybe()),
  );
  rule("corrigendum_identifier", () =>
    rules["base"]!.as("base").then(space, str("Corrigendum").as("type_with_stage")),
  );
  rule("numbered_corrigendum_identifier", () =>
    rules["base"]!
      .as("base")
      .then(str("/"), str("Cor").as("type_with_stage"))
      .then(space, digits.as("number"))
      .then(datePortion.maybe()),
  );
  rule("amendment_identifier", () =>
    rules["base"]!
      .as("base")
      .then(str("/"), str("Amd").as("type_with_stage"))
      .then(space, digits.as("number"))
      .then(datePortion.maybe()),
  );
  rule("named_number", () =>
    (str("GUM").or(str("VIM").then(str("-").then(digits).maybe()))).as("number"),
  );
  rule("named_guide_identifier", () =>
    rules["publisher"]!.then(space, rules["named_number"]!),
  );
  rule("identifier", () =>
    rules["meeting_identifier"]!
      .or(rules["amendment_identifier"]!)
      .or(rules["corrigendum_identifier"]!)
      .or(rules["numbered_corrigendum_identifier"]!)
      .or(rules["base"]!)
      .or(rules["named_guide_identifier"]!),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const jcgmGrammar: Grammar = { rules: buildRules(), root: "root" };

type JcgmKind = "guide" | "gum-guide" | "meeting" | "amendment" | "corrigendum";

const JCGM_ATTRS: AttributeTableLike = {
  number: { type: "string" },
  part: { type: "string" },
  subpart: { type: "string" },
  date: { type: PubidDate },
  languages: { type: Language, collection: true, initializeEmpty: true },
};

// The calconnect-style converter trio: the date serializes FLAT as
// year/month/day.
const DATE_MAPPINGS = keyValue(
  {
    wire: "year",
    to: "date",
    toWire: (m) => (m["date"] as PubidDate | undefined)?.year,
    fromWire: (h) =>
      h["year"] === undefined || h["year"] === null
        ? undefined
        : new PubidDate({
            year: String(h["year"]),
            month: h["month"] as string | undefined,
            day: h["day"] as string | undefined,
          }),
  },
  { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
  { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
);

type AttributeTableLike = Record<string, { type: unknown; default?: unknown; collection?: boolean; initializeEmpty?: boolean }>;

abstract class JcgmIdentifier extends BaseIdentifier {
  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly subpart: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly languages: Language[];
  declare readonly base: JcgmIdentifier | undefined;

  /** generate_base_urn shape: urn:jcgm:<number>[:part...]:date... */
  baseUrnParts(): string[] {
    const parts = ["urn", "jcgm"];
    if (this.number !== undefined) parts.push(this.number);
    if (this.part !== undefined) parts.push(`-${this.part}`);
    if (this.subpart !== undefined) parts.push(`-${this.subpart}`);
    const rendered = this.date?.render("urn");
    if (rendered !== undefined && rendered !== "") parts.push(rendered);
    return parts;
  }

  /** The date as printed (PubidDate#to_s): "2008" / "2022-11-28". */
  protected dateToS(): string {
    return this.date?.render() ?? "";
  }

  protected languagePortion(): string {
    return this.languages.length === 0
      ? ""
      : `(${this.languages.map((l) => l.originalCode ?? l.code).join("/")})`;
  }

  /** English ordinal suffix computed from the number (11st, 12nd, 13rd…). */
  protected ordinalSuffix(): string {
    if (this.number === undefined) return "th";
    const mod = Number(this.number) % 10;
    return mod === 1 ? "st" : mod === 2 ? "nd" : mod === 3 ? "rd" : "th";
  }
}

function jcgmClass(kind: JcgmKind, attrs: AttributeTableLike, mappings: ReturnType<typeof keyValue>): IdentifierStatic {
  class JcgmKindIdentifier extends JcgmIdentifier {
    static polymorphicName = `pubid:jcgm:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, attrs as never);
    static mappings = mappings;

    render(): string {
      const id = this as unknown as JcgmIdentifier;
      switch (kind) {
        case "meeting": {
          const base = `JCGM ${id.number}${this.ordinalSuffix()} Meeting`;
          const year = id.date?.year;
          return year === undefined ? base : `${base} (${year})`;
        }
        case "amendment": {
          let result = `${id.base?.render() ?? ""}/Amd`;
          if (id.number !== undefined) result += ` ${id.number}`;
          const d = this.dateToS();
          if (d !== "") result += `:${d}`;
          return result;
        }
        case "corrigendum": {
          if (id.number !== undefined) {
            const d = this.dateToS();
            return `${id.base?.render() ?? ""}/Cor ${id.number}${d === "" ? "" : `:${d}`}`;
          }
          return `${id.base?.render() ?? ""} Corrigendum`;
        }
        case "gum-guide": {
          let result = `JCGM GUM-${id.number}`;
          const d = this.dateToS();
          if (d !== "") result += `:${d}`;
          result += this.languagePortion();
          return result;
        }
        default: {
          let result = "JCGM";
          let portion = id.number ?? "";
          const d = this.dateToS();
          if (portion !== "" && d !== "") portion += `:${d}`;
          if (portion !== "") result += ` ${portion}`;
          result += this.languagePortion();
          return result;
        }
      }
    }
  }
  registerType(JcgmKindIdentifier as unknown as IdentifierStatic);
  return JcgmKindIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES: Record<JcgmKind, IdentifierStatic> = {
  guide: jcgmClass("guide", JCGM_ATTRS, keyValue({ wire: "number", to: "number" }, { wire: "part", to: "part" }, { wire: "subpart", to: "subpart" }, ...DATE_MAPPINGS, { wire: "languages", to: "languages" })),
  "gum-guide": jcgmClass("gum-guide", JCGM_ATTRS, keyValue({ wire: "number", to: "number" }, { wire: "part", to: "part" }, { wire: "subpart", to: "subpart" }, ...DATE_MAPPINGS, { wire: "languages", to: "languages" })),
  meeting: jcgmClass("meeting", JCGM_ATTRS, keyValue({ wire: "number", to: "number" }, ...DATE_MAPPINGS)),
  amendment: jcgmClass("amendment", { ...JCGM_ATTRS, base: { type: undefined as unknown } }, keyValue({ wire: "number", to: "number" }, ...DATE_MAPPINGS, { wire: "base", to: "base" })),
  corrigendum: jcgmClass("corrigendum", { ...JCGM_ATTRS, base: { type: undefined as unknown } }, keyValue({ wire: "number", to: "number" }, ...DATE_MAPPINGS, { wire: "base", to: "base" })),
};
// base attr needs the abstract self-type for polymorphic coercion.
(KIND_CLASSES["amendment"].attributes as unknown as Record<string, unknown>)["base"] = { type: JcgmIdentifier };
(KIND_CLASSES["corrigendum"].attributes as unknown as Record<string, unknown>)["base"] = { type: JcgmIdentifier };

class JcgmUrnGenerator extends BaseUrnGenerator<JcgmIdentifier> {
  generate(): string {
    const kind = this.identifier.constructor.polymorphicName.slice("pubid:jcgm:".length);
    if (kind === "meeting") {
      const parts = ["urn", "jcgm", "meeting"];
      if (this.identifier.number) parts.push(this.identifier.number);
      const year = this.identifier.date?.year;
      if (year !== undefined) parts.push(year);
      return parts.join(":");
    }
    if (kind === "amendment" || kind === "corrigendum") {
      const base = this.identifier.base;
      if (!base) return "urn:jcgm:unknown";
      const parts = [...base.baseUrnParts()];
      parts.push(kind);
      if (this.identifier.number) parts.push(this.identifier.number);
      const rendered = this.identifier.date?.render("urn");
      if (rendered !== undefined && rendered !== "") parts.push(rendered);
      return parts.join(":");
    }
    // generate_base_urn: GUM guides carry the "gum.N" number form;
    // guide/gum_guide type codes are implied and never appended.
    if (kind === "gum-guide" && this.identifier.number !== undefined) {
      const parts = ["urn", "jcgm", `gum.${this.identifier.number}`];
      const rendered = this.identifier.date?.render("urn");
      if (rendered !== undefined && rendered !== "") parts.push(rendered);
      if (this.identifier.languages.length > 0) {
        parts.push(this.identifier.languages.map((l) => l.code).join(","));
      }
      return parts.join(":");
    }
    const parts = [...this.identifier.baseUrnParts()];
    if (this.identifier.languages.length > 0) {
      parts.push(this.identifier.languages.map((l) => l.code).join(","));
    }
    return parts.join(":");
  }
}
for (const klass of Object.values(KIND_CLASSES)) {
  (klass as unknown as Record<string, unknown>).urnGenerator = JcgmUrnGenerator;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseLanguages(value: Tree): Language[] {
  const raw = String(value);
  return raw.split("/").map((code) => {
    const original = code.trim();
    const mapped = Language.CHAR_MAP[original] ?? original.toLowerCase();
    return new Language({ code: mapped, originalCode: original });
  });
}

function buildDate(value: Tree): PubidDate | undefined {
  if (value === undefined || value === null) return undefined;
  const dateStr = String(value);
  const parts = dateStr.split("-");
  return new PubidDate({ year: parts[0], month: parts[1], day: parts[2] });
}

class JcgmBuilder extends BaseBuilder {
  protected defaultIdentifierClass() {
    return KIND_CLASSES["guide"];
  }

  protected selectClass(data: Record<string, unknown>): IdentifierStatic {
    const hasBase = data["base"] !== undefined;
    const typeWithStage = data["type_with_stage"] === undefined || data["type_with_stage"] === null
      ? undefined
      : String(data["type_with_stage"]);
    if (hasBase) {
      if (typeWithStage === undefined) return KIND_CLASSES["amendment"];
      return typeWithStage === "Amd" ? KIND_CLASSES["amendment"] : KIND_CLASSES["corrigendum"];
    }
    if (data["gum_number"] !== undefined) return KIND_CLASSES["gum-guide"];
    if (typeWithStage === "Meeting") return KIND_CLASSES["meeting"];
    return KIND_CLASSES["guide"];
  }

  build(data: Record<string, unknown> | Record<string, unknown>[]): BaseIdentifier {
    const flat = Array.isArray(data) ? Object.assign({}, ...data) : data;
    const klass = this.selectClass(flat);
    const attrs: Record<string, unknown> = {};

    if (flat["base"] !== undefined) {
      attrs["base"] = this.build(flat["base"] as Record<string, unknown>);
    }
    if (flat["gum_number"] !== undefined) attrs["number"] = String(flat["gum_number"]);
    else if (flat["number"] !== undefined) attrs["number"] = String(flat["number"]);
    if (flat["date"] !== undefined) {
      const date = buildDate(flat["date"]);
      if (date) attrs["date"] = date;
    }
    if (flat["languages"] !== undefined) attrs["languages"] = parseLanguages(flat["languages"] as Tree);

    return new (klass as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }
}

export function jcgmGrammarImplementation(): FlavorImplementation {
  const builder = new JcgmBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(jcgmGrammar, input);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        throw new ParseFailed("JCGM: unexpected parse tree", 0);
      }
      return builder.build(tree as Record<string, unknown>) as unknown as Identifier;
    },
  };
}

export { isObj };
