import { normalizeShape } from "../../parg/runtime.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";

/**
 * The baked PARG artifact's parse shape → the builder tree. The
 * artifact (the gem's own runtime grammar) differs from the hand
 * mirror in three enumerable ways:
 *
 * - a sequence binds as a top-level Array of capture hashes — folded
 *   into one hash (last key wins), the reference's to_builder_hash;
 * - zero-width alternative branches bind null-valued keys; the hand
 *   tree omits them;
 * - `part`/`subpart` capture their separator (".18", "-10") — kept,
 *   the builder joins code captures verbatim exactly like the
 *   reference's extract_attributes.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function artifactToBuilderTree(shape: unknown): Tree {
  const normalized = normalizeShape(shape);
  const folded = Array.isArray(normalized) && normalized.length > 0 &&
      normalized.every((n) => isObj(n))
    ? Object.assign({}, ...(normalized as Record<string, unknown>[]))
    : normalized;
  return convert(folded) as Tree;
}

function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (!isObj(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (v === null) continue;
    out[k] = convert(v);
  }
  return out;
}
