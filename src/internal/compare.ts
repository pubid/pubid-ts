/** Canonical JSON key order: the comparison basis for hash records. */
export function canonicalKey(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalKey(a) === canonicalKey(b);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}
