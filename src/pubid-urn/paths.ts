/**
 * Reads and writes a dotted key path ("edition.number",
 * "languages.*.code") in an identifier hash — the TS mirror of
 * Pubid::PubidUrn::Paths (lib/pubid/pubid_urn/paths.rb).
 *
 * `take` removes what it reads, so after every core path, atom and facet
 * has been taken, anything left in the node is a key that the schema
 * does not place — the encoder refuses it rather than drop it silently.
 *
 * A degenerate component may serialize as a bare scalar ("edition" =>
 * "2" rather than {"number" => "2"}, see FLAT_SCALAR_FIELDS). Where a
 * path expects a Hash and finds a scalar, the scalar IS the value of
 * the path. `put` always writes the nested form, which fromHash reads
 * as well, so the rebuilt identifier serializes alike.
 *
 * ruby nil is the JS null/undefined pair: the corpus wire form is JSON,
 * where a nil attribute arrives as null; isNil() is the shared test.
 */

export function isNil(value: unknown): boolean {
  return value === undefined || value === null;
}

/** @return the value, or null (ruby nil) when the path is absent. */
export function take(container: Record<string, unknown>, parts: string[]): unknown {
  if (container === null || typeof container !== "object" || Array.isArray(container)) {
    return null;
  }
  const key = parts[0] as string;
  if (!Object.hasOwn(container, key)) return null;

  const rest = parts.slice(1);
  const value = container[key];
  if (rest.length === 0) {
    delete container[key];
    return value;
  }
  if (rest[0] === "*") {
    return takeElements(container, key, value, rest.slice(1));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return take(value as Record<string, unknown>, rest);
  }
  if (rest.length === 1) {
    delete container[key];
    return value;
  }
  return null;
}

function takeElements(
  container: Record<string, unknown>,
  key: string,
  value: unknown,
  rest: string[],
): unknown {
  if (!Array.isArray(value)) return null;
  if (rest.length === 0) {
    delete container[key];
    return value;
  }
  const values = value.map((element, i) => {
    if (element !== null && typeof element === "object" && !Array.isArray(element)) {
      return take(element as Record<string, unknown>, rest);
    }
    if (rest.length === 1 && element !== null && element !== undefined) {
      value[i] = {};
      return element;
    }
    return null;
  });
  return values.every((v) => v === null) ? null : values;
}

/** Write `value` (null writes nothing). */
export function put(container: Record<string, unknown>, parts: string[], value: unknown): void {
  if (value === undefined || value === null) return;

  const key = parts[0] as string;
  const rest = parts.slice(1);
  if (rest.length === 0) {
    container[key] = value;
  } else if (rest[0] === "*") {
    putElements(container, key, value, rest.slice(1));
  } else {
    let nested = container[key] as Record<string, unknown> | undefined;
    if (nested === undefined || nested === null) {
      nested = {};
      container[key] = nested;
    }
    put(nested, rest, value);
  }
}

function putElements(
  container: Record<string, unknown>,
  key: string,
  values: unknown,
  rest: string[],
): void {
  if (rest.length === 0) {
    container[key] = values;
    return;
  }
  let elements = container[key] as Record<string, unknown>[] | undefined;
  if (elements === undefined || elements === null || !Array.isArray(elements)) {
    elements = [];
    container[key] = elements;
  }
  (values as unknown[]).forEach((value, i) => {
    if (value === undefined || value === null) return;
    let element = elements[i];
    if (element === undefined || element === null || typeof element !== "object" || Array.isArray(element)) {
      element = {};
      elements[i] = element;
    }
    put(element, rest, value);
  });
}

/** True when nothing but empty containers is left. */
export function blank(value: unknown): boolean {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value).every((v) => blank(v));
  }
  if (Array.isArray(value)) {
    return value.every((v) => blank(v));
  }
  return false;
}

export function deepDup(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) return value.map((v) => deepDup(v));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepDup(v);
    return out;
  }
  return value;
}
