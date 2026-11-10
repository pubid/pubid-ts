/**
 * The slug form (relaton#441): the URN wearing HTTP-path clothes — the
 * TS mirror of Pubid::PubidUrn.to_slug/from_slug.
 *
 * Each ":" segment becomes a "/" segment, after the "urn:pubid:" prefix
 * is cut — "urn:pubid:iso:is:9001:year-2015" is "iso/is/9001/year-2015".
 * The contract's path-safety gate guarantees no segment carries a "/",
 * so the transform is bijective: {@linkcode fromSlug} rebuilds the exact
 * URN. The flat form is the flat `/`-joined string, fit for filenames.
 */

import { PREFIX, generate, parse } from "./index.js";
import { InvalidInputError, UrnParseError } from "./errors.js";
import { MAX_LENGTH } from "./index.js";
import type { BaseIdentifier } from "../model/identifier.js";

/** The slug of an identifier or of its pubid-scheme URN, with no leading
 *  or trailing "/". A String input must be a canonical pubid-scheme URN.
 *  @raise UrnParseError when a String is not a canonical pubid-scheme URN. */
export function toSlug(source: BaseIdentifier | string): string {
  let urn: string;
  if (typeof source === "string") {
    parse(source);
    urn = source;
  } else if (source !== null && typeof source === "object" && typeof source.toHash === "function") {
    urn = generate(source.toHash());
  } else {
    throw new InvalidInputError(
      "to_slug takes an identifier or a pubid-scheme URN string",
    );
  }
  return urn.slice(PREFIX.length).replaceAll(":", "/");
}

/** The slug parse side: "/"-joined segments rebuild the URN and parse
 *  through the canonical gate, so a slug of a landed flavor round-trips
 *  by toHash exactly like its URN.
 *  @raise UrnParseError for a malformed, unknown or non-canonical slug. */
export function fromSlug(slug: string): BaseIdentifier {
  if (typeof slug !== "string") {
    throw new InvalidInputError("input is not a String");
  }
  if (slug.length > MAX_LENGTH) {
    throw new InvalidInputError(`slug exceeds ${MAX_LENGTH} characters`);
  }
  // ruby split("/", -1): trailing separators make empty segments too.
  if (slug.split("/").some((segment) => segment === "")) {
    throw new UrnParseError("slug has empty segments");
  }
  return parse(PREFIX + slug.replaceAll("/", ":"));
}
