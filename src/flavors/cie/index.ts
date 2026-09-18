import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import { cieGrammar, preprocessCie } from "./grammar.js";
import {
  CieBundle,
  CieConference,
  CieCorrigendum,
  CieDualPublished,
  CieIdentical,
  CieIdentifier,
  CieJointPublished,
  CieLanguage,
  CieProceedings,
  CieStandard,
  CieSupplement,
  CieTutorialBundle,
} from "./model.js";

/**
 * Port of lib/pubid/cie/builder.rb — class dispatch, attribute
 * extraction with era/style derivation, and the bundle/corrigendum/
 * supplement wrappers.
 */

const isObj = (v: Tree): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const s = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const str = Array.isArray(v) ? v.join("") : String(v);
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

function langFromGroup(group: TreeObject): CieLanguage | undefined {
  const parenYear = group["language_paren_year"];
  if (isObj(parenYear)) {
    const d = flatten(parenYear);
    return new CieLanguage({
      code: s(d["lang_code"]),
      format: "paren_year",
      ...(s(d["trans_year"]) !== undefined ? { translation_year: s(d["trans_year"]) } : {}),
    });
  }
  const paren = group["language_paren"];
  if (isObj(paren)) {
    const d = flatten(paren);
    return new CieLanguage({ code: s(d["lang_code"]), format: "paren" });
  }
  const slashLang = group["language_slash"];
  if (isObj(slashLang)) {
    const d = flatten(slashLang);
    return new CieLanguage({ code: s(d["lang_code"]), format: "slash" });
  }
  return undefined;
}

function detectStyleFallback(tree: TreeObject): string {
  const yearDirect = s(tree["year"]);
  if (yearDirect !== undefined) return Number(yearDirect) <= 2001 ? "legacy" : "current";
  for (const key of ["current_date", "legacy_date"] as const) {
    if (isObj(tree[key])) {
      const year = s(flatten(tree[key] as Tree)["year"]);
      if (year !== undefined) return Number(year) <= 2001 ? "legacy" : "current";
    }
  }
  return "current";
}

/** Builder#extract_attributes — one hash for every type, filtered later. */
function extractAttributes(tree: TreeObject): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  let yearValue: string | undefined;
  let dateSep: string | undefined;

  if (tree["date_then_lang"] !== undefined && isObj(tree["date_then_lang"])) {
    const dateData = flatten(tree["date_then_lang"] as Tree);
    if (isObj(dateData["current_date"])) {
      yearValue = s(flatten(dateData["current_date"] as Tree)["year"]);
      dateSep = "colon";
    } else if (isObj(dateData["legacy_date"])) {
      yearValue = s(flatten(dateData["legacy_date"] as Tree)["year"]);
      dateSep = "dash";
    }
    const lang = langFromGroup(dateData);
    if (lang !== undefined) attributes["language"] = lang;
  } else if (tree["lang_before"] !== undefined && isObj(tree["lang_before"])) {
    const langData = flatten(tree["lang_before"] as Tree);
    const lang = langFromGroup(langData);
    if (lang !== undefined) attributes["language"] = lang;
    if (isObj(langData["current_date"])) {
      yearValue = s(flatten(langData["current_date"] as Tree)["year"]);
      dateSep = "colon";
    } else if (isObj(langData["legacy_date"])) {
      yearValue = s(flatten(langData["legacy_date"] as Tree)["year"]);
      dateSep = "dash";
    }
  } else if (isObj(tree["current_date"])) {
    yearValue = s(flatten(tree["current_date"] as Tree)["year"]);
    dateSep = "colon";
  } else if (isObj(tree["legacy_date"])) {
    yearValue = s(flatten(tree["legacy_date"] as Tree)["year"]);
    dateSep = "dash";
  } else if (tree["year"] !== undefined) {
    yearValue = s(tree["year"]);
    if (tree["copublisher"] !== undefined) {
      // IEC joins the year with a dash, ISO with a colon.
      dateSep = s(tree["copublisher"]) === "IEC" ? "dash" : "colon";
    } else if (tree["trailing_lang"] !== undefined) {
      dateSep = "dash";
    } else {
      dateSep = Number(yearValue) <= 2001 ? "dash" : "colon";
    }
  } else if (tree["slash_year"] !== undefined) {
    yearValue = s(tree["slash_year"]);
    dateSep = "slash";
  }

  attributes["style"] =
    dateSep === "colon" ? "current" : dateSep === "dash" ? "legacy" : dateSep === "slash" ? "slash" : detectStyleFallback(tree);
  if (yearValue !== undefined) attributes["year"] = yearValue;

  if (tree["number"] !== undefined) {
    attributes["number"] = s(tree["number"]);
    if (tree["part"] !== undefined) attributes["part"] = s(tree["part"]);
    if (tree["iteration"] !== undefined) attributes["iteration"] = s(tree["iteration"]);
    if (tree["slash_sep"] !== undefined) attributes["part_separator"] = "slash";
    else if (tree["dash_sep"] !== undefined) attributes["part_separator"] = "dash";
  }

  if (tree["conf_number"] !== undefined) attributes["number"] = s(tree["conf_number"]);

  // The paper itself is the document: its identity is the flat number.
  if (tree["paper_code"] !== undefined) {
    attributes["number"] = `${s(tree["paper_code"]) ?? ""}${s(tree["paper_number"]) ?? ""}`;
    if (tree["conf_number"] !== undefined) attributes["conference"] = s(tree["conf_number"]);
  }
  if (tree["page_range"] !== undefined) attributes["page"] = s(tree["page_range"]);
  if (tree["variant"] !== undefined) attributes["variant"] = s(tree["variant"]);
  if (tree["d_prefix"] !== undefined) attributes["d_prefix"] = true;

  const directLang = langFromGroup(tree);
  if (directLang !== undefined) {
    attributes["language"] = directLang;
  } else if (tree["lang_code"] !== undefined) {
    // Direct /E:YYYY (or preprocessed /EYYYY) form.
    attributes["language"] = new CieLanguage({
      code: s(tree["lang_code"]),
      format: tree["lang_colon"] !== undefined ? "slash_colon" : "slash",
    });
  }

  attributes["s_prefix"] = tree["s_prefix"] !== undefined && tree["s_prefix"] !== null;
  if (tree["stage"] !== undefined) attributes["stage"] = s(tree["stage"]);
  if (tree["doc_type"] !== undefined) attributes["doc_type"] = s(tree["doc_type"]);
  if (tree["copublisher"] !== undefined) attributes["copublisher"] = s(tree["copublisher"]);
  if (tree["iso_reference"] !== undefined) attributes["iso_reference"] = s(tree["iso_reference"]);
  if (tree["iec_identifier"] !== undefined) attributes["iec_identifier"] = s(tree["iec_identifier"]);

  if (tree["supplement_number"] !== undefined) {
    attributes["supplement_number"] = s(tree["supplement_number"]);
    if (tree["supplement_part"] !== undefined) attributes["supplement_part"] = s(tree["supplement_part"]);
    if (tree["base_number"] !== undefined) attributes["base_number"] = s(tree["base_number"]);
  }
  if (tree["cor_number"] !== undefined) {
    attributes["cor_number"] = s(tree["cor_number"]);
    attributes["cor_year"] = s(tree["cor_year"]);
    attributes["base_number"] = s(tree["base_number"]);
    attributes["base_year"] = s(tree["base_year"]);
    if (tree["base_supplement"] !== undefined) attributes["base_supplement"] = s(tree["base_supplement"]);
    if (tree["base_supplement_part"] !== undefined) {
      attributes["base_supplement_part"] = s(tree["base_supplement_part"]);
    }
  }
  if (tree["amd_number"] !== undefined) attributes["amendment_number"] = s(tree["amd_number"]);
  if (tree["bundle_number"] !== undefined) attributes["number"] = s(tree["bundle_number"]);

  // The trailing "(RU-2021)" of the legacy code-with-year form.
  if (isObj(tree["trailing_lang"])) {
    const lang = langFromGroup(flatten(tree["trailing_lang"]));
    if (lang !== undefined) attributes["language"] = lang;
  }

  return attributes;
}

type CieCtor = new (attrs?: Record<string, unknown>) => BaseIdentifier;

class CieBuilder {
  parse(input: string): BaseIdentifier {
    const tree = parseGrammar(cieGrammar, preprocessCie(input));
    if (typeof tree !== "object" || tree === null) {
      throw new ParseFailed("CIE: unexpected parse tree", 0);
    }
    return this.build(tree, input);
  }

  build(data: Tree, originalString: string): BaseIdentifier {
    const tree = flatten(data);

    if (isObj(tree["trailing_lang"]) === false && tree["trailing_lang"] === "") {
      // trailing_lang "" is the no-language marker; nothing to do here.
    }

    // Corrigendum and Supplement wrap a nested base.
    if (tree["cor_number"] !== undefined) return this.buildCorrigendum(tree);
    if (tree["supplement_number"] !== undefined) return this.buildSupplement(tree);

    const attributes = extractAttributes(tree);

    let klass: CieCtor;
    if (tree["bundle_number"] !== undefined && tree["first_number"] === undefined) {
      klass = CieTutorialBundle as CieCtor;
    } else if (tree["bundle_items"] !== undefined) {
      klass = CieBundle as CieCtor;
      Object.assign(attributes, this.buildBundle(originalString));
    } else if (tree["paper_code"] !== undefined) {
      klass = CieProceedings as CieCtor;
    } else if (tree["conference"] !== undefined) {
      klass = CieConference as CieCtor;
    } else if (tree["iec_identifier"] !== undefined) {
      klass = CieDualPublished as CieCtor;
    } else if (tree["iso_reference"] !== undefined) {
      klass = CieIdentical as CieCtor;
    } else if (tree["copublisher"] !== undefined) {
      klass = CieJointPublished as CieCtor;
    } else {
      klass = CieStandard as CieCtor;
    }

    // One attribute hash serves every type; keep only the keys the
    // chosen class declares (the constructor-refusal mirror).
    const declared = (klass as unknown as { attributes: Record<string, unknown> }).attributes;
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (key in declared) filtered[key] = value;
    }
    return new klass(filtered);
  }

  /** Parse each comma member, hoist the shared base onto the bundle. */
  private buildBundle(originalString: string): Record<string, unknown> {
    const members = originalString
      .split(",")
      .map((item, i) => this.parse(i === 0 ? item.trim() : `CIE ${item.trim()}`) as CieIdentifier & {
        base?: CieIdentifier;
        number?: string;
        part?: string;
      });
    const bases = members.map((m) => m.base);
    if (bases.some((b) => b === undefined)) return { ids: members };
    const first = JSON.stringify(bases[0]!.toHash());
    const shared = bases.every((b) => JSON.stringify(b!.toHash()) === first) ? bases[0] : undefined;
    if (shared === undefined) return { ids: members };
    return {
      base: shared,
      ids: members.map((m) => new CieSupplement({ number: m.number, part: m.part })),
    };
  }

  private buildSupplement(tree: TreeObject): BaseIdentifier {
    const a = extractAttributes(tree);
    const base = new CieStandard({
      number: a["base_number"],
      stage: a["stage"],
      s_prefix: a["s_prefix"] ?? false,
      language: a["language"],
      year: a["year"],
      // Supplements always use the colon style.
      style: "current",
    });
    return new CieSupplement({
      base,
      number: a["supplement_number"],
      part: a["supplement_part"],
    });
  }

  private buildCorrigendum(tree: TreeObject): BaseIdentifier {
    const a = extractAttributes(tree);
    const baseStd = new CieStandard({
      number: a["base_number"],
      year: a["base_year"],
      style: "current",
    });
    const base =
      a["base_supplement"] !== undefined
        ? new CieSupplement({
            base: baseStd,
            number: a["base_supplement"],
            part: a["base_supplement_part"],
          })
        : baseStd;
    return new CieCorrigendum({
      base,
      number: a["cor_number"],
      year: a["cor_year"],
    });
  }
}

export function cieGrammarImplementation(): FlavorImplementation {
  const builder = new CieBuilder();
  return {
    parse(input: string): Identifier {
      return builder.parse(input) as unknown as Identifier;
    },
  };
}
