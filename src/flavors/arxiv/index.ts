import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { ArxivEprint, ArxivIdentifier } from "./model.js";

export * from "./model.js";

/**
 * The arxiv parse entry — the same baked artifact the Ruby flavor runs
 * (pubid-grammar grammars/arxiv.parg -> artifacts/arxiv.json, sealed at
 * parsanol 1.5.1.0), loaded through the artifact runtime. The builder
 * mirrors Pubid::Arxiv::Builder: the grammar checks the shape, this
 * side checks the rules the shape cannot express, raising (which the
 * parse entry surfaces as a rejection):
 *
 * - the month is 01-12;
 * - a 4-digit new number has a YYMM from 0704 to 1412;
 * - a 5-digit new number has a YYMM from 1501;
 * - an old-form id has a YYMM from 9108 to 0703;
 * - the version is 1 or more, with no leading zero (so to_s is exact).
 */

// --- Builder (lib/pubid/arxiv/builder.rb) ------------------------------------

const s = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const text = String(v);
  return text.length > 0 ? text : undefined;
};

/** Old-form ids run from 9108 to 0703, so 91-99 is the 1990s; a new id
 *  is always in the 2000s. */
function yearMonth(yymmRaw: string, old: boolean): [number, number] {
  const yymm = String(yymmRaw ?? "");
  const twoDigit = Number(yymm.slice(0, 2));
  const month = Number(yymm.slice(2, 4));
  if (!(month >= 1 && month <= 12)) {
    throw new Error(`month out of range in YYMM ${yymm}`);
  }
  const century = old && twoDigit >= 91 ? 1900 : 2000;
  return [century + twoDigit, month];
}

const ym = (year: number, month: number): number => year * 100 + month;

function validateRange(year: number, month: number, number: string, old: boolean): void {
  if (old) {
    if (!(ym(year, month) >= 199108 && ym(year, month) <= 200703)) {
      throw new Error("an old-form id dates from 9108 to 0703");
    }
    return;
  }
  const valid = number.length === 4
    ? ym(year, month) >= 200704 && ym(year, month) <= 201412
    : ym(year, month) >= 201501;
  if (!valid) {
    const yy = String(year % 100).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    throw new Error(
      `a ${number.length}-digit number does not fit YYMM ${yy}${mm}`,
    );
  }
}

/** The version is 1 or more, with no leading zero (v01 would render v1,
 *  so to_s would not be exact). */
function parseVersion(value: unknown): number | undefined {
  const raw = s(value);
  if (raw === undefined) return undefined;
  if (raw.startsWith("0")) {
    throw new Error(`version v${raw} is not 1 or more without a leading zero`);
  }
  return Number(raw);
}

function buildArxiv(data: Record<string, unknown>): ArxivIdentifier {
  const archive = s(data["archive"]);
  const [year, month] = yearMonth(String(data["yymm"] ?? ""), archive !== undefined);
  const number = String(data["number"] ?? "");
  validateRange(year, month, number, archive !== undefined);

  return new ArxivEprint({
    ...(archive !== undefined ? { archive } : {}),
    ...(s(data["subject_class"]) !== undefined
      ? { subject_class: s(data["subject_class"]) }
      : {}),
    year,
    month,
    number,
    ...(parseVersion(data["version"]) !== undefined
      ? { version: parseVersion(data["version"]) }
      : {}),
  });
}

// --- Implementation ----------------------------------------------------------

let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function arxivGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("arxiv");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed("arxiv: the artifact rejected the input", 0);
      }
      try {
        return buildArxiv(bound as Record<string, unknown>) as unknown as Identifier;
      } catch (e) {
        // The builder checks the date ranges, the month and the version;
        // surface that as a parse failure, the class a grammar rejection
        // has (the gem turns its ArgumentError into ParseError here).
        throw new Error(`invalid arXiv identifier '${input}': ${(e as Error).message}`);
      }
    },
  };
}
