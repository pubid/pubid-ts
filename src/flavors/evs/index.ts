import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { evsGrammar } from "./grammar.js";
import { buildCenIdentifier } from "../cen_cenelec/index.js";
import { EstonianStandard, InternationalAdoption, NationalAdoption } from "./model.js";

/**
 * Port of lib/pubid/evs/builder.rb — the :adopted subtree (from the
 * embedded CEN grammar) goes to the CEN/CENELEC builder as data; the
 * ISO/IEC and plain shapes carry their captures directly. The trailing
 * language code extracts before the grammar runs (the CEN adopted spine
 * is greedy over plain text and would swallow it).
 */

const LANGUAGE_TAIL = / (et-en|et|en)$/

function buildIdentifier(tree: Tree, language: string | undefined): Identifier {
  const d = Array.isArray(tree)
    ? (Object.assign({}, ...tree) as TreeObject)
    : (tree as TreeObject);
  const separator = d["evs_separator"] !== undefined ? String(d["evs_separator"]) : "-";
  const draft = d["draft_prefix"] !== undefined;

  let id: Identifier;
  if (d["adopted"] !== undefined) {
    id = new NationalAdoption({
      base: buildCenIdentifier(d["adopted"] as Tree),
      separator, draft_prefix: draft,
    }) as unknown as Identifier;
  } else if (d["intl"] !== undefined) {
    const intl = d["intl"] as TreeObject;
    id = new InternationalAdoption({
      number: String(intl["number"] ?? ""),
      part: intl["part"] !== undefined ? String(intl["part"]) : undefined,
      intl_org: String(intl["intl_org"] ?? ""),
      year: intl["year"] !== undefined ? String(intl["year"]) : undefined,
      separator, draft_prefix: draft,
    }) as unknown as Identifier;
  } else {
    const plain = (d["plain"] ?? {}) as TreeObject;
    id = new EstonianStandard({
      number: String(plain["number"] ?? ""),
      separator, language,
      year: plain["year"] !== undefined ? String(plain["year"]) : undefined,
      evs_type: plain["evs_type"] !== undefined ? String(plain["evs_type"]) : undefined,
      draft_prefix: draft,
    }) as unknown as Identifier;
  }

  attachSupplement(id as unknown as Record<string, unknown>, d);
  if (language !== undefined) {
    (id as unknown as Record<string, unknown>)["language"] = language;
  }
  return id;
}

function attachSupplement(id: Record<string, unknown>, d: TreeObject): void {
  if (d["na"] !== undefined) {
    const na = d["na"] as TreeObject;
    id["na_separator"] = na["na_separator"] !== undefined ? String(na["na_separator"]) : "+";
    id["na_year"] = na["na_year"] !== undefined ? String(na["na_year"]) : undefined;
  }
  if (d["evs_amd"] !== undefined) {
    const amd = d["evs_amd"] as TreeObject;
    id["amd_separator"] = amd["amd_separator"] !== undefined ? String(amd["amd_separator"]) : "+";
    id["amd_kind"] = "AMD";
    id["amd_number"] = amd["amd_number"] !== undefined ? String(amd["amd_number"]) : undefined;
    id["amd_year"] = amd["amd_year"] !== undefined ? String(amd["amd_year"]) : undefined;
  }
  if (d["evs_cor"] !== undefined) {
    const cor = d["evs_cor"] as TreeObject;
    id["cor_separator"] = cor["cor_separator"] !== undefined ? String(cor["cor_separator"]) : "+";
    id["cor_kind"] = cor["cor_kind"] !== undefined ? String(cor["cor_kind"]) : "COR";
    id["cor_number"] = cor["cor_number"] !== undefined ? String(cor["cor_number"]) : undefined;
    id["cor_year"] = cor["cor_year"] !== undefined ? String(cor["cor_year"]) : undefined;
  }
}

export function evsGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const language = LANGUAGE_TAIL.exec(input)?.[1];
      const body = language !== undefined ? input.slice(0, input.length - language.length - 1) : input;
      const tree = parseGrammar(evsGrammar, body);
      return buildIdentifier(tree, language);
    },
  };
}
