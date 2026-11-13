import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/jis/ on the unified model — 10,555 corpus rows.
 * "JIS[ TR|TS] <series> <number>[-parts][:year[R]][(E|J)][（規格群）]
 * [/AMD|EXPL|CORRIGENDUM …] [SYMBOL <value>]". Full-width Japanese
 * separators parse and normalize; year is an INTEGER in the hash; the
 * code ("B 0205-1") lives in the series/number/parts columns and is
 * composed on demand. URN: urn:jis:<code>[:year][:lang]["all"]? with a
 * supplement notation appended lowercased.
 *
 * WES (welding-engineering-standard, pubid#638) rides the same flavor:
 * "WES <number>[-parts][:year[R]]…" with no series letter and no JIS
 * prefix — the code itself carries the "WES" root. A WES id may also
 * carry a TR/TS type after the root ("WES TR 2032:2024", its own
 * welding-engineering-technical-report/-specification classes,
 * pubid#716) and a language before the year ("WES 1112(E):2022",
 * bound only when a colon follows; recorded as language_before_year,
 * which equality ignores — the two (E) positions are one document).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const jpDash = str("ｰ");
  const jpSpace = str("　");
  const jpColon = str("：");
  const jpLparen = str("（");
  const jpRparen = str("）");
  const space = str(" ").or(jpSpace);
  const dash = str("-").or(jpDash);
  const colon = str(":").or(jpColon);
  const digits = match("[0-9]").repeat(1, Infinity);

  rule("jis_prefix", () => str("JIS").then(space.or(str("/")).maybe()));
  rule("type_prefix", () =>
    (str("TR").or(str("TS"))).as("type").then(space.or(str("/"))),
  );
  rule("series", () => match("[A-Z]").as("series"));
  rule("number", () => digits.as("number"));
  rule("part", () => dash.then(digits.as("part")));
  rule("parts", () => rules["part"]!.repeat(0, Infinity).as("parts"));
  rule("reaffirmed", () => str("R").maybe().as("reaffirmed"));
  rule("year", () => colon.then(digits.as("year"), rules["reaffirmed"]!));
  rule("language", () =>
    jpLparen.or(str("(")).then(
      match("[EJ]").as("language"),
      jpRparen.or(str(")")),
    ),
  );
  rule("all_parts", () =>
    jpLparen.then(str("規格群"), jpRparen)
      .or(str("(").then(str("規格群"), str(")")))
      .as("all_parts"),
  );
  rule("amendment", () =>
    str("/").then(
      (str("AMENDMENT").or(str("AMD"))).as("amd_type"),
      space,
      digits.as("amd_number"),
      colon,
      digits.as("amd_year"),
      str("R").maybe().as("amd_reaffirmed"),
    ),
  );
  rule("explanation", () =>
    str("/").then(
      (str("EXPLANATION").or(str("EXPL"))).as("expl_type"),
      space.then(digits.as("expl_number")).maybe(),
    ),
  );
  rule("corrigendum", () =>
    str("/").then(
      (str("CORRIGENDUM").or(str("CORR"))).as("corr_type"),
      space,
      digits.as("corr_number"),
      colon,
      digits.as("corr_year"),
      str("R").maybe().as("corr_reaffirmed"),
    ),
  );
  rule("supplement", () =>
    rules["amendment"]!.as("amendment")
      .or(rules["explanation"]!.as("explanation"))
      .or(rules["corrigendum"]!.as("corrigendum")),
  );
  rule("symbol_clause", () =>
    space.then(
      str("SYMBOL").as("symbol_present"),
      space.then(match("[^\\n]").repeat(1, Infinity).as("symbol_value")).maybe(),
    ),
  );
  rule("identifier", () =>
    rules["jis_prefix"]!
      .maybe()
      .then(rules["type_prefix"]!.maybe())
      .then(space.maybe(), rules["series"]!, space.maybe(), rules["number"]!)
      .then(rules["parts"]!)
      .then(rules["year"]!.maybe())
      .then(rules["language"]!.maybe())
      .then(rules["all_parts"]!.maybe())
      .then(rules["supplement"]!.maybe())
      .then(rules["symbol_clause"]!.maybe()),
  );
  // WES (Japan Welding Engineering Society) rides the JIS flavor with the
  // same tail but no prefix and no series letter; the root tries it first,
  // as the reference grammar does. A WES id may also carry a TR/TS type
  // after the root ("WES TR 2032:2024") and a language before the year
  // ("WES 1112(E):2022" — bound only when a colon follows, so
  // "WES 1112(E)" with no year still reads as no language).
  rule("wes_type", () => (str("TR").or(str("TS"))).as("wes_type").then(space));
  rule("wes_language", () =>
    jpLparen.or(str("(")).then(
      match("[EJ]").as("wes_language"),
      jpRparen.or(str(")")),
    ).then(colon.present()),
  );
  rule("wes_identifier", () =>
    str("WES").as("wes")
      .then(space)
      .then(rules["wes_type"]!.maybe())
      .then(rules["number"]!)
      .then(rules["parts"]!)
      .then(rules["wes_language"]!.maybe())
      .then(rules["year"]!.maybe())
      .then(rules["language"]!.maybe())
      .then(rules["all_parts"]!.maybe())
      .then(rules["supplement"]!.maybe())
      .then(rules["symbol_clause"]!.maybe()),
  );
  rule("root", () => rules["wes_identifier"]!.or(rules["identifier"]!));
  return rules;
}

export const jisGrammar: Grammar = { rules: buildRules(), root: "root" };

type JisKind =
  | "japanese-industrial-standard"
  | "technical-report"
  | "technical-specification"
  | "amendment"
  | "corrigendum"
  | "explanation";

const KIND_PREFIXES: Record<string, string | undefined> = {
  "japanese-industrial-standard": undefined,
  "technical-report": "TR",
  "technical-specification": "TS",
};

abstract class JisIdentifier extends BaseIdentifier {
  declare readonly series: string | undefined;
  declare readonly number: number | string | undefined;
  declare readonly parts: string[] | undefined;
  declare readonly year: number | undefined;
  declare readonly language: string | undefined;
  declare readonly language_before_year: boolean | undefined;
  declare readonly all_parts: boolean | undefined;
  declare readonly reaffirmed: boolean | undefined;
  declare readonly symbol: string | undefined;
  declare readonly base: JisIdentifier | undefined;

  /** The rendered document code, e.g. "B 0205-1". */
  code(): string | undefined {
    if (this.base !== undefined) return this.base.code();
    if (this.series === undefined || this.number === undefined) return undefined;
    let result = `${this.series} ${this.number}`;
    if (this.parts !== undefined) result += this.parts.map((p) => `-${p}`).join("");
    return result;
  }

  yearWithReaffirmation(): string {
    return `${this.year}${this.reaffirmed === true ? "R" : ""}`;
  }

  /** The ":year[R]" and "(lang)" tail, in the order the source used
   *  (ruby year_and_language). */
  yearAndLanguage(): string {
    const yearPart = this.year !== undefined ? `:${this.yearWithReaffirmation()}` : "";
    const langPart = this.language !== undefined ? `(${this.language})` : "";
    return this.language_before_year === true ? langPart + yearPart : yearPart + langPart;
  }

  symbolSuffix(): string {
    if (this.symbol === undefined) return "";
    return this.symbol === "" ? " SYMBOL" : ` SYMBOL ${this.symbol}`;
  }

  supplementNotation(): string {
    return "";
  }
}

const JIS_MAPPINGS = keyValue(
  { wire: "series", to: "series" },
  { wire: "number", to: "number" },
  { wire: "parts", to: "parts" },
  { wire: "year", to: "year" },
  { wire: "language", to: "language" },
  { wire: "language_before_year", to: "language_before_year" },
  { wire: "all_parts", to: "all_parts" },
  { wire: "reaffirmed", to: "reaffirmed" },
  { wire: "symbol", to: "symbol" },
);

function jisClass(kind: JisKind): IdentifierStatic {
  const isSupplement = kind === "amendment" || kind === "corrigendum" || kind === "explanation";
  class JisKindIdentifier extends JisIdentifier {
    static polymorphicName = `pubid:jis:${kind}`;
    static attributes = isSupplement
      ? extendAttributes(BaseIdentifier, {
          base: { type: JisIdentifier as unknown as IdentifierStatic },
          number: { type: "integer" },
          year: { type: "integer" },
          reaffirmed: { type: "boolean" },
        })
      : extendAttributes(BaseIdentifier, {
          series: { type: "string" },
          number: { type: "string" },
          parts: { type: "string", collection: true },
          year: { type: "integer" },
          language: { type: "string" },
          language_before_year: { type: "boolean", equalityIgnored: true },
          all_parts: { type: "boolean", default: false },
          reaffirmed: { type: "boolean" },
          symbol: { type: "string" },
        });
    static mappings = isSupplement
      ? keyValue(
          { wire: "number", to: "number" },
          { wire: "year", to: "year" },
          { wire: "reaffirmed", to: "reaffirmed" },
          { wire: "base", to: "base" },
        )
      : JIS_MAPPINGS;

    render(): string {
      if (isSupplement) {
        const result = `${this.base?.render() ?? ""}/${this.supplementNotation()}`;
        return result + this.symbolSuffix();
      }
      const typePrefix = KIND_PREFIXES[kind];
      let result = typePrefix === undefined ? "JIS" : `JIS ${typePrefix}`;
      result += ` ${this.code()}`;
      result += this.yearAndLanguage();
      if (this.all_parts === true) result += "（規格群）";
      return result + this.symbolSuffix();
    }

    supplementNotation(): string {
      if (kind === "amendment") return `AMD ${this.number}:${this.yearWithReaffirmation()}`;
      if (kind === "corrigendum") return `CORRIGENDUM ${this.number}:${this.yearWithReaffirmation()}`;
      if (kind === "explanation") {
        return this.number === undefined ? "EXPL" : `EXPL ${this.number}`;
      }
      return "";
    }
  }
  registerType(JisKindIdentifier as unknown as IdentifierStatic);
  return JisKindIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES: Record<JisKind, IdentifierStatic> = {
  "japanese-industrial-standard": jisClass("japanese-industrial-standard"),
  "technical-report": jisClass("technical-report"),
  "technical-specification": jisClass("technical-specification"),
  amendment: jisClass("amendment"),
  corrigendum: jisClass("corrigendum"),
  explanation: jisClass("explanation"),
};

type WesKind =
  | "welding-engineering-standard"
  | "welding-engineering-technical-report"
  | "welding-engineering-technical-specification";

const WES_TYPE_PREFIXES: Record<string, string | undefined> = {
  "welding-engineering-standard": undefined,
  "welding-engineering-technical-report": "TR",
  "welding-engineering-technical-specification": "TS",
};

// WES 7700-1:2019 — JSA sells Welding Engineering Standards next to JIS,
// so they parse through the JIS flavor, but the id carries no series
// letter and no JIS prefix ("WES" is the root of the designation). The
// TR/TS type token after the root picks the WES TR / WES TS classes
// (pubid#716): "WES TR 2032" is not "WES 2032" and not "TR Z 2032".
function wesClass(kind: WesKind): IdentifierStatic {
  class JisWesIdentifier extends JisIdentifier {
    static polymorphicName = `pubid:jis:${kind}`;
    static attributes = extendAttributes(BaseIdentifier, {
      number: { type: "string" },
      parts: { type: "string", collection: true },
      year: { type: "integer" },
      language: { type: "string" },
      language_before_year: { type: "boolean", equalityIgnored: true },
      all_parts: { type: "boolean", default: false },
      reaffirmed: { type: "boolean" },
      symbol: { type: "string" },
    });
    static mappings = keyValue(
      { wire: "number", to: "number" },
      { wire: "parts", to: "parts" },
      { wire: "year", to: "year" },
      { wire: "language", to: "language" },
      { wire: "language_before_year", to: "language_before_year" },
      { wire: "all_parts", to: "all_parts" },
      { wire: "reaffirmed", to: "reaffirmed" },
      { wire: "symbol", to: "symbol" },
    );

    code(): string | undefined {
      if (this.base !== undefined) return this.base.code();
      const prefix = WES_TYPE_PREFIXES[kind];
      const root = prefix === undefined ? "WES" : `WES ${prefix}`;
      let result = `${root} ${this.number}`;
      if (this.parts !== undefined) result += this.parts.map((p) => `-${p}`).join("");
      return result;
    }

    render(): string {
      let result = this.code() ?? "";
      result += this.yearAndLanguage();
      if (this.all_parts === true) result += "（規格群）";
      return result + this.symbolSuffix();
    }
  }
  registerType(JisWesIdentifier as unknown as IdentifierStatic);
  return JisWesIdentifier as unknown as IdentifierStatic;
}

const WES_CLASSES: Record<WesKind, IdentifierStatic> = {
  "welding-engineering-standard": wesClass("welding-engineering-standard"),
  "welding-engineering-technical-report": wesClass("welding-engineering-technical-report"),
  "welding-engineering-technical-specification": wesClass("welding-engineering-technical-specification"),
};

class JisUrnGenerator extends BaseUrnGenerator<JisIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "jis"];
    const code = id.code();
    if (code !== undefined) parts.push(code);
    if (id.year !== undefined) parts.push(String(id.year));
    if (id.language !== undefined) parts.push(id.language.toLowerCase());
    if (id.all_parts === true) parts.push("all");
    const notation = id.supplementNotation();
    if (id.base !== undefined && notation !== "") {
      parts.push(notation.toLowerCase());
    }
    return parts.join(":");
  }
}
for (const klass of [...Object.values(KIND_CLASSES), ...Object.values(WES_CLASSES)]) {
  (klass as unknown as Record<string, unknown>).urnGenerator = JisUrnGenerator;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractParts(raw: Tree): string[] {
  if (Array.isArray(raw)) {
    return raw.map((p) => (isObj(p) ? String(p["part"]) : String(p)));
  }
  if (isObj(raw) && raw["part"] !== undefined) return [String(raw["part"])];
  return [];
}

class JisBuilder {
  build(data: Tree): BaseIdentifier {
    const tree = (Array.isArray(data) ? Object.assign({}, ...data) : data) as TreeObject;
    const identifier = this.dispatch(tree);
    // The SYMBOL clause attaches to the outermost identifier.
    if (tree["symbol_present"] !== undefined) {
      (identifier as unknown as Record<string, unknown>)["symbol"] =
        tree["symbol_value"] === undefined || tree["symbol_value"] === null
          ? ""
          : String(tree["symbol_value"]);
    }
    return identifier;
  }

  private dispatch(tree: TreeObject): BaseIdentifier {
    if (tree["amendment"] !== undefined) return this.buildSupplement(tree, "amendment", "amendment", "amd");
    if (tree["corrigendum"] !== undefined) return this.buildSupplement(tree, "corrigendum", "corrigendum", "corr");
    if (tree["explanation"] !== undefined) return this.buildExplanation(tree);
    return this.buildSingle(tree);
  }

  private baseData(tree: TreeObject, key: string): TreeObject {
    const out = { ...tree };
    delete out[key];
    return out;
  }

  private buildSingle(tree: TreeObject): BaseIdentifier {
    if (tree["wes"] !== undefined) return this.buildWes(tree);
    const type = tree["type"] === undefined || tree["type"] === null ? undefined : String(tree["type"]);
    const kind: JisKind =
      type === "TR" ? "technical-report" : type === "TS" ? "technical-specification" : "japanese-industrial-standard";
    const attrs: Record<string, unknown> = {
      series: String(tree["series"]),
      number: String(tree["number"]),
      parts: extractParts(tree["parts"]),
    };
    if (tree["year"] !== undefined && tree["year"] !== null) attrs["year"] = Number(tree["year"]);
    if (tree["language"] !== undefined && tree["language"] !== null) attrs["language"] = String(tree["language"]);
    if (tree["all_parts"] !== undefined) attrs["all_parts"] = true;
    if (tree["reaffirmed"] !== undefined && tree["reaffirmed"] !== null) attrs["reaffirmed"] = true;
    return new (KIND_CLASSES[kind] as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }

  private buildWes(tree: TreeObject): BaseIdentifier {
    const attrs: Record<string, unknown> = {
      number: String(tree["number"]),
      parts: extractParts(tree["parts"]),
    };
    if (tree["year"] !== undefined && tree["year"] !== null) attrs["year"] = Number(tree["year"]);
    const wesType =
      tree["wes_type"] === undefined || tree["wes_type"] === null ? undefined : String(tree["wes_type"]);
    const kind: WesKind =
      wesType === "TR"
        ? "welding-engineering-technical-report"
        : wesType === "TS"
        ? "welding-engineering-technical-specification"
        : "welding-engineering-standard";
    // "wes_language" is a language printed before the year
    // ("WES 1112(E):2022"); an id carries one language, not two.
    if (tree["wes_language"] !== undefined && tree["wes_language"] !== null) {
      if (tree["language"] !== undefined && tree["language"] !== null) {
        throw new ParseFailed("JIS: a WES id carries one language, not two", 0);
      }
      attrs["language"] = String(tree["wes_language"]);
      attrs["language_before_year"] = true;
    } else if (tree["language"] !== undefined && tree["language"] !== null) {
      attrs["language"] = String(tree["language"]);
    }
    if (tree["all_parts"] !== undefined) attrs["all_parts"] = true;
    if (tree["reaffirmed"] !== undefined && tree["reaffirmed"] !== null) attrs["reaffirmed"] = true;
    return new (WES_CLASSES[kind] as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }

  private buildSupplement(
    tree: TreeObject,
    kind: "amendment" | "corrigendum",
    key: string,
    prefix: string,
  ): BaseIdentifier {
    const supp = isObj(tree[key]) ? (tree[key] as TreeObject) : {};
    const base = this.buildSingle(this.baseData(tree, key));
    const attrs: Record<string, unknown> = {
      base,
      number: Number(supp[`${prefix}_number`]),
      year: Number(supp[`${prefix}_year`]),
    };
    if (supp[`${prefix}_reaffirmed`] !== undefined && supp[`${prefix}_reaffirmed`] !== null) {
      attrs["reaffirmed"] = true;
    }
    return new (KIND_CLASSES[kind] as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }

  private buildExplanation(tree: TreeObject): BaseIdentifier {
    const supp = isObj(tree["explanation"]) ? (tree["explanation"] as TreeObject) : {};
    const base = this.buildSingle(this.baseData(tree, "explanation"));
    const attrs: Record<string, unknown> = { base, year: (base as unknown as JisIdentifier).year };
    if (supp["expl_number"] !== undefined && supp["expl_number"] !== null) {
      attrs["number"] = Number(supp["expl_number"]);
    }
    return new (KIND_CLASSES["explanation"] as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }
}

export function jisGrammarImplementation(): FlavorImplementation {
  const builder = new JisBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(jisGrammar, input);
      if (typeof tree !== "object" || tree === null) {
        throw new ParseFailed("JIS: unexpected parse tree", 0);
      }
      return builder.build(tree) as unknown as Identifier;
    },
  };
}
