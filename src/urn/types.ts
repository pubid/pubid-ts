import type { Identifier } from "../conformance/implementation.js";

// Per-flavor URN ingestion, mirroring lib/pubid/<flavor>/urn_parser.rb.
// Each entry: the URN namespace the flavor's UrnGenerator emits (the
// `flavor_name` of the gem parser) and the reconstruction — rebuild the
// human text from the URN parts and re-parse, exactly as the reference
// does, including its lossiness.
export type UrnParserDef = {
  /** Full URN prefix including the trailing colon
   *  (gem UrnParser PREFIX / "urn:" + flavor_name + ":"). */
  prefix: string;
  /** Rebuild the human text (or parse directly) from the URN body. */
  reconstruct: (body: string, parse: (text: string) => Identifier) => Identifier;
};

/** Split the body on ":" (gem Base#split_parts). */
export function splitParts(body: string): string[] {
  return body.split(":");
}

/** Reconstruct "<TEXT>:<year>" (the common trailing-year shape). */
export function withYear(text: string, year: string | undefined): string {
  return year ? `${text}:${year}` : text;
}
