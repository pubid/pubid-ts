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
  rule("root", () => rules["identifier"]!);
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
      if (this.year !== undefined) result += `:${this.yearWithReaffirmation()}`;
      if (this.language !== undefined) result += `(${this.language})`;
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
for (const klass of Object.values(KIND_CLASSES)) {
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
