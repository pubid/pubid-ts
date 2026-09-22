import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import { oimlGrammar } from "./grammar.js";
import { buildOimlIdentifier, OimlDualPublished } from "./model.js";
import type { BaseIdentifier } from "../../model/identifier.js";
import { grammarImplementation } from "../index.js";

// The co-publisher prefix (only ISO confirmed so far; the gem routes via
// Pubid.parse's prefix table).
function flavorOf(input: string): string {
  return input.toUpperCase().startsWith("ISO ") ? "iso" : "iso";
}

/**
 * Grammar-backed OIML on the unified model: the model classes are
 * BaseIdentifier subclasses, so they satisfy the Identifier adapter
 * directly (toHash/toHuman/toUrn/fromHash come from the model).
 */
export function oimlGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      // The co-published form carries both identifiers joined by "|":
      // "ISO 4064-1:2024|OIML R 49-1:2024". The first side is another
      // flavor's identifier (routed by prefix, the Ruby Pubid.parse
      // counterpart); the second is the OIML side.
      if (input.includes("|") && !input.startsWith("|") && !input.endsWith("|")) {
        // Each side may be either flavor ("ISO …|OIML R …" and the
        // reversed print): the OIML side parses through this grammar, the
        // co-publisher's through its own (routed by prefix).
        const parts = input.split("|");
        const members = parts.map((part) => {
          const s = part.trim();
          if (s.toUpperCase().startsWith("OIML")) {
            return buildOimlIdentifier(parseGrammar(oimlGrammar, s)) as unknown as BaseIdentifier;
          }
          const impl = grammarImplementation(flavorOf(s));
          if (impl === undefined) throw new ParseFailed(`OIML: no flavor for ${s}`, 0);
          return impl.parse(s) as unknown as BaseIdentifier;
        });
        if (members.length === 2 && members[0] !== undefined && members[1] !== undefined) {
          return new OimlDualPublished({ first: members[0], second: members[1] }) as unknown as Identifier;
        }
      }
      return buildOimlIdentifier(parseGrammar(oimlGrammar, input)) as unknown as Identifier;
    },
  };
}

export { ParseFailed };
