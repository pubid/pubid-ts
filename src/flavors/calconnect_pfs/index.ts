import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { PubidDate } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * The PFS-compiled calconnect flavor (pubid/pubid#706 §8) — one
 * definition file, both engines: the grammar runtime is the SAME baked
 * artifact the Ruby flavor runs (pubid-grammar
 * artifacts/calconnect_pfs.json, compiled from definitions/calconnect.pfs),
 * loaded through the artifact runtime, so grammar changes land once and
 * this side cannot drift. Nothing is hand-rolled: the model is declared
 * attributes on the unified model (serialization derives from
 * BaseIdentifier), the publication date folds into the shared
 * PubidDate exactly as the definition's `date: fields:` declares, and
 * the render body is the definition's canonical template. The parity
 * gate (test/calconnect-pfs-parity.test.ts) pins byte-identity with the
 * coded {@linkcode import("../calconnect").CalconnectIdentifier} over
 * the shared conformance set.
 */

/** The official URN: the definition's urn.official segments
 * (urn:calconnect[:<series>]:<number>[:<date>]) — an absent field
 * leaves no segment, the date group renders year[-month[-day]]. */
class CalconnectPfsUrnGenerator extends BaseUrnGenerator<CalconnectPfsIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "calconnect"];
    if (id.series !== undefined) parts.push(id.series);
    parts.push(id.number);
    const date = id.date?.render();
    if (date !== undefined && date !== "") parts.push(date);
    return parts.join(":");
  }
}

export class CalconnectPfsIdentifier extends BaseIdentifier {
  /**
   * The SCHEME-canonical wire tag (declared in the definition): to_hash
   * is byte-identical with the coded flavor. Deliberately NOT registered
   * in the global type map — one scheme, one `_type`, one global
   * resolution (the coded class); {@linkcode fromHash} routes the tag
   * back here flavor-locally, mirroring Ruby's CC_TYPE_MAP.
   */
  static polymorphicName = "pubid:calconnect:standard";
  static attributes = extendAttributes(BaseIdentifier, {
    series: { type: "string" },
    number: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "series", to: "series" },
    { wire: "number", to: "number" },
    {
      wire: "year",
      to: "date",
      toWire: (m) => (m["date"] as PubidDate | undefined)?.year,
      fromWire: (h) =>
        h["year"] === undefined || h["year"] === null
          ? undefined
          : new PubidDate({
              year: String(h["year"]),
              month: h["month"] as string | undefined,
              day: h["day"] as string | undefined,
            }),
    },
    { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
    { wire: "day", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.day, fromWire: () => undefined },
  );
  static urnGenerator = CalconnectPfsUrnGenerator;

  declare readonly series: string | undefined;
  declare readonly number: string;
  declare readonly date: PubidDate | undefined;

  /** The definition's canonical face: CC["/" series]" " number
   *  [":" year["-" month"-" day]] — every optional renders only what
   *  the input carried. */
  render(): string {
    const prefix = this.series === undefined ? "CC " : `CC/${this.series} `;
    const date = this.date?.render();
    return `${prefix}${this.number}${date === undefined || date === "" ? "" : `:${date}`}`;
  }

  /** The alias's own from_hash: the scheme tag routes HERE, while the
   *  global resolution keeps answering the coded class (coexistence, not
   *  cutover). */
  static fromHash(hash: Record<string, unknown>): BaseIdentifier {
    return new CalconnectPfsIdentifier(
      this.applyMappings(this.inflateScalarComponents(hash)),
    );
  }
}

/**
 * The artifact's declared bindings (series/number/year/month/day, flat
 * string captures) carry the parsed faces; the year/month/day trio
 * folds into the shared PubidDate — the definition's calendar binding,
 * the same fold the coded flavor's builder performs — so the bound map
 * lands on the model fields directly.
 */
let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function calconnectPfsGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("calconnect_pfs");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed(
          "calconnect_pfs: the artifact rejected the input",
          0,
        );
      }
      const flat = bound as Record<string, unknown>;
      const attrs: Record<string, unknown> = {};
      if (flat["series"] !== undefined && flat["series"] !== null) {
        attrs["series"] = String(flat["series"]);
      }
      if (flat["number"] === undefined || flat["number"] === null) {
        throw new ParseFailed("CalConnect: no number", 0);
      }
      attrs["number"] = String(flat["number"]);
      if (flat["year"] !== undefined && flat["year"] !== null) {
        attrs["date"] = new PubidDate({
          year: String(flat["year"]),
          month:
            flat["month"] === undefined || flat["month"] === null
              ? undefined
              : String(flat["month"]),
          day:
            flat["day"] === undefined || flat["day"] === null
              ? undefined
              : String(flat["day"]),
        });
      }
      return new CalconnectPfsIdentifier(attrs) as unknown as Identifier;
    },
  };
}
