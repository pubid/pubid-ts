import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * The PFS-compiled etsi flavor (pubid/pubid#706 phase 3) — one
 * definition file, both engines: the grammar runtime is the SAME baked
 * artifact the Ruby flavor runs (pubid-grammar artifacts/etsi_pfs.json,
 * compiled from definitions/etsi.pfs by the compiler v2), loaded through
 * the artifact runtime, so grammar changes land once and this side
 * cannot drift. Nothing is hand-rolled: the model is declared attributes
 * on the unified model (serialization derives from BaseIdentifier), the
 * ed.N face folds onto version + is_edition exactly as the definition's
 * fold declares, and the render body is the definition's canonical
 * template with presence-guarded optionals and the /A//C run. The
 * supplement wrappers are the compiled classes the definition's
 * supplements declaration synthesizes ({number, base}, outermost last).
 * The parity gate (test/etsi-pfs-parity.test.ts) pins byte-identity with
 * the coded {@linkcode import("../etsi").EtsiIdentifier} over the shared
 * conformance set (the full 24,718-row inventory).
 */

/** The official URN: the definition's urn.official segments —
 * urn:etsi[:<type>][:<composed code>][:<version face>][:<date>]; a
 * supplement wrapper reads through to the wrapped standard, an absent
 * field leaves no segment, the fold's target switches to the edition
 * affix while the flag holds, and the date group joins year-month. */
class EtsiPfsUrnGenerator extends BaseUrnGenerator<EtsiPfsIdentifier> {
  generate(): string {
    const subject = this.identifier.standardSubject();
    const parts = ["urn", "etsi"];
    if (subject.type !== undefined) parts.push(subject.type.toLowerCase());
    const code: string[] = [];
    if (subject.number !== undefined) code.push(subject.number);
    if (subject.minor !== undefined) code.push(` ${subject.minor}`);
    if (subject.parts !== undefined && subject.parts.length > 0) {
      code.push(...subject.parts.map((item) => `-${item}`));
    }
    const composed = code.join("");
    if (composed !== "") parts.push(composed);
    if (subject.is_edition) {
      parts.push(`ed.${(subject.version ?? "").toLowerCase()}`);
    } else if (subject.version !== undefined) {
      parts.push(`v${subject.version.toLowerCase()}`);
    }
    const date = [subject.year, subject.month].filter((v) => v !== undefined);
    if (date.length > 0) parts.push(date.join("-"));
    return parts.join(":");
  }
}

/**
 * The compiled flavor's identifier base: the shared render machinery and
 * the FLAVOR-LOCAL type dispatch. The concrete classes carry the scheme's
 * canonical wire tags (pubid:etsi:…), which deliberately stay OUT of the
 * global type map — one scheme, one `_type`, one global resolution (the
 * coded class); {@linkcode fromHash} routes the tags back here
 * flavor-locally, mirroring Ruby's Pubid::EtsiPfs::Identifier.from_hash
 * (a bare polymorphic cast would rebuild the plain Base and lose the
 * concrete subclass — the tags must NOT dispatch through the registry).
 */
export abstract class EtsiPfsIdentifier extends BaseIdentifier {
  /** The wire tags the compiled classes answer, resolved flavor-locally. */
  static localTypeMap = new Map<string, new (attrs?: Record<string, unknown>) => EtsiPfsIdentifier>();

  declare readonly type: string | undefined;
  declare readonly number: string | undefined;
  declare readonly minor: string | undefined;
  declare readonly parts: string[] | undefined;
  declare readonly version: string | undefined;
  declare readonly year: string | undefined;
  declare readonly month: string | undefined;
  declare readonly is_edition: boolean | undefined;
  declare readonly base: EtsiPfsIdentifier | undefined;

  /** A wrapper reads through to the wrapped standard (the compiled
   * generator's subject). */
  standardSubject(): EtsiPfsIdentifier {
    let current: EtsiPfsIdentifier = this;
    while (current.base !== undefined) current = current.base;
    return current;
  }

  /** The printed supplement run ("/A1/C1", the base outward), empty on a
   * standard row. */
  supplementRun(): string {
    let run = "";
    let current: EtsiPfsIdentifier = this;
    while (current.base !== undefined) {
      run = `/${current.supplementFace()}${current.number}${run}`;
      current = current.base;
    }
    return run;
  }

  /** The kind face ("A"/"C") — wrappers only; never called on a standard. */
  protected supplementFace(): string {
    return "";
  }

  /** The definition's canonical face: ETSI <type> <number>[ <minor>][-<parts>]
   *  [<supplement run>] [<V<version>|ed.<version>] [(<year>-<month>)] — every
   *  optional renders only what the input carried. */
  render(): string {
    const root = this.standardSubject();
    let result = `ETSI ${root.type} ${root.number}`;
    if (root.minor !== undefined) result += ` ${root.minor}`;
    if (root.parts !== undefined && root.parts.length > 0) {
      result += root.parts.map((item) => `-${item}`).join("");
    }
    result += this.supplementRun();
    if (root.is_edition) {
      result += ` ed.${root.version}`;
    } else if (root.version !== undefined) {
      result += ` V${root.version}`;
    }
    if (root.year !== undefined && root.month !== undefined) {
      result += ` (${root.year}-${root.month})`;
    }
    return result;
  }

  /** The alias's own from_hash: the scheme tags route HERE, while the
   *  global resolution keeps answering the coded class (coexistence, not
   *  cutover). */
  static fromHash(hash: Record<string, unknown>): BaseIdentifier {
    const tag = typeof hash["_type"] === "string" ? hash["_type"] : undefined;
    const klass = tag !== undefined ? this.localTypeMap.get(tag) : undefined;
    const target = (klass ?? this) as unknown as IdentifierStatic & {
      applyMappings(data: Record<string, unknown>): Record<string, unknown>;
      inflateScalarComponents(data: Record<string, unknown>): Record<string, unknown>;
    };
    return new target(
      target.applyMappings(target.inflateScalarComponents(hash)),
    ) as unknown as BaseIdentifier;
  }
}

export class EtsiPfsStandardIdentifier extends EtsiPfsIdentifier {
  /**
   * The SCHEME-canonical wire tag (declared in the definition): to_hash
   * is byte-identical with the coded flavor. Deliberately NOT registered
   * in the global type map.
   */
  static polymorphicName = "pubid:etsi:etsi-standard";
  static attributes = extendAttributes(BaseIdentifier, {
    type: { type: "string" },
    number: { type: "string" },
    minor: { type: "string" },
    parts: { type: "string", collection: true, initializeEmpty: true },
    version: { type: "string" },
    year: { type: "string" },
    month: { type: "string" },
    is_edition: { type: "boolean", default: false },
  });
  static mappings = keyValue(
    { wire: "type", to: "type" },
    { wire: "number", to: "number" },
    { wire: "minor", to: "minor" },
    { wire: "parts", to: "parts" },
    { wire: "version", to: "version" },
    { wire: "year", to: "year" },
    { wire: "month", to: "month" },
    { wire: "is_edition", to: "is_edition" },
  );
  static urnGenerator = EtsiPfsUrnGenerator;
}

/** The supplement wrapper base: the wrapper owns its ordinal and the base
 *  identifier; the hash carries only _type, number, base (the base collapses
 *  to the leaf standard shape) and every rendered face reads through. */
abstract class EtsiPfsSupplementIdentifier extends EtsiPfsIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    base: { type: EtsiPfsIdentifier as unknown as IdentifierStatic },
    number: { type: "integer" },
  });
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "base", to: "base" },
  );
  static urnGenerator = EtsiPfsUrnGenerator;
}

export class EtsiPfsAmendmentIdentifier extends EtsiPfsSupplementIdentifier {
  /** The kind face "A" is the run's dispatch token and the notation face. */
  static polymorphicName = "pubid:etsi:amendment";
  static FACE = "A";

  protected supplementFace(): string {
    return EtsiPfsAmendmentIdentifier.FACE;
  }
}
EtsiPfsIdentifier.localTypeMap.set(
  EtsiPfsAmendmentIdentifier.polymorphicName,
  EtsiPfsAmendmentIdentifier,
);

export class EtsiPfsCorrigendumIdentifier extends EtsiPfsSupplementIdentifier {
  /** The kind face "C" is the run's dispatch token and the notation face. */
  static polymorphicName = "pubid:etsi:corrigendum";
  static FACE = "C";

  protected supplementFace(): string {
    return EtsiPfsCorrigendumIdentifier.FACE;
  }
}
EtsiPfsIdentifier.localTypeMap.set(
  EtsiPfsCorrigendumIdentifier.polymorphicName,
  EtsiPfsCorrigendumIdentifier,
);
EtsiPfsIdentifier.localTypeMap.set(
  EtsiPfsStandardIdentifier.polymorphicName,
  EtsiPfsStandardIdentifier,
);

/**
 * The artifact's declared bindings carry the parsed faces: the flat
 * columns land on the model fields, the ed.N capture folds onto version +
 * is_edition (the definition's fold), the parts list binds its item per
 * repetition, and the supplement run folds into the synthesized wrapper
 * chain ({number, base}, outermost last) — the same fold the Ruby builder
 * performs.
 */
let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

/** A raw capture leaf ({value, line, …}) yields its value; a bound scalar
 *  passes through (the run's internal captures bind only through the item
 *  row, so unbound ones arrive as raw leaves). */
function unwrap(capture: unknown): unknown {
  if (typeof capture === "object" && capture !== null && "value" in capture) {
    return (capture as Record<string, unknown>)["value"];
  }
  return capture;
}

export function etsiPfsGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("etsi_pfs");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object") {
        throw new ParseFailed("etsi_pfs: the artifact rejected the input", 0);
      }
      const flat = bound as Record<string, unknown>;
      const attrs: Record<string, unknown> = {};
      if (flat["type"] === undefined || flat["type"] === null) {
        throw new ParseFailed("ETSI: no type", 0);
      }
      attrs["type"] = String(flat["type"]);
      if (flat["number"] === undefined || flat["number"] === null) {
        throw new ParseFailed("ETSI: no number", 0);
      }
      attrs["number"] = String(flat["number"]);
      if (flat["minor"] !== undefined && flat["minor"] !== null) {
        attrs["minor"] = String(flat["minor"]);
      }
      if (flat["parts"] !== undefined && flat["parts"] !== null) {
        const rows = Array.isArray(flat["parts"]) ? flat["parts"] : [flat["parts"]];
        const items = rows
          .map((row) => unwrap((row as Record<string, unknown>)?.["part"]))
          .filter((item) => item !== undefined && item !== null);
        if (items.length > 0) attrs["parts"] = items.map((item) => String(item));
      }
      // The fold: version || edition, with the flag holding for ed.N —
      // the V/ed faces are mutually exclusive by grammar.
      if (flat["version"] !== undefined && flat["version"] !== null) {
        attrs["version"] = String(flat["version"]);
      } else if (flat["edition"] !== undefined && flat["edition"] !== null) {
        attrs["version"] = String(flat["edition"]);
        attrs["is_edition"] = true;
      }
      if (flat["year"] !== undefined && flat["year"] !== null) {
        attrs["year"] = String(flat["year"]);
      }
      if (flat["month"] !== undefined && flat["month"] !== null) {
        attrs["month"] = String(flat["month"]);
      }
      let identifier: EtsiPfsIdentifier = new EtsiPfsStandardIdentifier(attrs);
      if (flat["supplements"] !== undefined && flat["supplements"] !== null) {
        const rows = Array.isArray(flat["supplements"])
          ? flat["supplements"]
          : [flat["supplements"]];
        for (const row of rows) {
          const item = (row as Record<string, unknown>)?.["supplement"] as
            | Record<string, unknown>
            | undefined;
          if (item === undefined || item === null) continue;
          const kind = String(unwrap(item["supplement_kind"]) ?? "");
          const Wrapper =
            kind === EtsiPfsAmendmentIdentifier.FACE
              ? EtsiPfsAmendmentIdentifier
              : kind === EtsiPfsCorrigendumIdentifier.FACE
                ? EtsiPfsCorrigendumIdentifier
                : undefined;
          if (Wrapper === undefined) {
            throw new ParseFailed(`ETSI: unknown supplement kind ${kind}`, 0);
          }
          identifier = new Wrapper({
            base: identifier,
            number: Number(unwrap(item["supplement_number"])),
          }) as unknown as EtsiPfsIdentifier;
        }
      }
      return identifier as unknown as Identifier;
    },
  };
}
