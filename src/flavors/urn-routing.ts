import type { FlavorImplementation, Identifier } from "../conformance/implementation.js";
import { lookupUrnParser, parseUrnFor } from "../urn/parsers.js";

/**
 * The barrel's URN wrapper, on its own so an entry that serves one flavor
 * (src/flavors/<flavor>/worker.ts) wraps the same way without importing
 * the whole grammar barrel.
 *
 * "urn:" inputs route to the flavor's URN parser where the reference
 * implements one (impl.parseUrn or the registry in src/urn/parsers.ts
 * mirroring lib/pubid/<flavor>/urn_parser.rb); flavors without one whose
 * own grammar accepts URN spellings keep parsing them natively
 * (pubid/pubid-ts#1).
 */
export function withUrnRouting(flavor: string, impl: FlavorImplementation): FlavorImplementation {
  const urnDef = lookupUrnParser(flavor);
  if (impl.parseUrn === undefined && urnDef === undefined) return impl;
  return {
    parse(input: string): Identifier {
      if (/^urn:/i.test(input)) {
        if (impl.parseUrn) return impl.parseUrn(input);
        return parseUrnFor(urnDef!, input, impl.parse);
      }
      return impl.parse(input);
    },
    ...(impl.parseUrn
      ? { parseUrn: impl.parseUrn }
      : { parseUrn: (urn: string) => parseUrnFor(urnDef!, urn, impl.parse) }),
  };
}
