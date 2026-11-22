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
 * disambiguation lives on the model (EuIdentifier#numbers). The ELI
 * subtype ("reg_impl") is stripped before the grammar and carried as an
 * equality-ignored facet, as Identifier.bound_without_subtype does.
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

// The subtypes CELLAR gives each ELI type: implementing and delegated
// acts of every type, and the financial regulation (Identifier::
// ELI_SUBTYPES).
const ELI_SUBTYPES: Record<string, string[]> = {
  reg: ["impl", "del", "financ"],
  dir: ["impl", "del"],
  dec: ["impl", "del"],
};

// The subtype of an ELI input, removed before the baked grammar (which
// knows only reg/dir/dec), as BSI and IETF strip their prefixes
// (Identifier::ELI_SUBTYPE).
const ELI_SUBTYPE = /^(https?:\/\/data\.europa\.eu\/eli\/(reg|dir|dec))_([a-z]+)\//;

/** A known subtype of a known ELI type, or undefined. An unknown one
 *  stays in the input, so the grammar rejects it. */
function eliSubtype(identifier: string): string | undefined {
  const match = ELI_SUBTYPE.exec(identifier);
  if (match === null) return undefined;
  const subtype = match[3] as string;
  return (ELI_SUBTYPES[match[2] as string] ?? []).includes(subtype) ? subtype : undefined;
}

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

function buildEu(data: Record<string, unknown>, subtype?: string): EuIdentifier {
  const act = positional(data) ?? fromPair(data);
  if (!isPlausibleYear(act.year)) {
    throw new Error(`EU legal act: ${act.year} is not a year`);
  }
  const number = stripLeadingZeros(act.number);
  if (number === "0") {
    throw new Error("EU legal act: number 0");
  }

  const fam = family(data);
  const id = new act.klass({
    number,
    date: { year: act.year },
    ...(fam !== undefined ? { family: fam } : {}),
    ...(subtype !== undefined ? { subtype } : {}),
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
      // An ELI subtype ("reg_impl") is stripped before the grammar, as
      // the reference's bound_without_subtype does; the subtype rides
      // the build as an equality-ignored facet.
      const subtype = eliSubtype(input);
      const stripped = subtype !== undefined
        ? input.replace(ELI_SUBTYPE, "$1/")
        : input;
      const bound = cachedRuntime.parseAndBind(stripped);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed("eu: the artifact rejected the input", 0);
      }
      return buildEu(bound as Record<string, unknown>, subtype) as unknown as Identifier;
    },
  };
}
