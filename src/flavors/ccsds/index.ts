import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { CcsdsBaseIdentifier, CcsdsCorrigendumIdentifier, CcsdsIdentifier } from "./model.js";

export * from "./model.js";

/**
 * The ccsds parse entry (pubid-ts#178): the grammar runtime is the SAME
 * baked artifact the Ruby flavor runs (pubid-grammar
 * grammars/ccsds.parg -> artifacts/ccsds.json, the bindings carry flat
 * strings), loaded through the artifact runtime, so grammar changes
 * land once and this side cannot drift. The builder mirrors
 * Pubid::Ccsds::Builder: corrigenda fold last-wraps-first onto the
 * base; the update-code line normalizes first (Core::UpdateCodes).
 */

// data/ccsds/update_codes.yaml — pre-parse normalizations (full-line).
const UPDATE_CODE_LINES: Record<string, string> = {
  "CCSDS 320.0-B-1-S Corrigendum 1": "CCSDS 320.0-B-1-S Cor. 1",
};

function applyUpdateCodes(input: string): string {
  return UPDATE_CODE_LINES[input] ?? input;
}

// --- Builder -----------------------------------------------------------------

const s = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const str = String(v);
  return str.length > 0 ? str : undefined;
};

function buildBase(data: Record<string, unknown>): CcsdsBaseIdentifier {
  return new CcsdsBaseIdentifier({
    number: s(data["number"]) ?? "",
    part: s(data["part"]),
    type: s(data["type"]),
    edition: s(data["edition"]),
    suffix: s(data["suffix"]),
    language: s(data["language"]),
  });
}

/** ruby Builder.build: corrigenda fold last-wraps-first onto the base. */
function build(data: Record<string, unknown>): CcsdsIdentifier {
  const corrigenda = data["corrigenda"];
  if (Array.isArray(corrigenda) && corrigenda.length > 0) {
    const base = buildBase({ ...data, corrigenda: undefined });
    return (corrigenda as Record<string, unknown>[]).reduce<CcsdsIdentifier>(
      (current, c) => new CcsdsCorrigendumIdentifier({ base: current, number: s(c["cor_number"]) ?? "" }),
      base,
    );
  }
  return buildBase(data);
}

// --- Implementation ----------------------------------------------------------

let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function ccsdsGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("ccsds");
      const normalized = applyUpdateCodes(input);
      const bound = cachedRuntime.parseAndBind(normalized);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed("ccsds: the artifact rejected the input", 0);
      }
      return build(bound as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
