import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";

/**
 * The PFS-compiled doi flavor (pubid/pubid#706 §2.2) — one definition
 * file, both engines: the grammar runtime is the SAME baked artifact the
 * Ruby flavor runs (pubid-grammar artifacts/doi_pfs.json, compiled from
 * definitions/doi.pfs), loaded through the artifact runtime, so grammar
 * changes land once and this side cannot drift. Nothing is hand-rolled:
 * the model is declared attributes (serialization derives from
 * BaseIdentifier), the builder is the shared one, and the render body is
 * the definition's canonical template. The parity gate
 * (test/doi-pfs-parity.test.ts) pins byte-identity with the coded
 * {@linkcode import("../doi").DoiIdentifier} over the shared conformance
 * set.
 */

export class DoiPfsIdentifier extends BaseIdentifier {
  /**
   * The SCHEME-canonical wire tag (declared in the definition): to_hash
   * is byte-identical with the coded flavor. Deliberately NOT registered
   * in the global type map — one scheme, one `_type`, one global
   * resolution (the coded class); {@linkcode fromHash} routes the tag
   * back here flavor-locally, mirroring Ruby's DOI_TYPE_MAP.
   */
  static polymorphicName = "pubid:doi:resource";
  static attributes = extendAttributes(BaseIdentifier, {
    prefix: { type: "string" },
    suffix: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "prefix", to: "prefix" },
    { wire: "suffix", to: "suffix" },
  );

  render(): string {
    return `doi:${this.prefix}/${this.suffix}`;
  }

  declare readonly prefix: string;
  declare readonly suffix: string;

  /** The alias's own from_hash: the scheme tag routes HERE, while the
   *  global resolution keeps answering the coded class (coexistence, not
   *  cutover). */
  static fromHash(hash: Record<string, unknown>): BaseIdentifier {
    return new DoiPfsIdentifier(
      this.applyMappings(this.inflateScalarComponents(hash)),
    );
  }
}

/**
 * The artifact's declared bindings (prefix -> prefix, suffix -> suffix)
 * carry the whole printed prefix face ("10.1000") — the doi.pfs pattern
 * captures the "10." face the coded grammar re-assembles — so the bound
 * map lands on the model fields directly, no builder cast.
 */
let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function doiPfsGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("doi_pfs");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed("doi_pfs: the artifact rejected the input", 0);
      }
      const identifier = new DoiPfsIdentifier(bound as Record<string, unknown>);
      return identifier as unknown as Identifier;
    },
  };
}
