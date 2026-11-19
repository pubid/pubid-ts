/**
 * Subset match: `subsetMatch(reference, candidate)` — the TypeScript port of
 * Pubid::SubsetMatch (lib/pubid/subset_match.rb), the semantics behind Ruby's
 * `Identifier#===`.
 *
 * The match is true when every part that `reference` states matches
 * `candidate`. A part the reference leaves nil or empty is a wildcard. The
 * operator is NOT symmetric: the receiver is the reference (`ISO 9001` is
 * matched by `ISO 9001:2015`, not the other way round).
 *
 * Rules (see the Ruby module for the normative docs):
 * - Both objects must be of the same concrete class; a reference never falls
 *   back to the base document of a wrapper.
 * - A default value is stated: `ISO 9001` (published stage) does not match
 *   `ISO/DIS 9001`.
 * - A collection matches by position, and the reference may be shorter
 *   (`ISO/IEC 9001` matches `ISO/IEC/IEEE 9001`; `ISO/IEEE 9001` does not).
 * - A STRICT attribute (class `subsetStrict` declaration) is exempt from the
 *   wildcards: the reference always states it, a stated collection must match
 *   in full, and nested matches run in BOTH directions with the class's own
 *   rule. A blank strict attribute still matches a blank candidate (nil≈empty,
 *   the from_hash-dropped-empty tolerance).
 * - An EXACT-BLANK attribute (class `subsetExactBlanks` declaration) goes
 *   further: it compares by ABSOLUTE equality, so even blank-vs-blank must
 *   hold the same value. The bare SYMBOL face (`symbol: ""`, rendered
 *   "…SYMBOL") and the no-symbol face (`symbol` undefined) do not match
 *   either way. This is the mirror of the Ruby per-flavor
 *   `subset_attribute_match?` overrides (lib/pubid/jis/identifier.rb, pubid
 *   main ef8f041c); strict attributes of flavors that do not opt in keep the
 *   blank-blank shortcut.
 * - A reference with `allParts` set skips part/parts/subpart/allParts.
 * - Nested identifiers and components recurse with their own match; every
 *   other value compares with deep scalar equality.
 */
import { BaseIdentifier } from "./identifier.js";
import { Component } from "./component.js";

/** Attributes an all-parts reference does not restrict. */
const ALL_PARTS_ATTRIBUTES = ["part", "parts", "subpart", "allParts"];

interface SubsetMatchable {
  readonly constructor: {
    attributes: Record<string, unknown>;
    subsetStrict?: readonly string[];
    subsetExactBlanks?: readonly string[];
    subsetIgnoredAttributes?: readonly string[];
  };
}

function isSubsetMatchable(v: unknown): v is BaseIdentifier | Component {
  return v instanceof BaseIdentifier || v instanceof Component;
}

/** True for undefined/null and for an empty string or collection. */
function blank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Exact equality for non-identifier values: scalars by identity, plain
 * objects and arrays structurally (Ruby's `==` on the lutaml values).
 */
function scalarEqual(mine: unknown, theirs: unknown): boolean {
  if (mine === theirs) return true;
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    return mine.length === theirs.length && mine.every((v, i) => scalarEqual(v, theirs[i]));
  }
  if (Array.isArray(mine) || Array.isArray(theirs)) return false;
  if (
    mine !== null && theirs !== null &&
    typeof mine === "object" && typeof theirs === "object"
  ) {
    const a = mine as Record<string, unknown>;
    const b = theirs as Record<string, unknown>;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((k) => k in b && scalarEqual(a[k], b[k]));
  }
  return false;
}

/** A shorter reference collection matches the leading elements. */
function collectionMatch(mine: unknown[], theirs: unknown): boolean {
  if (!Array.isArray(theirs)) return false;
  return mine.length <= theirs.length && mine.every((v, i) => valueMatch(v, theirs[i]));
}

/** A strict collection matches in full, never as a prefix. */
function exactCollectionMatch(mine: unknown[], theirs: unknown): boolean {
  if (!Array.isArray(theirs)) return false;
  return mine.length === theirs.length && mine.every((v, i) => exactMatch(v, theirs[i]));
}

/** One attribute: theirs satisfies the reference value mine. */
export function valueMatch(mine: unknown, theirs: unknown): boolean {
  if (blank(mine)) return true;
  if (Array.isArray(mine)) return collectionMatch(mine, theirs);
  if (isSubsetMatchable(mine)) return subsetMatch(mine, theirs);
  return scalarEqual(mine, theirs);
}

/** Strict attributes compare exactly, composing nested matches both ways. */
export function exactMatch(mine: unknown, theirs: unknown): boolean {
  if (blank(mine) && blank(theirs)) return true;
  if (Array.isArray(mine)) return exactCollectionMatch(mine, theirs);
  if (isSubsetMatchable(mine)) {
    return subsetMatch(mine, theirs) && isSubsetMatchable(theirs) && subsetMatch(theirs, mine);
  }
  return scalarEqual(mine, theirs);
}

/**
 * An EXACT-BLANK attribute is stated even when blank: the two faces are
 * compared by absolute equality, blank-vs-blank included. This is the
 * per-class mirror of the Ruby flavor's `subset_attribute_match?` override
 * (the JIS symbol law: the bare SYMBOL face and no symbol are distinct
 * states of a two-valued attribute — pubid main ef8f041c). `exactMatch`
 * keeps its blank-blank shortcut for the strict attributes that rely on
 * the from_hash-dropped-empty tolerance.
 */
function exactBlankMatch(mine: unknown, theirs: unknown): boolean {
  return scalarEqual(mine, theirs);
}

/**
 * True when `candidate` holds every part that `reference` states. Both must
 * be identifiers or components of the same concrete class.
 */
export function subsetMatch(reference: BaseIdentifier | Component, candidate: unknown): boolean {
  if (reference === candidate) return true;
  if (!(candidate instanceof reference.constructor)) return false;

  const ctor = reference.constructor as unknown as {
    attributes: Record<string, unknown>;
    subsetStrict?: readonly string[];
    /** Names compared by absolute equality, blank-vs-blank included
     * (the per-flavor mirror of Ruby's `subset_attribute_match?`
     * overrides). */
    subsetExactBlanks?: readonly string[];
    subsetIgnoredAttributes?: readonly string[];
    /** Names compared by the match but kept out of the attribute table
     * (state that toHash must not emit — the typed-stage default). */
    subsetAttributes?: readonly string[];
  };
  // Components (and any class without a declared attribute table) match
  // conservatively: equal serialized forms. A component that wants the
  // wildcard/strict rules declares a `static attributes` table.
  if (!ctor.attributes || typeof ctor.attributes !== "object") {
    const a = (reference as { toWire?: () => unknown }).toWire?.() ?? null;
    const b = (candidate as { toWire?: () => unknown } | null | undefined)?.toWire?.() ?? null;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  const strict = new Set(ctor.subsetStrict ?? []);
  const exactBlanks = new Set(ctor.subsetExactBlanks ?? []);
  const ignored = new Set([
    ...(ctor.subsetIgnoredAttributes ?? []),
    // Ruby SubsetMatch#subset_skipped_attributes also skips every
    // `equality_ignored` attribute ("skipped, as == and hash skip it") —
    // jis's language_before_year, eu's number_first (the print ORDER of
    // the two numbers is spelling, so "EU Decision 1082/2013" ===
    // 32013D1082).
    ...Object.entries(ctor.attributes)
      .filter(([, spec]) =>
        (spec as { equalityIgnored?: boolean } | undefined)?.equalityIgnored === true)
      .map(([name]) => name),
    ...((reference as unknown as { subsetAllPartsWildcard?: () => boolean }).subsetAllPartsWildcard?.()
      ? ALL_PARTS_ATTRIBUTES
      : []),
  ]);

  const names = [...Object.keys(ctor.attributes), ...(ctor.subsetAttributes ?? [])];
  return names.every((name) => {
    if (ignored.has(name)) return true;
    const mine = (reference as unknown as Record<string, unknown>)[name];
    const theirs = (candidate as unknown as Record<string, unknown>)[name];
    // Exact-blank names route before the strict rule: their blanks are
    // distinct values, not the nil≈empty tolerance.
    if (exactBlanks.has(name)) return exactBlankMatch(mine, theirs);
    if (strict.has(name)) return exactMatch(mine, theirs);
    return valueMatch(mine, theirs);
  });
}
