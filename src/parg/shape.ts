//! The pure artifact-shape helpers shared by every artifact-backed
//! flavor and by the worker entries. No node import may appear here:
//! these run inside the worker-safe graphs (pubid/pubid-ts#232).

/**
 * The artifact emits capture leaves ({value, line, column, offset,
 * length}) and a top-level sequence of capture hashes. This mirrors the
 * gem's Pubid::Parg::Backend.to_builder_hash: scalarize leaves, fold the
 * top-level list into one hash (last key wins — parslet's sequence fold).
 */
export function toBuilderTree(shape: unknown): unknown {
  const normalized = normalizeShape(shape);
  if (Array.isArray(normalized) &&
      normalized.length > 0 &&
      normalized.every((n) => typeof n === "object" && n !== null && !Array.isArray(n))) {
    return Object.assign({}, ...normalized as Record<string, unknown>[]);
  }
  return normalized;
}

/**
 * Strip the shape metadata an artifact parse carries (offset/line/column
 * wrappers) down to the plain string/array capture tree the builders
 * consume — the same tree shape the hand-written grammars produced.
 */
export function normalizeShape(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeShape);
  if (typeof node === "object" && node !== null) {
    const rec = node as Record<string, unknown>;
    if (typeof rec["value"] === "string" && Object.keys(rec).length >= 1 &&
        "offset" in rec) {
      return rec["value"];
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = normalizeShape(v);
    return out;
  }
  return node;
}
