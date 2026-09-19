import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { ashraeGrammar } from "./grammar.js";
import { preprocessAshrae } from "./preprocessor.js";
import { PubidDate } from "../../model/component.js";
import {
  AddendaPackage,
  Addendum,
  CombinedAddenda,
  Errata,
  Guideline,
  Interpretation,
  Standard,
} from "./model.js";

/**
 * Port of lib/pubid/ashrae/builder.rb — attribute extraction, class
 * selection, and the five supplement build paths.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

type LeafCtor = new (attrs?: Record<string, unknown>) => Standard | Guideline;

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

function value(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    const joined = v.join("");
    return joined.length > 0 ? joined : undefined;
  }
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function leafClass(type: string | undefined): LeafCtor {
  return type === "Guideline" ? (Guideline as LeafCtor) : (Standard as LeafCtor);
}

function buildLeaf(attrs: Record<string, unknown>): Standard | Guideline {
  return new (leafClass(attrs["type"] as string | undefined))(attrs);
}

function extractAttributes(parsed: TreeObject): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  const publisher = value(parsed["publisher"]);
  if (publisher !== undefined) attributes["publisher"] = publisher;

  attributes["type"] = value(parsed["type"]) ?? "Standard";

  const codeWithYear = parsed["code_with_year"];
  if (isObj(codeWithYear)) {
    const code = value(codeWithYear["code"]);
    if (code !== undefined) attributes["number"] = code;
    const year = value(codeWithYear["year"]);
    if (year !== undefined) attributes["year"] = year;
  } else if (codeWithYear === undefined) {
    const code = value(parsed["code"]);
    if (code !== undefined) attributes["number"] = code;
  }

  if (attributes["year"] === undefined) {
    const year = value(parsed["year"]);
    if (year !== undefined) attributes["year"] = year;
  }

  const suffix = value(parsed["suffix"]);
  if (suffix !== undefined) attributes["suffix"] = suffix;

  const reaffirmed = value(parsed["reaffirmed"]);
  if (reaffirmed !== undefined) attributes["reaffirmed"] = reaffirmed;

  const copublisher = value(parsed["copublisher"]);
  if (copublisher !== undefined) attributes["copublisher"] = copublisher;

  return attributes;
}

function extractBaseAttributes(parsed: TreeObject): Record<string, unknown> {
  // Unwrap the :base subtree the supplement grammars nest the base
  // document under.
  const data = isObj(parsed["base"]) ? (parsed["base"] as TreeObject) : parsed;

  const attributes: Record<string, unknown> = {};

  const publisher = value(data["publisher"]);
  if (publisher !== undefined) attributes["publisher"] = publisher;
  const copublisher = value(data["copublisher"]);
  if (copublisher !== undefined) attributes["copublisher"] = copublisher;
  attributes["type"] = value(data["type"]) ?? "Standard";

  const codeWithYear = data["code_with_year"];
  if (isObj(codeWithYear)) {
    const code = value(codeWithYear["code"]);
    if (code !== undefined) attributes["number"] = code;
    const year = value(codeWithYear["year"]);
    if (year !== undefined) attributes["year"] = year;
  } else {
    const code = value(data["code"]);
    if (code !== undefined) attributes["number"] = code;
    const year = value(data["year"]);
    if (year !== undefined) attributes["year"] = year;
  }

  const suffix = value(data["suffix"]);
  if (suffix !== undefined) attributes["suffix"] = suffix;
  const reaffirmed = value(data["reaffirmed"]);
  if (reaffirmed !== undefined) attributes["reaffirmed"] = reaffirmed;

  return attributes;
}

function pad2(v: string): string {
  return String(Number(v)).padStart(2, "0");
}

function errataDateOf(errataDate: unknown): PubidDate | undefined {
  if (!isObj(errataDate)) return undefined;

  const numeric = value(errataDate["numeric_date"]);
  if (numeric !== undefined) {
    const [month, day, year] = numeric.replaceAll(" ", "").split("-");
    return new PubidDate({ year, month: pad2(month!), day: pad2(day!) });
  }

  const monthName = value(errataDate["month"]);
  const month = monthName === undefined ? undefined : MONTH_NAMES.indexOf(monthName) + 1;
  const day = value(errataDate["day"]);
  if (month === undefined || month === 0 || day === undefined) return undefined;

  return new PubidDate({
    year: value(errataDate["errata_year"]),
    month: pad2(String(month)),
    day: pad2(day),
  });
}

function buildErrata(parsed: TreeObject): Identifier {
  const base = buildLeaf(extractBaseAttributes(parsed));
  return new Errata({ base, date: errataDateOf(parsed["errata_date"]) }) as unknown as Identifier;
}

function buildAddendum(parsed: TreeObject): Identifier {
  const base = buildLeaf(extractBaseAttributes(parsed));
  return new Addendum({
    base,
    addendum_code: value(parsed["addendum_code"]),
  }) as unknown as Identifier;
}

function buildPublisherAddendum(parsed: TreeObject): Identifier {
  const base = buildLeaf({
    type: value(parsed["type"]),
    number: value(parsed["code"]),
    year: value(parsed["year"]),
  });
  return new Addendum({
    base,
    addendum_code: value(parsed["addendum_code"]),
  }) as unknown as Identifier;
}

function codeWithYearBaseAttrs(parsed: TreeObject): Record<string, unknown> {
  const baseAttrs: Record<string, unknown> = { type: "Standard" };
  const copublisher = value(parsed["copublisher"]);
  if (copublisher !== undefined) baseAttrs["copublisher"] = copublisher;
  const codeWithYear = parsed["code_with_year"];
  if (isObj(codeWithYear)) {
    const code = value(codeWithYear["code"]);
    if (code !== undefined) baseAttrs["number"] = code;
    const year = value(codeWithYear["year"]);
    if (year !== undefined) baseAttrs["year"] = year;
  }
  return baseAttrs;
}

function buildCombinedAddenda(parsed: TreeObject): Identifier {
  const baseAttrs: Record<string, unknown> = {};

  if (isObj(parsed["code_with_year"])) {
    const code = value((parsed["code_with_year"] as TreeObject)["code"]);
    if (code !== undefined) baseAttrs["number"] = code;
    const year = value((parsed["code_with_year"] as TreeObject)["year"]);
    if (year !== undefined) baseAttrs["year"] = year;
  } else {
    baseAttrs["type"] = value(parsed["type"]) ?? "Standard";
    const code = value(parsed["code"]);
    if (code !== undefined) baseAttrs["number"] = code;
    const year = value(parsed["year"]);
    if (year !== undefined) baseAttrs["year"] = year;
  }

  const copublisher = value(parsed["copublisher"]);
  if (copublisher !== undefined) baseAttrs["copublisher"] = copublisher;
  const publisher = value(parsed["publisher"]);
  if (publisher !== undefined) baseAttrs["publisher"] = publisher;

  const base = buildLeaf(baseAttrs);

  const firstCode = value(parsed["addendum_code"]);
  const additionalCodes = parsed["additional_codes"];

  let addendumCodes: string | undefined;
  if (firstCode !== undefined || additionalCodes !== undefined) {
    const codeList: string[] = [];
    if (Array.isArray(additionalCodes)) {
      // The repetition subtrees nest (iteration arrays around the
      // captured objects); flatten before extracting each code.
      for (const code of (additionalCodes as unknown[]).flat(Infinity as 10)) {
        const codeStr = isObj(code)
          ? value((code as TreeObject)["addendum_code"])
          : value(code);
        if (codeStr !== undefined && codeStr !== "and") codeList.push(codeStr);
      }
    }
    addendumCodes = firstCode ?? "";
    if (codeList.length > 0) {
      addendumCodes += `, ${codeList.join(", ")}`;
    }
  }

  return new CombinedAddenda({ base, addendum_codes: addendumCodes }) as unknown as Identifier;
}

function buildAddendaPackage(parsed: TreeObject): Identifier {
  const base = buildLeaf(extractBaseAttributes(parsed));
  return new AddendaPackage({
    base,
    package_description: value(parsed["package_description"]),
  }) as unknown as Identifier;
}

export function buildAshraeIdentifier(tree: Tree): Identifier {
  let parsed = flatten(tree);

  if (parsed["errata_keyword"] !== undefined) {
    return buildErrata(parsed);
  }
  if (parsed["interpretation_identifier"] !== undefined) {
    const data = flatten(parsed["interpretation_identifier"] as Tree);
    const base = buildLeaf(extractBaseAttributes(data));
    return new Interpretation({ base }) as unknown as Identifier;
  }
  if (parsed["combined_addenda"] !== undefined) {
    return buildCombinedAddenda(flatten(parsed["combined_addenda"] as Tree));
  }
  if (parsed["addenda_package"] !== undefined) {
    return buildAddendaPackage(flatten(parsed["addenda_package"] as Tree));
  }
  if (parsed["addendum_identifier"] !== undefined) {
    return buildAddendum(flatten(parsed["addendum_identifier"] as Tree));
  }
  if (parsed["publisher_addendum"] !== undefined) {
    return buildPublisherAddendum(flatten(parsed["publisher_addendum"] as Tree));
  }
  if (parsed["publisher_addendum_copublisher"] !== undefined) {
    const data = flatten(parsed["publisher_addendum_copublisher"] as Tree);
    return buildPublisherAddendum({
      copublisher: data["copublisher"],
      type: value(data["type"]) ?? "Standard",
      code: data["code"],
      year: data["year"],
      addendum_code: data["addendum_code"],
    });
  }
  if (parsed["publisher_addendum_copublisher_no_type"] !== undefined) {
    return buildAddendumFromCodeWithYear(flatten(parsed["publisher_addendum_copublisher_no_type"] as Tree));
  }
  if (parsed["addendum_no_type"] !== undefined) {
    const data = flatten(parsed["addendum_no_type"] as Tree);
    return buildAddendumFromCodeWithYear(data);
  }
  if (parsed["standard_addendum"] !== undefined) {
    return buildAddendum(flatten(parsed["standard_addendum"] as Tree));
  }
  if (parsed["addendum"] !== undefined) {
    return buildAddendum(flatten(parsed["addendum"] as Tree));
  }
  if (parsed["publisher_base_addendum"] !== undefined) {
    return buildAddendum(flatten(parsed["publisher_base_addendum"] as Tree));
  }

  if (isObj(parsed["base"])) {
    parsed = parsed["base"] as TreeObject;
  }

  const attributes = extractAttributes(parsed);
  return buildLeaf(attributes) as unknown as Identifier;
}

function buildAddendumFromCodeWithYear(data: TreeObject): Identifier {
  const base = buildLeaf(codeWithYearBaseAttrs(data));
  return new Addendum({
    base,
    addendum_code: value(data["addendum_code"]),
  }) as unknown as Identifier;
}

export function ashraeGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const cleaned = preprocessAshrae(input);
      const tree = parseGrammar(ashraeGrammar, cleaned);
      return buildAshraeIdentifier(tree);
    },
  };
}
