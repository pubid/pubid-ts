import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { grammarImplementation } from "../index.js";
import { bsiGrammar, preprocessBsi } from "./grammar.js";
import { PubidDate, Publisher } from "../../model/component.js";
import { AdoptedEuropeanNormClass as CenAdoptedEuropeanNormClass } from "../cen_cenelec/model.js";
import {
  AddendumDocumentClass,
  AdoptedEuropeanNormClass,
  AdoptedInternationalStandardClass,
  AerospaceStandardClass,
  Amendment,
  BsiCode,
  BsiIdentifier,
  BundledIdentifierClass,
  BritishStandardClass,
  CommitteeDocumentClass,
  ConsolidatedIdentifierClass,
  Corrigendum,
  DetailedSpecificationClass,
  DiscClass,
  ExpertCommentaryClass,
  ExplanatorySupplementClass,
  FlexClass,
  IndexClass,
  MethodClass,
  NationalAnnexClass,
  SectionClass,
  SetClass,
  StandaloneAmendmentClass,
  SupplementDocumentClass,
  SupplementaryIndexClass,
  TestMethodClass,
  ValueAddedPublicationClass,
  locateStage,
  TYPE_CLASSES,
} from "./model.js";
import type { IdentifierStatic } from "../../model/identifier.js";

/**
 * Port of lib/pubid/bsi/builder.rb — dispatch, attribute extraction,
 * the specialized build paths, the adopted-identifier routing, and the
 * supplement/consolidated wrapping.
 */

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Parse-tree numbers arrive as {number: "1000"} (the rule's own .as).
const numv = (v: unknown): string | undefined => {
  if (isObj(v)) return strv(v["number"]);
  return strv(v);
};

const strv = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    const joined = v.flat(Infinity as 10).map(String).join("");
    return joined.length > 0 ? joined : undefined;
  }
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
};

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

type Ctor = new (attrs?: Record<string, unknown>) => BsiIdentifier;

const ctor = (klass: IdentifierStatic): Ctor => klass as unknown as Ctor;

function pub(body: string): Publisher {
  return new Publisher({ body });
}

// The adopted routing mirrors the gem: a routed branch that fails to
// parse RAISES through (build_adopted_identifier calls the foreign
// parser directly), which is what rejects e.g. "BS HD 629.1 S3:2019".
function tryForeign(flavor: string, raw: string): Identifier | undefined {
  const impl = grammarImplementation(flavor);
  if (impl === undefined) return undefined;
  return impl.parse(raw);
}

// --- Supplements ---------------------------------------------------------------------

interface SuppData {
  type: "amendment" | "corrigendum";
  number: string | undefined;
  year: string | undefined;
  separator: string;
  amd_suffix_form: boolean;
}

function extractSupplementsFromArray(supps: unknown[]): SuppData[] {
  return supps.map((s) => {
    const supp = isObj(s) && s["supplement"] !== undefined ? (s["supplement"] as TreeObject) : (isObj(s) ? s : ({} as TreeObject));
    const separator = supp["amd_sep_slash"] !== undefined ? "/" : "+";
    return {
      type: supp["amd_number"] !== undefined ? ("amendment" as const) : ("corrigendum" as const),
      number: strv(supp["amd_number"] ?? supp["cor_number"]),
      year: strv(supp["amd_year"] ?? supp["cor_year"]),
      separator,
      amd_suffix_form: supp["amd_sep_plus"] === undefined && supp["amd_sep_slash"] === undefined,
    };
  });
}

function extractSupplements(data: TreeObject): SuppData[] {
  const raw = data["supplements"];
  if (raw === undefined) return [];
  const arr = (Array.isArray(raw) ? (raw as unknown[]).flat(Infinity as 10) : [raw])
    .filter((x) => isObj(x) || (Array.isArray(x) && x.length > 0));
  if (arr.length === 0) return [];
  return extractSupplementsFromArray(arr);
}

function expandYear(yearVal: string | undefined): string | undefined {
  if (yearVal === undefined) return undefined;
  if (yearVal.length === 2) return String(2000 + Number(yearVal));
  return yearVal;
}

function wrapWithConsolidated(base: BsiIdentifier, supplementsData: SuppData[]): BsiIdentifier {
  const supplementIds = supplementsData.map((supp) => {
    const yearVal = expandYear(supp.year);
    if (supp.type === "amendment") {
      return new Amendment({
        base,
        number: supp.number,
        year: yearVal,
        separator: supp.separator,
        amd_suffix_form: supp.amd_suffix_form ? true : false,
      });
    }
    return new Corrigendum({
      base,
      number: supp.number,
      year: yearVal,
      separator: supp.separator,
    });
  });
  return new (ctor(ConsolidatedIdentifierClass))({
    identifiers: [base, ...supplementIds],
  });
}

function wrapWithExpertCommentary(baseId: BsiIdentifier, original: TreeObject): BsiIdentifier {
  let format = "abbr";
  if (original["expert_commentary_full"] !== undefined) format = "full";
  else if (original["expert_commentary_topic"] !== undefined) format = "abbr_with_topic";
  const topic = strv(original["expert_commentary_topic"]);
  return new (ctor(ExpertCommentaryClass))({ base: baseId, format, topic });
}

// --- Attribute extraction ------------------------------------------------------------

function partsToAttrs(partsVal: unknown): { part?: string | undefined; subpart?: string | undefined } {
  const arr = Array.isArray(partsVal) ? (partsVal as unknown[]).flat(Infinity as 10) : partsVal !== undefined ? [partsVal] : [];
  if (arr.length === 0) return {};
  const first = isObj(arr[0]) ? (arr[0] as TreeObject) : undefined;
  if (first === undefined) return {};
  const partStr = strv(first["part"]) ?? "";
  if (first["subpart"] !== undefined) {
    return { part: partStr, subpart: strv(first["subpart"]) };
  }
  const components = partStr.split("-");
  if (components.length > 1) {
    return { part: components[0], subpart: components[1] };
  }
  return { part: partStr };
}

function locateKlass(parsedHash: TreeObject): IdentifierStatic {
  if (parsedHash["flex_type"] !== undefined) return FlexClass;
  if (parsedHash["na_prefix"] !== undefined) return NationalAnnexClass;
  if (parsedHash["prefix"] !== undefined) return AerospaceStandardClass;

  const adopted = strv(parsedHash["adopted_string"]);
  if (adopted !== undefined && /^EN\s+\d/.test(adopted)) return AdoptedEuropeanNormClass;
  if (adopted !== undefined) return AdoptedInternationalStandardClass;

  const typeStr = strv(parsedHash["type"]) ?? strv(parsedHash["stage"]) ?? "";
  // Unknown abbreviations fall back to the DEFAULT_TYPED_STAGE (a
  // published British Standard).
  const stage = locateStage(typeStr.toUpperCase()) ?? { typeCode: "bs" };
  return TYPE_CLASSES[stage.typeCode] ?? BritishStandardClass;
}

function assignAttributes(data: TreeObject): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  if (data["publisher"] !== undefined) attrs["publisher"] = pub(strv(data["publisher"]) ?? "BS");
  if (data["prefix"] !== undefined) attrs["prefix"] = strv(data["prefix"]);
  if (data["flex_prefix"] !== undefined) attrs["flex_prefix"] = strv(data["flex_prefix"]);
  if (data["number"] !== undefined) attrs["number"] = strv(data["number"]);
  if (data["iteration"] !== undefined) {
    const iterationObj = isObj(data["iteration"]) ? (data["iteration"] as TreeObject) : undefined;
    const iterationVal = iterationObj !== undefined ? strv(iterationObj["iteration"]) : strv(data["iteration"]);
    if (iterationVal !== undefined && iterationVal !== "") attrs["iteration"] = iterationVal;
  }
  const partsAttr = partsToAttrs(data["parts"]);
  if (partsAttr.part !== undefined) attrs["part"] = partsAttr.part;
  if (partsAttr.subpart !== undefined) attrs["subpart"] = partsAttr.subpart;
  if (data["year"] !== undefined) {
    attrs["date"] = new PubidDate({ year: String(Number(strv(data["year"]))) });
  }
  if (data["month"] !== undefined) attrs["month"] = Number(strv(data["month"]));
  if (data["edition"] !== undefined) attrs["edition"] = strv(data["edition"]);
  if (data["second_number"] !== undefined) {
    attrs["second_number"] = new BsiCode({ value: strv(data["second_number"]) ?? "" });
  }
  if (data["translation_lang"] !== undefined) {
    const lang = strv(data["translation_lang"]) ?? "";
    attrs["translation_lang"] = lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
  }
  if (data["translation_upper"] !== undefined) {
    const lang = strv(data["translation_upper"]) ?? "";
    attrs["translation_upper"] = lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
  }

  return attrs;
}

// --- The builder ---------------------------------------------------------------------

export function buildBsiIdentifier(tree: Tree): Identifier {
  return buildTree(flatten(tree));
}

function buildTree(data: TreeObject): Identifier {
  const original = { ...data };

  if (data["standalone_amendment"] !== undefined || data["parenthesized_amd"] !== undefined) {
    return buildStandaloneAmendment(data);
  }
  if (data["committee_document"] !== undefined) {
    return buildCommitteeDocument(flatten(data["committee_document"] as Tree));
  }
  if (data["index_identifier"] !== undefined) {
    return buildIndex(flatten(data["index_identifier"] as Tree));
  }
  if (data["supplementary_index_identifier"] !== undefined) {
    return buildSupplementaryIndex(flatten(data["supplementary_index_identifier"] as Tree));
  }
  if (data["explanatory_supplement_identifier"] !== undefined) {
    return buildExplanatorySupplement(flatten(data["explanatory_supplement_identifier"] as Tree));
  }
  if (data["method_identifier"] !== undefined) {
    return buildMethod(flatten(data["method_identifier"] as Tree));
  }
  if (data["test_method_identifier"] !== undefined) {
    return buildTestMethod(flatten(data["test_method_identifier"] as Tree));
  }
  if (data["section_identifier"] !== undefined) {
    return buildSection(flatten(data["section_identifier"] as Tree));
  }
  if (data["detailed_specification"] !== undefined) {
    return buildDetailedSpecification(flatten(data["detailed_specification"] as Tree));
  }
  if (data["disc_identifier"] !== undefined) {
    return buildDisc(flatten(data["disc_identifier"] as Tree));
  }
  if (data["aerospace_identifier"] !== undefined) {
    return buildAerospaceIdentifier(flatten(data["aerospace_identifier"] as Tree));
  }
  if (data["supplement_document"] !== undefined) {
    return buildSupplementDocument(flatten(data["supplement_document"] as Tree));
  }
  if (data["addendum_document"] !== undefined) {
    return buildAddendumDocument(flatten(data["addendum_document"] as Tree));
  }
  if (data["bundled_parts"] !== undefined || data["bundled_list"] !== undefined) {
    return buildBundledIdentifier(data);
  }
  if (data["set"] !== undefined) {
    return buildSetData(data["set"]);
  }

  const supplementsData = extractSupplements(data);

  if (data["pdf_format"] !== undefined || data["tc_format"] !== undefined || data["book_format"] !== undefined) {
    return buildValueAddedPublication(data, supplementsData);
  }

  if (data["na_prefix"] !== undefined) {
    return buildNationalAnnex(data, supplementsData);
  }
  if (data["adopted_string"] !== undefined) {
    const adopted = buildAdoptedIdentifier(data, original);
    if (adopted !== undefined) return adopted;
  }

  let identifier = new (ctor(locateKlass(data)))(assignAttributes(data));
  void identifier;

  if (supplementsData.length > 0) {
    identifier = wrapWithConsolidated(identifier, supplementsData);
  }
  if (data["expert_commentary"] !== undefined || data["expert_commentary_full"] !== undefined) {
    identifier = wrapWithExpertCommentary(identifier, original);
  }
  return identifier as unknown as Identifier;
}

// --- Specialized builders ------------------------------------------------------------

function yearDate(v: unknown): PubidDate | undefined {
  const s = strv(v);
  if (s === undefined) return undefined;
  return new PubidDate({ year: String(Number(s)) });
}

function buildIndex(data: TreeObject): Identifier {
  const attrs: Record<string, unknown> = {
    number: strv(data["number"]),
  };
  const suffix = isObj(data["index_suffix"]) ? (data["index_suffix"] as TreeObject) : {};
  let format = "space";
  let issueNumber: string | undefined;
  if (suffix["colon_sep"] !== undefined) format = "colon";
  else if (suffix["issue_number"] !== undefined) issueNumber = strv(suffix["issue_number"]);
  attrs["issue_number"] = issueNumber;
  attrs["index_format"] = format;
  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(IndexClass))(attrs) as unknown as Identifier;
}

function buildSupplementaryIndex(data: TreeObject): Identifier {
  const attrs: Record<string, unknown> = { number: strv(data["number"]) };
  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(SupplementaryIndexClass))(attrs) as unknown as Identifier;
}

function buildExplanatorySupplement(data: TreeObject): Identifier {
  const attrs: Record<string, unknown> = { number: strv(data["number"]) };
  const parts = partsToAttrs(data["parts"]);
  if (parts.part !== undefined) attrs["part"] = parts.part;
  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(ExplanatorySupplementClass))(attrs) as unknown as Identifier;
}

function buildMethod(data: TreeObject): Identifier {
  const suffix = isObj(data["method_suffix"]) ? (data["method_suffix"] as TreeObject) : {};
  const methodTo = strv(suffix["method_to"]);
  const methodAnd = strv(suffix["method_and"]);
  const attrs: Record<string, unknown> = {
    number: strv(data["number"]),
    method_code: strv(suffix["method_code"]),
    method_to: methodTo,
    method_and: methodAnd,
    is_plural: methodTo !== undefined || methodAnd !== undefined,
  };
  const parts = partsToAttrs(data["parts"]);
  if (parts.part !== undefined) attrs["part"] = parts.part;
  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(MethodClass))(attrs) as unknown as Identifier;
}

function buildTestMethod(data: TreeObject): Identifier {
  const suffix = isObj(data["test_method_suffix"]) ? (data["test_method_suffix"] as TreeObject) : {};
  const attrs: Record<string, unknown> = {
    number: strv(data["number"]),
    test_series: strv(suffix["test_series"]),
    test_id: strv(suffix["test_id"]),
  };
  if (data["publisher"] !== undefined) attrs["publisher"] = pub(strv(data["publisher"]) ?? "BS");
  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(TestMethodClass))(attrs) as unknown as Identifier;
}

function buildSection(data: TreeObject): Identifier {
  const suffix = isObj(data["section_suffix"]) ? (data["section_suffix"] as TreeObject) : {};
  const publisherVal = strv(data["publisher"]) ?? strv(data["type"]);
  const attrs: Record<string, unknown> = {
    number: strv(data["number"]),
    section_id: strv(suffix["section_id"]),
    section_format: suffix["colon_sep"] !== undefined ? "colon" : "space",
  };
  if (publisherVal !== undefined) attrs["publisher"] = pub(publisherVal);
  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(SectionClass))(attrs) as unknown as Identifier;
}

function buildDetailedSpecification(data: TreeObject): Identifier {
  const suffix = isObj(data["detailed_spec_suffix"]) ? (data["detailed_spec_suffix"] as TreeObject) : {};
  const attrs: Record<string, unknown> = { number: strv(data["number"]) };
  const specCode = strv(suffix["spec_code"]);
  if (specCode !== undefined) attrs["spec_code"] = new BsiCode({ value: specCode });
  if (data["publisher"] !== undefined) attrs["publisher"] = pub(strv(data["publisher"]) ?? "BS");
  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(DetailedSpecificationClass))(attrs) as unknown as Identifier;
}

function buildDisc(data: TreeObject): Identifier {
  const attrs: Record<string, unknown> = { number: strv(data["number"]) };
  const parts = partsToAttrs(data["parts"]);
  if (parts.part !== undefined) attrs["part"] = parts.part;
  attrs["publisher"] = pub("DISC");
  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(DiscClass))(attrs) as unknown as Identifier;
}

function buildAerospaceIdentifier(data: TreeObject): Identifier {
  const prefixRaw = data["prefix"];
  const prefixVal = isObj(prefixRaw) ? strv((prefixRaw as TreeObject)["prefix"]) : strv(prefixRaw);

  const attrs: Record<string, unknown> = {
    prefix: prefixVal,
    number: numv(data["number"]),
    publisher: pub("BS"),
  };

  // The part captures land flat at the aerospace_identifier level when
  // the engine flattens embedded subrule labels (data[:part], with an
  // optional sibling letter_edition).
  if (data["part"] !== undefined) {
    const partDirect = isObj(data["part"])
      ? strv((data["part"] as TreeObject)["part"])
      : strv(data["part"]);
    if (partDirect !== undefined) attrs["part"] = partDirect;
    const partLetter = isObj(data["part"])
      ? strv((data["part"] as TreeObject)["letter_edition"])
      : undefined;
    if (partLetter === undefined && data["letter_edition"] !== undefined) {
      attrs["edition"] = isObj(data["letter_edition"])
        ? strv((data["letter_edition"] as TreeObject)["letter_edition"])
        : strv(data["letter_edition"]);
    }
    if (partLetter !== undefined) attrs["edition"] = partLetter;
  }
  const letterEditionPart = isObj(data["part_with_letter_edition"])
    ? (data["part_with_letter_edition"] as TreeObject)
    : undefined;
  if (letterEditionPart !== undefined) {
    const partVal = strv(letterEditionPart["part"]);
    if (partVal !== undefined) attrs["part"] = partVal;
    const letterEdition = strv(letterEditionPart["letter_edition"]);
    if (letterEdition !== undefined) attrs["edition"] = letterEdition;
  } else {
    const parts = partsToAttrs(data["parts"]);
    if (parts.part !== undefined) attrs["part"] = parts.part;
    if (parts.subpart !== undefined) attrs["subpart"] = parts.subpart;
  }
  if (attrs["edition"] === undefined && data["letter_edition"] !== undefined) {
    const editionVal = isObj(data["letter_edition"])
      ? strv((data["letter_edition"] as TreeObject)["letter_edition"])
      : strv(data["letter_edition"]);
    if (editionVal !== undefined) attrs["edition"] = editionVal;
  }

  const date = yearDate(data["year"]);
  if (date !== undefined) attrs["date"] = date;
  return new (ctor(AerospaceStandardClass))(attrs) as unknown as Identifier;
}

function buildStandaloneAmendment(data: TreeObject): Identifier {
  const amdRaw = data["standalone_amendment"] ?? data["parenthesized_amd"];
  const amdData = flatten(amdRaw as Tree);
  return new (ctor(StandaloneAmendmentClass))({
    number: strv(amdData["amendment_number"]),
    corrigendum: amdData["corrigendum"] !== undefined,
    parenthesized: data["parenthesized_amd"] !== undefined,
  }) as unknown as Identifier;
}

function buildCommitteeDocument(data: TreeObject): Identifier {
  const yearVal = strv(data["year"]);
  const fullYear = yearVal !== undefined ? `20${yearVal}` : undefined;
  const attrs: Record<string, unknown> = {
    number: strv(data["document_number"]),
  };
  if (fullYear !== undefined) attrs["date"] = new PubidDate({ year: String(Number(fullYear)) });
  return new (ctor(CommitteeDocumentClass))(attrs) as unknown as Identifier;
}

function buildValueAddedPublication(data: TreeObject, _supplements: SuppData[]): Identifier {
  const format = data["pdf_format"] !== undefined
    ? "PDF"
    : data["tc_format"] !== undefined
      ? "TC"
      : data["book_format"] !== undefined
        ? "BOOK"
        : undefined;
  const baseData = { ...data };
  delete baseData["pdf_format"];
  delete baseData["tc_format"];
  delete baseData["book_format"];
  const baseId = buildTree(baseData);
  return new (ctor(ValueAddedPublicationClass))({
    base: baseId as BsiIdentifier,
    format,
  }) as unknown as Identifier;
}

function buildNationalAnnex(data: TreeObject, _supplements: SuppData[]): Identifier {
  const baseData = { ...data };
  delete baseData["na_prefix"];
  delete baseData["na_supplements"];
  const baseId = buildTree(baseData);

  const naPrefix = isObj(data["na_prefix"]) ? (data["na_prefix"] as TreeObject) : undefined;
  const naSuppRaw = naPrefix !== undefined && naPrefix["na_supplements"] !== undefined
    ? naPrefix["na_supplements"]
    : data["na_supplements"];
  const naSuppData = naSuppRaw !== undefined
    ? extractSupplementsFromArray(Array.isArray(naSuppRaw) ? (naSuppRaw as unknown[]).flat(Infinity as 10) : [naSuppRaw])
    : [];

  const naSupps = naSuppData.map((supp) => {
    const yearVal = expandYear(supp.year);
    if (supp.type === "amendment") {
      return new Amendment({
        number: supp.number,
        year: yearVal,
        separator: supp.separator,
      });
    }
    return new Corrigendum({
      number: supp.number,
      year: yearVal,
      separator: supp.separator,
    });
  });

  return new (ctor(NationalAnnexClass))({
    na_supplements: naSupps,
    base: baseId as BsiIdentifier,
  }) as unknown as Identifier;
}

function iterationOf(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const flat = (Array.isArray(v) ? (v as unknown[]).flat(Infinity as 10) : [v]) as unknown[];
  for (const item of flat) {
    if (isObj(item)) {
      const raw = (item as TreeObject)["iteration"];
      const inner = Array.isArray(raw)
        ? iterationOf(raw)
        : strv(raw);
      if (inner !== undefined && inner !== "") return inner;
    }
  }
  return undefined;
}

function buildSupplementDocument(data: TreeObject): Identifier {
  const publisherVal = strv(data["publisher"]);
  const parts = partsToAttrs(data["parts"]);
  const baseData: Record<string, unknown> = {
    ...(publisherVal !== undefined ? { publisher: publisherVal } : {}),
    number: numv(data["number"]),
    ...(iterationOf(data["iteration"]) !== undefined ? { iteration: iterationOf(data["iteration"]) } : {}),
    ...(parts.part !== undefined ? { part: parts.part } : {}),
    ...(parts.subpart !== undefined ? { subpart: parts.subpart } : {}),
    ...(data["flex_prefix"] !== undefined ? { flex_prefix: strv(data["flex_prefix"]) } : {}),
  };
  const reverseFormat = data["supplement_number"] !== undefined
    && data["supplement_year"] !== undefined
    && data["publisher"] !== undefined
    && data["number"] !== undefined
    && data["base_year"] !== undefined;
  if (reverseFormat) {
    baseData["year"] = data["base_year"];
  } else if (data["year"] !== undefined) {
    baseData["year"] = data["year"];
  }
  const baseId = buildTree(baseData as TreeObject);

  const suppType = strv(data["supp_no_prefix"]) === "No."
    ? "No."
    : strv(data["supp_no_prefix"]) !== undefined
      ? strv(data["supp_no_prefix"])!
      : "";

  return new (ctor(SupplementDocumentClass))({
    base: baseId as BsiIdentifier,
    supplement_number: strv(data["supplement_number"]),
    supplement_year: data["supplement_year"] !== undefined ? Number(strv(data["supplement_year"])) : undefined,
    supplement_type: suppType,
    reverse_format: reverseFormat,
    separator: strv(data["supp_sep"]) ?? ":",
  }) as unknown as Identifier;
}

function buildAddendumDocument(data: TreeObject): Identifier {
  const publisherVal = strv(data["publisher"]);
  const parts = partsToAttrs(data["parts"]);
  const baseData: Record<string, unknown> = {
    ...(publisherVal !== undefined ? { publisher: publisherVal } : {}),
    number: numv(data["number"]),
    ...(iterationOf(data["iteration"]) !== undefined ? { iteration: iterationOf(data["iteration"]) } : {}),
    ...(parts.part !== undefined ? { part: parts.part } : {}),
    ...(parts.subpart !== undefined ? { subpart: parts.subpart } : {}),
    ...(data["flex_prefix"] !== undefined ? { flex_prefix: strv(data["flex_prefix"]) } : {}),
  };
  if (data["base_year"] !== undefined) baseData["year"] = data["base_year"];
  const baseId = buildTree(baseData as TreeObject);

  const addType = strv(data["add_no_prefix"]) === "No."
    ? "No."
    : strv(data["add_no_prefix"]) !== undefined
      ? strv(data["add_no_prefix"])!
      : "";

  return new (ctor(AddendumDocumentClass))({
    base: baseId as BsiIdentifier,
    addendum_number: strv(data["addendum_number"]),
    addendum_year: data["addendum_year"] !== undefined ? Number(strv(data["addendum_year"])) : undefined,
    addendum_type: addType,
    separator: strv(data["add_sep"]) ?? ":",
  }) as unknown as Identifier;
}

function buildBundleItem(itemData: unknown, defaultPublisher: string, defaultPrefix: string | undefined): BsiIdentifier {
  if (isObj(itemData)) {
    const d = itemData;
    const hasExplicitPublisher = d["publisher"] !== undefined;
    const hasExplicitPrefix = d["prefix"] !== undefined;
    const publisherVal = strv(d["publisher"]) ?? defaultPublisher;
    const prefixVal = strv(d["prefix"]) ?? defaultPrefix;
    const id = new BsiIdentifier({
      ...(publisherVal !== undefined ? { publisher: pub(publisherVal) } : {}),
      ...(prefixVal !== undefined && prefixVal !== "" ? { prefix: prefixVal } : {}),
      ...(strv(d["number"]) !== undefined ? { number: strv(d["number"]) } : {}),
    });
    const self = id as unknown as Record<string, unknown>;
    self["explicit_prefix"] = hasExplicitPublisher || hasExplicitPrefix;
    self["explicit_publisher"] = hasExplicitPublisher;

    const partsVal = d["parts"];
    if (isObj(partsVal) && Array.isArray((partsVal as TreeObject)["parts"])) {
      const partsArray = (partsVal as TreeObject)["parts"] as unknown[];
      const partStr = strv((partsArray[0] as TreeObject)?.["part"]);
      if (partStr !== undefined) self["part"] = partStr;
    } else if (d["part"] !== undefined) {
      self["part"] = strv(d["part"]);
      self["space_separated_part"] = true;
    }
    return id;
  }
  // Simple string (alphanumeric like "N001")
  return new BsiIdentifier({ number: strv(itemData) });
}

function buildBundledIdentifier(data: TreeObject): Identifier {
  if (data["bundled_parts"] !== undefined) {
    const partsData = flatten(data["bundled_parts"] as Tree);
    const baseNumber = strv(partsData["number"]) ?? "";
    const bundleType = strv(partsData["bundle_type"]) ?? "";
    const part1 = strv(partsData["part1"]) ?? "";
    const part2 = strv(partsData["part2"]) ?? "";
    const yearVal = strv(partsData["year"]);

    const baseId = new BsiIdentifier({ publisher: pub("BS"), number: baseNumber });
    const id1 = new BsiIdentifier({ publisher: pub("BS"), number: baseNumber, part: part1 });
    const id2 = new BsiIdentifier({ publisher: pub("BS"), number: baseNumber, part: part2 });

    return new (ctor(BundledIdentifierClass))({
      identifiers: [baseId, id1, id2],
      bundle_type: bundleType,
      common_year: yearVal !== undefined ? new PubidDate({ year: String(Number(yearVal)) }) : undefined,
    }) as unknown as Identifier;
  }

  const listArray = (Array.isArray(data["bundled_list"]) ? data["bundled_list"] : [data["bundled_list"]]) as TreeObject[];
  const firstElem = flatten(listArray[0] as Tree);
  const publisherVal = strv(firstElem["publisher"]) ?? "BS";
  const prefixVal = strv(firstElem["prefix"]);

  const items: BsiIdentifier[] = [];
  const separators: string[] = [];

  if (firstElem["bundle_item"] !== undefined) {
    items.push(buildBundleItem(firstElem["bundle_item"], publisherVal, prefixVal));
  }

  for (const rawElem of listArray.slice(1)) {
    const elem = flatten(rawElem as Tree);
    if (elem["year"] !== undefined) continue;
    if (elem["bundle_item"] !== undefined) {
      let sep = " and ";
      if (elem["sep_and"] !== undefined) sep = " and ";
      else if (elem["sep_to"] !== undefined) {
        const toCase = strv((elem["sep_to"] as TreeObject)?.["to_case"]);
        sep = toCase === "TO" ? " TO " : " to ";
      } else if (elem["sep_ampersand"] !== undefined) sep = " & ";
      else if (elem["sep_semicolon"] !== undefined) sep = "; ";
      else if (elem["sep_comma"] !== undefined) sep = ",";
      separators.push(sep);
      items.push(buildBundleItem(elem["bundle_item"], publisherVal, prefixVal));
    }
  }

  const yearElem = listArray.map((e) => flatten(e as Tree)).find((e) => e["year"] !== undefined);
  const yearVal = yearElem !== undefined ? strv(yearElem["year"]) : undefined;

  return new (ctor(BundledIdentifierClass))({
    identifiers: items,
    separators,
    common_year: yearVal !== undefined ? new PubidDate({ year: String(Number(yearVal)) }) : undefined,
  }) as unknown as Identifier;
}

function buildSetData(setRaw: unknown): Identifier {
  const itemsArray = Array.isArray(setRaw) ? (setRaw as unknown[]).flat(Infinity as 10) : [setRaw];
  const identifiers: Identifier[] = [];

  for (const item of itemsArray) {
    const itemData = isObj(item) && item["set_item"] !== undefined
      ? (flatten(item["set_item"] as Tree))
      : (isObj(item) ? (item as TreeObject) : ({} as TreeObject));

    let idStr = "";
    if (itemData["publisher"] !== undefined) idStr += `${strv(itemData["publisher"])} `;
    if (itemData["adopted_org"] !== undefined) idStr += `${strv(itemData["adopted_org"])} `;
    const numberVal = isObj(itemData["number"])
      ? strv((itemData["number"] as TreeObject)["number"])
      : strv(itemData["number"]);
    if (numberVal !== undefined) idStr += numberVal;

    if (isObj(itemData["parts"])) {
      const partsInner = (itemData["parts"] as TreeObject)["parts"];
      if (Array.isArray(partsInner) && partsInner.length > 0) {
        const partVal = strv((partsInner[0] as TreeObject)["part"]);
        if (partVal !== undefined) idStr += `-${partVal}`;
      }
    }
    if (itemData["year"] !== undefined) idStr += `:${strv(itemData["year"])}`;

    if (idStr.trim() === "") continue;
    const parsed = parseBsi(idStr);
    if (parsed !== undefined) identifiers.push(parsed);
  }

  return new (ctor(SetClass))({
    identifiers,
    separators: Array.from({ length: Math.max(0, identifiers.length - 1) }, () => " + "),
  }) as unknown as Identifier;
}

// --- Adopted identifiers ---------------------------------------------------------------

function buildAdoptedIdentifier(dataIn: TreeObject, originalIn: TreeObject): Identifier | undefined {
  const data = dataIn as Record<string, unknown>;
  const original = originalIn as Record<string, unknown>;
  const adoptedRaw = data["adopted_string"];
  let adoptedStr = isObj(adoptedRaw)
    ? strv((adoptedRaw as TreeObject)["adopted_string"]) ?? strv((adoptedRaw as TreeObject)["adopted_string_no_expert"])
    : strv(adoptedRaw);
  if (adoptedStr === undefined || adoptedStr === "") return undefined;
  adoptedStr = adoptedStr.trim();

  const isBare = data["publisher"] === undefined && data["type"] === undefined
    && data["na_prefix"] === undefined && data["flex_type"] === undefined && data["stage"] === undefined;

  // Extract Expert Commentary suffixes (case-insensitive).
  const setExComm = (topic?: string) => {
    data["expert_commentary_full"] = topic === undefined ? "Expert Commentary" : undefined;
    if (topic === undefined && data["expert_commentary"] === undefined) data["expert_commentary"] = true;
    if (topic !== undefined) {
      data["expert_commentary_topic"] = topic;
      if (data["expert_commentary"] === undefined) data["expert_commentary"] = true;
    }
    if (topic === undefined) {
      original["expert_commentary_full"] = "Expert Commentary";
      if (original["expert_commentary"] === undefined) original["expert_commentary"] = true;
    } else {
      original["expert_commentary_topic"] = topic;
      if (original["expert_commentary"] === undefined) original["expert_commentary"] = true;
    }
  };

  if (/expert commentary$/i.test(adoptedStr)) {
    adoptedStr = adoptedStr.replace(/expert commentary$/i, "");
    setExComm();
  } else if (/excomm \($/i.test(adoptedStr)) {
    adoptedStr = adoptedStr.replace(/excomm \(.*\)$/i, "");
    setExComm();
  } else if (/excomm \(/i.test(adoptedStr)) {
    const topicMatch = adoptedStr.match(/excomm\s*\(([^)]+)\)/i);
    adoptedStr = adoptedStr.replace(/excomm\s*\(.*\)$/i, "");
    setExComm(topicMatch?.[1]);
  } else if (/excomm\s*$/i.test(adoptedStr)) {
    adoptedStr = adoptedStr.replace(/excomm\s*$/i, "");
    if (data["expert_commentary"] === undefined) data["expert_commentary"] = true;
    if (original["expert_commentary"] === undefined) original["expert_commentary"] = true;
  }

  // Extract translation suffixes.
  const parenMatch = adoptedStr.match(/\s*\(([A-Za-z]+)(?:\s+(Translation|version))?\)\s*$/);
  if (parenMatch !== null) {
    data["translation_lang"] = parenMatch[1];
    if (parenMatch[2] !== undefined) data["translation_suffix_type"] = parenMatch[2];
    adoptedStr = adoptedStr.replace(/\s*\([A-Za-z]+(?:\s+(?:Translation|version))?\)\s*$/, "");
  } else {
    const upperMatch = adoptedStr.match(/\s+(SPANISH|FRENCH|GERMAN|ITALIAN)\s+TRANSLATION\s*$/);
    if (upperMatch !== null) {
      data["translation_upper"] = upperMatch[1];
      data["translation_suffix_type"] = "Translation";
      adoptedStr = adoptedStr.replace(/\s+(SPANISH|FRENCH|GERMAN|ITALIAN)\s+TRANSLATION\s*$/, "");
    }
  }

  // Extract edition (only when NOT bare).
  const editionMatch = isBare ? null : adoptedStr.match(/\s+ED(\d+)\s*$/);
  const extractedEdition = editionMatch !== null ? editionMatch[1] : undefined;
  if (editionMatch !== null) {
    adoptedStr = adoptedStr.replace(/\s+ED\d+\s*$/, "");
  }
  const finalEdition = strv(data["edition"]) ?? extractedEdition;

  // Extract reaffirmation "(R2004)".
  const reaffirmationMatch = adoptedStr.match(/\s+\(R(\d{4})\)\s*$/);
  if (reaffirmationMatch !== null) {
    data["reaffirmation_year"] = reaffirmationMatch[1];
    adoptedStr = adoptedStr.replace(/\s+\(R\d{4}\)\s*$/, "");
  }

  // Extract BSI-style supplements from the adopted string.
  const extractedSupplements: SuppData[] = [];
  adoptedStr = adoptedStr.replace(
    /([+])(A(\d+)|AMD(\d+)|C(\d+)|COR(\d+))(?::(\d{4}))?(?:\s|$)/g,
    (match, sep, typeCode, _a, _amd, _c, _cor, year) => {
      const suppType: "amendment" | "corrigendum" = typeCode.startsWith("A") ? "amendment" : "corrigendum";
      const suppNumber = typeCode.startsWith("AMD")
        ? typeCode.slice(3)
        : typeCode.replace(/^[AC]/, "");
      extractedSupplements.push({
        type: suppType,
        number: suppNumber,
        year: year !== undefined ? year : undefined,
        separator: sep,
        amd_suffix_form: false,
      });
      return "";
    },
  ).trim();

  adoptedStr = adoptedStr.replace(
    /\s+AMD\s*(AA|\d+)(?:\s|$)/gi,
    (match) => {
      const amdNumber = match.trim().replace(/^AMD\s*/i, "");
      extractedSupplements.push({
        type: "amendment",
        number: amdNumber,
        year: undefined,
        separator: undefined as unknown as string,
        amd_suffix_form: true,
      });
      return "";
    },
  ).trim();

  const bsiPrefix = strv(data["type"]) ?? strv(data["publisher"]) ?? "BS";

  let adoptedId: Identifier | undefined;

  if (/^EN\s+(ISO\/IEC|IEC|ISO)/.test(adoptedStr)) {
    const isoIecStr = adoptedStr.replace(/^EN\s+/, "");
    let parsed: Identifier | undefined;
    if (isoIecStr.startsWith("ISO/IEC") || isoIecStr.includes("ISO/IEC")) {
      parsed = tryForeign("iso", isoIecStr);
    } else if (isoIecStr.startsWith("ISO")) {
      parsed = tryForeign("iso", isoIecStr);
    } else if (isoIecStr.startsWith("IEC")) {
      parsed = tryForeign("iec", isoIecStr);
    }
    // Wrap the ISO/IEC identifier in a CEN EN adoption.
    if (parsed !== undefined) {
      adoptedId = new (CenAdoptedEuropeanNormClass as unknown as new (attrs?: Record<string, unknown>) => Identifier)({
        publisher: "EN",
        adopted: parsed,
      });
    } else {
      adoptedId = tryForeign("cen_cenelec", adoptedStr);
    }
  } else if (adoptedStr.startsWith("ISO/IEC") || adoptedStr.includes("ISO/IEC")) {
    adoptedId = tryForeign("iso", adoptedStr);
  } else if (adoptedStr.startsWith("ISO")) {
    adoptedId = tryForeign("iso", adoptedStr);
  } else if (adoptedStr.startsWith("IEC")) {
    adoptedId = tryForeign("iec", adoptedStr);
  } else if (/^(EN|CEN|CLC|CR|ES|ENV|HD|CWA)/.test(adoptedStr)) {
    adoptedId = tryForeign("cen_cenelec", adoptedStr);
  } else if (adoptedStr.startsWith("CISPR")) {
    adoptedId = tryForeign("iec", adoptedStr);
  }

  if (isBare && adoptedId !== undefined) return adoptedId;

  if (adoptedId !== undefined) {
    // AdoptedEuropeanNorm for CEN documents, else AdoptedInternational.
    const adoptedWire = (adoptedId as unknown as { toHash: () => Record<string, unknown> }).toHash();
    const adoptedTypeStr = String(adoptedWire["_type"] ?? "");
    const wrapperCtor = adoptedTypeStr.startsWith("pubid:cencenelec")
      ? AdoptedEuropeanNormClass
      : AdoptedInternationalStandardClass;

    let identifier: BsiIdentifier = new (ctor(wrapperCtor))({
      publisher: pub(bsiPrefix),
      base: adoptedId as BsiIdentifier,
      ...(finalEdition !== undefined ? { edition: finalEdition } : {}),
      ...(strv(data["translation_lang"]) !== undefined ? { translation_lang: strv(data["translation_lang"]) } : {}),
      ...(strv(data["translation_upper"]) !== undefined ? { translation_upper: strv(data["translation_upper"]) } : {}),
      ...(strv(data["translation_suffix_type"]) !== undefined ? { translation_suffix_type: strv(data["translation_suffix_type"]) } : {}),
      ...(strv(data["reaffirmation_year"]) !== undefined ? { reaffirmation_year: strv(data["reaffirmation_year"]) } : {}),
    });

    if (extractedSupplements.length > 0) {
      identifier = wrapWithConsolidated(identifier, extractedSupplements);
    }
    if (data["expert_commentary"] !== undefined || data["expert_commentary_full"] !== undefined) {
      identifier = wrapWithExpertCommentary(identifier, original as TreeObject);
    }
    return identifier as unknown as Identifier;
  }

  return undefined;
}

// --- The parse entry -------------------------------------------------------------------

function parseBsi(input: string): Identifier | undefined {
  const cleaned = preprocessBsi(input);
  try {
    const tree = parseGrammar(bsiGrammar, cleaned);
    return buildBsiIdentifier(tree);
  } catch {
    return undefined;
  }
}

export function bsiGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      // Delegate to IEC for bare IEC identifiers with VAP suffixes or
      // consolidated supplements (single_identifier.rb .parse).
      if (/\bIEC\b/.test(input)
        && (/\s+(CSV|CMV|RLV|SER|EXV|PAC|PRV)\b/.test(input)
          || /\+AMD\d+:/.test(input)
          || /\+COR\d+:/.test(input))) {
        const iec = grammarImplementation("iec");
        return iec!.parse(input);
      }
      const parsed = parseBsi(input);
      if (parsed === undefined) {
        throw new Error("Failed to parse BSI identifier");
      }
      return parsed;
    },
  };
}
