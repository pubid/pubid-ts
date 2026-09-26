import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import { PubidDate } from "../../model/component.js";
import { ituGrammar, normalizeWhitespaceItu } from "./grammar.js";
import {
  ITU_CLASSES,
  ITU_LANGUAGES,
  ItuCode,
  ItuDesignation,
  ItuIdentifier,
  ItuSpecialPublication,
  type ItuKind,
} from "./model.js";

/**
 * Port of lib/pubid/itu/builder.rb — the exact dispatch order:
 * annex_to → annex_number → appendix_number → OB/_op_bull →
 * supplement_type → handbook_marker → study_group → contribution →
 * combined → report/recommendation.
 */

const isObj = (v: Tree): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const s = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(v);

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

function extractParts(raw: Tree): string[] {
  if (Array.isArray(raw)) {
    return raw.map((p) => (isObj(p) ? String(p["part"]) : String(p)));
  }
  if (isObj(raw) && raw["part"] !== undefined) return [String(raw["part"])];
  return [];
}

const normLanguage = (v: unknown): string | undefined => {
  const raw = s(v);
  if (raw === undefined) return undefined;
  return ITU_LANGUAGES[raw] ?? raw;
};

class ItuBuilder {
  build(data: Tree): BaseIdentifier {
    const tree = flatten(data);
    // The common-text twin ("| ISO/IEC …") is stored as the stripped
    // string (Ruby parses it cross-flavor; no ISO parser exists in the
    // TS mirror yet, and no corpus row carries one).
    const twinRaw = s(tree["common_text_twin"])?.replace(/^\s*\|\s*/, "");
    const twin = twinRaw === "" ? undefined : twinRaw;

    if (tree["annex_to"] !== undefined) return this.buildAnnexTo(tree["annex_to"]);

    if (tree["annex_number"] !== undefined) {
      return this.withTwin(this.buildAnnexOfRecommendation(tree), twin);
    }
    if (tree["appendix_number"] !== undefined) {
      return this.withTwin(this.buildAppendixOfRecommendation(tree), twin);
    }
    if (tree["radio_regulations"] !== undefined) {
      return this.withTwin(this.buildRadioRegulations(tree), twin);
    }
    if ((s(tree["series"]) === "OB" && tree["series_dash"] === undefined) || tree["_op_bull"] !== undefined) {
      return this.withTwin(this.buildSpecialPublication(tree), twin);
    }
    if (tree["supplement_type"] !== undefined) {
      return this.withTwin(this.buildSupplement(tree), twin);
    }
    if (tree["handbook_marker"] !== undefined) return this.buildHandbook(tree);
    if (tree["study_group"] !== undefined) return this.buildQuestion(tree);
    if (tree["contribution_marker"] !== undefined) return this.buildContribution(tree);

    const code = tree["number"] !== undefined ? this.buildCode(tree) : undefined;
    const date = tree["year"] !== undefined ? this.buildDate(tree) : undefined;
    const common = {
      sector: s(tree["sector"]),
      series: s(tree["series"]),
      code,
      date,
      version: s(tree["version"]),
      series_word: tree["series_word"] !== undefined,
      series_dash: tree["series_dash"] !== undefined,
      attachment: tree["attachment"] !== undefined,
      range_end: s(tree["range_end"]),
      language: normLanguage(tree["language"]),
      common_text_twin: twin,
    };

    if (tree["combined"] !== undefined) {
      return new ITU_CLASSES["combined"]({
        ...common,
        combined: this.buildDesignations(tree["combined"]),
      });
    }

    const klass = tree["report_marker"] !== undefined ? ITU_CLASSES["report"] : ITU_CLASSES["recommendation"];
    return new klass({ ...common });
  }

  private withTwin(identifier: BaseIdentifier, twin: string | undefined): BaseIdentifier {
    if (twin !== undefined) {
      (identifier as unknown as Record<string, unknown>)["common_text_twin"] = twin;
    }
    return identifier;
  }

  private buildCode(tree: TreeObject): ItuCode {
    return new ItuCode({
      imp_marker: s(tree["imp_marker"]),
      number: s(tree["number"]),
      series_suffix: s(tree["series_suffix"]),
      series_suffix_spaced: tree["series_suffix_spaced"] !== undefined,
      subseries: s(tree["subseries"]),
      parts: extractParts(tree["parts"]),
      qualifier: s(tree["qualifier"]),
      qualifier_glued: tree["qualifier"] !== undefined && tree["qualifier_spaced"] === undefined,
    });
  }

  private buildDate(tree: TreeObject): PubidDate {
    // The Roman month of a bulletin date ("15.III.2016") is stored as the
    // two-digit month every other ITU date uses; the day marks the spelling.
    const roman = s(tree["roman_month"]);
    const month = roman !== undefined
      ? (ItuSpecialPublication.ROMAN_MONTHS.indexOf(roman) + 1).toString().padStart(2, "0")
      : s(tree["month"]);
    return new PubidDate({ year: s(tree["year"]), month, day: s(tree["day"]) });
  }

  /** OB keeps the sector of the TSB spelling ("ITU-T OB.1096") — it is a
   * spelling, not identity (ItuSpecialPublication ignores it in ==). */
  private buildSpecialPublication(tree: TreeObject): BaseIdentifier {
    return new ITU_CLASSES["special_publication"]({
      sector: s(tree["sector"]),
      series: "OB",
      code: tree["number"] !== undefined ? this.buildCode(tree) : undefined,
      date: tree["year"] !== undefined ? this.buildDate(tree) : undefined,
      language: normLanguage(tree["language"]),
    });
  }

  /** "ITU-R RR (2020)" — the series carries the whole designation. */
  private buildRadioRegulations(tree: TreeObject): BaseIdentifier {
    return new ITU_CLASSES["radio_regulations"]({
      sector: s(tree["sector"]),
      series: "RR",
      date: tree["year"] !== undefined ? this.buildDate(tree) : undefined,
      language: normLanguage(tree["language"]),
    });
  }

  private buildAnnexTo(inner: Tree): BaseIdentifier {
    const data = flatten(inner);
    const base = this.buildSpecialPublication(data);
    return new ITU_CLASSES["annex_to"]({
      base,
      language: normLanguage(data["language"]),
    });
  }

  /** sector/series/code are deliberately NOT copied from the base. */
  private buildAnnexOfRecommendation(tree: TreeObject): BaseIdentifier {
    return new ITU_CLASSES["annex_of"]({
      base: this.build(tree["base"] as Tree),
      number: s(tree["annex_number"]),
      date: tree["year"] !== undefined ? this.buildDate(tree) : undefined,
      language: normLanguage(tree["language"]),
    });
  }

  private buildAppendixOfRecommendation(tree: TreeObject): BaseIdentifier {
    return new ITU_CLASSES["appendix_of"]({
      base: this.build(tree["base"] as Tree),
      number: s(tree["appendix_number"]),
      material: s(tree["appendix_material"]),
      date: tree["year"] !== undefined ? this.buildDate(tree) : undefined,
      language: normLanguage(tree["language"]),
    });
  }

  private buildHandbook(tree: TreeObject): BaseIdentifier {
    return new ITU_CLASSES["handbook"]({
      sector: s(tree["sector"]),
      code: this.buildCode(tree),
      date: tree["year"] !== undefined ? this.buildDate(tree) : undefined,
    });
  }

  private buildQuestion(tree: TreeObject): BaseIdentifier {
    return new ITU_CLASSES["question"]({
      sector: s(tree["sector"]),
      series: s(tree["series"]),
      code: this.buildCode(tree),
      study_group: s(tree["study_group"]),
      has_bl: tree["has_bl"] !== undefined,
      bracketed: tree["bracketed"] !== undefined,
      has_colon: tree["question_colon"] !== undefined,
    });
  }

  private buildContribution(tree: TreeObject): BaseIdentifier {
    return new ITU_CLASSES["contribution"]({
      sector: s(tree["sector"]),
      series: s(tree["series"]),
      code: this.buildCode(tree),
      language: normLanguage(tree["language"]),
    });
  }

  private buildDesignations(combined: Tree): ItuDesignation[] {
    const list = Array.isArray(combined) ? combined : [combined];
    return list.map((element) => {
      const d = isObj(element) && element["designation"] !== undefined ? flatten(element["designation"] as Tree) : isObj(element) ? element : {};
      return new ItuDesignation({
        series: s(d["series"]),
        code: new ItuCode({
          number: s(d["number"]),
          series_suffix: s(d["series_suffix"]),
          series_suffix_spaced: d["series_suffix_spaced"] !== undefined,
          subseries: s(d["subseries"]),
          parts: extractParts(d["parts"]),
          qualifier: s(d["qualifier"]),
          qualifier_glued: d["qualifier"] !== undefined && d["qualifier_spaced"] === undefined,
        }),
      });
    });
  }

  private buildSupplement(tree: TreeObject): BaseIdentifier {
    const base = tree["base"] !== undefined ? this.build(tree["base"] as Tree) : undefined;

    const token = (s(tree["supplement_type"]) ?? "").replace(".", "");
    const kind: ItuKind | undefined = (
      { Amd: "amendment", Add: "addendum", Cor: "corrigendum", Err: "errata", Suppl: "supplement" } as Record<string, ItuKind>
    )[token];
    if (kind === undefined) throw new ParseFailed(`ITU: unknown supplement type ${token}`, 0);

    const date =
      tree["supplement_year"] !== undefined
        ? new PubidDate({ year: s(tree["supplement_year"]), month: s(tree["supplement_month"]) })
        : undefined;

    // An annex base keeps sector/series/code on ITS base — reach
    // through it via root, or a supplement of an annex carries none.
    const baseAsIdu = base as ItuIdentifier | undefined;
    const baseIdentity = baseAsIdu !== undefined ? (baseAsIdu.sector !== undefined ? baseAsIdu : baseAsIdu.root()) : undefined;

    const attrs: Record<string, unknown> = {
      sector: baseIdentity?.sector ?? s(tree["sector"]),
      series: baseIdentity?.series ?? s(tree["series"]),
      code: baseIdentity?.code,
      base,
      number: s(tree["supplement_number"]),
      // The captured space marks the SPACED ordinal; absence = glued.
      number_glued: tree["supplement_space"] === undefined,
      slash_joined: tree["supplement_slash"] !== undefined,
      date,
      language: normLanguage(tree["language"]),
      series_word:
        base !== undefined ? baseIdentity?.series_word === true : tree["series_word"] !== undefined,
    };
    if (tree["technical"] !== undefined && kind === "corrigendum") attrs["technical"] = true;

    return new (ITU_CLASSES[kind] as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }
}

export function ituGrammarImplementation(): FlavorImplementation {
  const builder = new ItuBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(ituGrammar, normalizeWhitespaceItu(input));
      if (typeof tree !== "object" || tree === null) {
        throw new ParseFailed("ITU: unexpected parse tree", 0);
      }
      return builder.build(tree) as unknown as Identifier;
    },
  };
}
