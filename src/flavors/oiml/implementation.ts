import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import { oimlGrammar } from "./grammar.js";
import {
  buildOimlIdentifier,
  fromHash,
  toHash,
  toHuman,
  toUrn,
  type OimlIdentifier,
} from "./model.js";

class GrammarIdentifier implements Identifier {
  constructor(private readonly id: OimlIdentifier) {}

  toHash(): Record<string, unknown> {
    return toHash(this.id);
  }

  toHuman(): string {
    return toHuman(this.id);
  }

  toUrn(): string | undefined {
    return toUrn(this.id);
  }

  fromHash(hash: Record<string, unknown>): Identifier {
    return new GrammarIdentifier(fromHash(hash));
  }
}

/**
 * Grammar-backed OIML: the parslet grammar ported 1:1 from
 * lib/pubid/oiml/parser.rb, the builder from builder.rb, the renderer
 * from renderer.rb and the URN generator from urn_generator.rb. Wave 1
 * replaces corpus mode for this flavor; the conformance gate enforces
 * parity with the corpus (canonical hash, human form, URN, deserialize).
 */
export function oimlGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(oimlGrammar, input);
      return new GrammarIdentifier(buildOimlIdentifier(tree));
    },
  };
}

export { ParseFailed };
