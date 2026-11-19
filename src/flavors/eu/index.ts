import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import {
  EuIdentifier,
  EuDecision,
  EuDirective,
  EuRegulation,
  isPlausibleYear,
  numberFirstFor,
  stripLeadingZeros,
  type EuLeafClass,
} from "./model.js";

export * from "./model.js";

/**
 * The eu parse entry — the same baked artifact the Ruby flavor runs
 * (pubid-grammar grammars/eu.parg -> artifacts/eu.json, sealed at
 * parsanol 1.5.1.0), loaded through the artifact runtime so grammar
 * changes land once and this side cannot drift. The builder mirrors
 * Pubid::Eu::Builder: CELEX and ELI fix year/number by position, the
 * canonical and Official-Journal forms carry two numbers whose ORDER is
 * not in the grammar (number_first_for), and the renderer's "No"
 * disambiguation lives on the model (EuIdentifier#numbers).
 */

// --- Builder (lib/pubid/eu/builder.rb) ---------------------------------------

const TYPES_BY_WORD: Record<string, EuLeafClass> = {
  Regulation: EuRegulation,
  Directive: EuDirective,
  Decision: EuDecision,
};

const TYPES_BY_CELEX: Record<string, EuLeafClass> = {
  R: EuRegulation,
  L: EuDirective,
  D: EuDecision,
};

const TYPES_BY_ELI: Record<string, EuLeafClass> = {
  reg: EuRegulation,
  dir: EuDirective,
  dec: EuDecision,
};

const s = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const text = String(v);
  return text.length > 0 ? text : undefined;
};

/** One parsed act before it becomes an identifier. */
interface Act {
  klass: EuLeafClass;
  year: string;
  number: string;
  numberFirst: boolean | undefined;
}

function positional(data: Record<string, unknown>): Act | undefined {
  const letter = s(data["celex_letter"]);
  const eli = s(data["eli_type"]);
  const klass = letter !== undefined
    ? TYPES_BY_CELEX[letter]
    : eli !== undefined
    ? TYPES_BY_ELI[eli]
    : undefined;
  if (klass === undefined) return undefined;
  // CELEX and ELI: the year and the number have fixed places.
  return {
    klass,
    year: String(data["year"] ?? ""),
    number: String(data["number"] ?? ""),
    numberFirst: undefined,
  };
}

function fromPair(data: Record<string, unknown>): Act {
  const klass = TYPES_BY_WORD[String(data["type_word"])];
  if (klass === undefined) {
    throw new Error(`EU legal act: unknown act type ${String(data["type_word"])}`);
  }
  const first = String(data["first"] ?? "");
  const second = String(data["second"] ?? "");
  // "No" marks <number>/<year> (Regulation (EU) No 1227/2011, Decision
  // No 1082/2013/EU); every other pair reads by the rule.
  const numberFirst = (data["no"] !== undefined && data["no"] !== null) ||
    numberFirstFor(klass.euType.title, first, second);
  if (numberFirst === undefined) {
    throw new Error(`EU legal act: no year in ${first}/${second}`);
  }
  const [year, number] = numberFirst ? [second, first] : [first, second];
  return { klass, year, number, numberFirst };
}

function family(data: Record<string, unknown>): string | undefined {
  const bracket = s(data["family"]);
  const suffix = s(data["family_suffix"]);
  if (bracket !== undefined && suffix !== undefined && bracket !== suffix) {
    throw new Error(`EU legal act: two families, ${bracket} and ${suffix}`);
  }
  return bracket ?? suffix;
}

function buildEu(data: Record<string, unknown>): EuIdentifier {
  const act = positional(data) ?? fromPair(data);
  if (!isPlausibleYear(act.year)) {
    throw new Error(`EU legal act: ${act.year} is not a year`);
  }
  const number = stripLeadingZeros(act.number);
  if (number === "0") {
    throw new Error("EU legal act: number 0");
  }

  const id = new act.klass({
    number,
    date: { year: act.year },
    ...(family(data) !== undefined ? { family: family(data) } : {}),
  });
  // Keep the order only when it is not what the render rule prints.
  if (act.numberFirst !== undefined && act.numberFirst !== id.defaultNumberFirst()) {
    (id as unknown as Record<string, unknown>)["number_first"] = act.numberFirst;
  }
  return id;
}

// --- Implementation ----------------------------------------------------------

let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function euGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("eu");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed("eu: the artifact rejected the input", 0);
      }
      return buildEu(bound as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
