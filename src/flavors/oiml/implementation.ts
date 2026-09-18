import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import { oimlGrammar } from "./grammar.js";
import { buildOimlIdentifier } from "./model.js";

/**
 * Grammar-backed OIML on the unified model: the model classes are
 * BaseIdentifier subclasses, so they satisfy the Identifier adapter
 * directly (toHash/toHuman/toUrn/fromHash come from the model).
 */
export function oimlGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return buildOimlIdentifier(parseGrammar(oimlGrammar, input)) as unknown as Identifier;
    },
  };
}

export { ParseFailed };
