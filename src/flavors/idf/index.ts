import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { idfGrammar } from "./grammar.js";
import {
  AmendmentClass,
  CorrigendumClass,
  IDF_TYPE_CLASSES,
  IdfIdentifier,
  IdfTypedStageComponent,
  InternationalStandardClass,
  locateStage,
} from "./model.js";
import { Language, PubidDate } from "../../model/component.js";

/**
 * Port of lib/pubid/idf/builder.rb — stage lookup, number/part split,
 * language mapping, supplement wrapping.
 */

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v);
  return s.length > 0 ? s : undefined;
};

const LANG_CHAR_MAP: Record<string, string> = {
  R: "ru", F: "fr", E: "en", A: "ar", S: "es", D: "de",
};

type IdfCtor = new (attrs?: Record<string, unknown>) => IdfIdentifier;

function buildIdentifier(tree: Tree): Identifier {
  const d = Array.isArray(tree) ? (Object.assign({}, ...tree) as TreeObject) : (tree as TreeObject);
  return buildFrom(d) as unknown as Identifier;
}

function buildFrom(d: TreeObject): IdfIdentifier {
  if (d["base"] !== undefined) {
    const base = buildFrom(d["base"] as TreeObject);
    const attrs = assignAttributes(d);
    const typedStage = locateStage(str(d["type_with_stage"]) ?? "AMD");
    const isCor = typedStage?.type_code === "cor";
    const klass = (isCor ? CorrigendumClass : AmendmentClass) as unknown as IdfCtor;
    // The supplement's wire "year" is its DATE flattened by the shared
    // scalar flattener; nothing else changes.
    return new klass({ ...attrs, base, typedStage: typedStage === undefined ? undefined : new IdfTypedStageComponent(typedStage) });
  }

  const rawStage = str(d["type_with_stage"]);
  const stageIteration = str(d["stage_iteration"]);
  // The stage abbr may carry a trailing iteration digit in the capture.
  let stageAbbr = rawStage;
  let iteration = stageIteration;
  if (rawStage !== undefined && iteration === undefined && /\d$/.test(rawStage) && !/\b(RM|FDIS|DIS|COR|AMD)\b/.test(rawStage)) {
    const m = /(\d+)$/.exec(rawStage);
    if (m !== null) {
      stageAbbr = rawStage.slice(0, -(m[1] ?? "").length);
      iteration = m[1];
    }
  }
  const typedStage = locateStage(stageAbbr ?? "");
  const typeCode = typedStage?.type_code ?? "is";
  const klass = (IDF_TYPE_CLASSES[typeCode] ?? InternationalStandardClass) as unknown as IdfCtor;

  const attrs = assignAttributes(d);
  return new klass({
    ...attrs,
    ...(iteration !== undefined ? { stageIteration: iteration } : {}),
    ...(typedStage !== undefined ? { typedStage: new IdfTypedStageComponent(typedStage) } : {}),
  });
}

function assignAttributes(d: TreeObject): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  if (d["number_with_part"] !== undefined) {
    const value = String(
      Array.isArray(d["number_with_part"])
        ? (d["number_with_part"] as unknown[]).join("")
        : d["number_with_part"],
    );
    const parts = value.split("-");
    attrs["number"] = parts.shift();
    const part = parts.shift();
    if (part !== undefined && part !== "") attrs["part"] = part;
    if (parts.length > 0) attrs["subpart"] = parts.join("-");
  }

  if (d["date"] !== undefined) {
    const value = String(
      Array.isArray(d["date"]) ? (d["date"] as unknown[]).join("") : d["date"],
    );
    if (/^\d{4}(-\d{2})?$/.test(value)) {
      const [year, month] = value.split("-");
      attrs["date"] = new PubidDate(month !== undefined ? { year, month } : { year });
    }
  }

  if (d["languages"] !== undefined) {
    const raw = String(d["languages"]).replaceAll("/", ",");
    attrs["languages"] = raw
      .split(",")
      .map((lang) => lang.trim())
      .filter((lang) => lang !== "")
      .map((lang) => new Language({ code: LANG_CHAR_MAP[lang] ?? lang }));
  }

  if (d["all_parts"] !== undefined) {
    attrs["all_parts"] = true;
  }

  if (isObj(d["base"])) {
    // Supplement attrs handled by caller; number/date already read above.
  }

  return attrs;
}

export function idfGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(idfGrammar, input);
      return buildIdentifier(tree);
    },
  };
}
