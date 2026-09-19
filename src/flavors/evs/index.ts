import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { evsGrammar } from "./grammar.js";
import { buildCenIdentifier } from "../cen_cenelec/index.js";
import { NationalAdoption } from "./model.js";

/**
 * Port of lib/pubid/evs/builder.rb — the :adopted subtree (from the
 * embedded CEN grammar) goes to the CEN/CENELEC builder as data.
 */

function buildIdentifier(tree: Tree): Identifier {
  const d = Array.isArray(tree)
    ? (Object.assign({}, ...tree) as TreeObject)
    : (tree as TreeObject);
  const separator = d["evs_separator"] !== undefined ? String(d["evs_separator"]) : "-";
  const base = buildCenIdentifier(d["adopted"] as Tree);
  return new NationalAdoption({ base, separator }) as unknown as Identifier;
}

export function evsGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(evsGrammar, input);
      return buildIdentifier(tree);
    },
  };
}
