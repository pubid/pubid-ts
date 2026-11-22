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
 * map serves all three types and the dispatch keys off `annex_marker`
 * and `wmomarker`.
 */

function buildWmo(data: Record<string, unknown>): WmoIdentifier {
  const number = data["doc_number"] === undefined ? undefined : String(data["doc_number"]);
  const edition = data["edition_value"] === undefined ? undefined : String(data["edition_value"]);
  const annexMarker = data["annex_marker"] === undefined ? undefined : String(data["annex_marker"]);
  const annexLetter = data["annex_letter"] === undefined ? undefined : String(data["annex_letter"]);

  if (annexMarker !== undefined) {
    const attrs: Record<string, unknown> = {
      base: new WmoStandard({ number }),
      annex_form: annexMarker,
    };
    if (annexLetter !== undefined) attrs["letter"] = annexLetter;
    if (edition !== undefined) attrs["edition"] = edition;
    return new WmoAnnex(attrs);
  }
  if (data["wmomarker"] !== undefined) {
    return new WmoPublication(
      edition !== undefined ? { number, edition } : { number },
    );
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
