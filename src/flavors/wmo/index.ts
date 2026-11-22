import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { WmoAnnex, WmoIdentifier, WmoPublication, WmoStandard } from "./model.js";

export * from "./model.js";

/**
 * The wmo parse entry — the same baked artifact the Ruby flavor runs
 * (pubid-grammar grammars/wmo.parg -> artifacts/wmo.json, sealed at
 * parsanol 1.5.1.0), loaded through the artifact runtime. The builder
 * mirrors Pubid::Wmo::Builder: the grammar carries exactly one
 * doc_number and edition_value per alternative path, so one flat bound
 * map serves all types and the dispatch keys off `annex_marker` and
 * `series_head`.
 */

/**
 * The series head the grammar matched -> the model's series key (the
 * widening prefix law: every head names its publisher, and the head
 * face is the grammar's verbatim capture, so the key mapping lives on
 * the one construction site).
 */
const SERIES_HEADS: Record<string, string | undefined> = {
  "WMO-No.": undefined,
  "WMO/TD-No.": "TD",
  "JCOMM Technical Report No.": "JCOMM",
  "GAW Report No.": "GAW",
};

const head = (data: Record<string, unknown>, key: string): string | undefined =>
  data[key] === undefined ? undefined : String(data[key]);

function buildWmo(data: Record<string, unknown>): WmoIdentifier {
  const number = head(data, "doc_number");
  const edition = head(data, "edition_value");
  const annexMarker = head(data, "annex_marker");
  const annexLetter = head(data, "annex_letter");

  if (annexMarker !== undefined) {
    const attrs: Record<string, unknown> = {
      base: new WmoStandard({ number }),
      annex_form: annexMarker,
    };
    if (annexLetter !== undefined) attrs["letter"] = annexLetter;
    if (edition !== undefined) attrs["edition"] = edition;
    return new WmoAnnex(attrs);
  }
  if (data["series_head"] !== undefined) {
    // The widened publication series: the head key plus the volume,
    // status and updated-in faces of the widening.
    const attrs: Record<string, unknown> = {
      series: SERIES_HEADS[data["series_head"] as string],
      volume: head(data, "volume"),
      edition_status: head(data, "edition_status"),
      updated_in: head(data, "updated_in"),
    };
    if (number !== undefined) attrs["number"] = number;
    if (edition !== undefined) attrs["edition"] = edition;
    return new WmoPublication(attrs);
  }
  return new WmoStandard(
    edition !== undefined ? { number, edition } : { number },
  );
}

let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function wmoGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("wmo");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object" || Array.isArray(bound)) {
        throw new ParseFailed("wmo: the artifact rejected the input", 0);
      }
      return buildWmo(bound as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
