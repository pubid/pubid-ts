import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type AttributeTable, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/api: the shared base, the eight typed leaf
 * classes plus TypelessStandard, the renderer and the URN generator.
 */

const BASE_ATTRS: AttributeTable = {
  publisher: { type: "string", default: "API" },
  number: { type: "string" },
  part: { type: "string" },
  subpart: { type: "string" },
  year: { type: "string" },
  reaffirmation: { type: "string" },
};

const BASE_MAPPINGS: FieldMapping[] = keyValue(
  { wire: "publisher", to: "publisher" },
  { wire: "number", to: "number" },
  { wire: "part", to: "part" },
  { wire: "subpart", to: "subpart" },
  { wire: "year", to: "year" },
  { wire: "reaffirmation", to: "reaffirmation" },
);

export abstract class ApiIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, BASE_ATTRS);
  static mappings = BASE_MAPPINGS;

  declare readonly publisher: string | undefined;
  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly subpart: string | undefined;
  declare readonly year: string | undefined;
  declare readonly reaffirmation: string | undefined;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    const self = this as unknown as Record<string, unknown>;
    if (self["publisher"] === undefined) self["publisher"] = "API";
  }

  /** The printed type token (plain method on the Ruby leaf, never a wire attribute). */
  typeString(): string | undefined {
    return undefined;
  }

  render(): string {
    const parts = ["API"];
    if (this.typeString() !== undefined) parts.push(this.typeString()!);
    const code = codePortion(this);
    if (code !== undefined) parts.push(code);
    let result = parts.join(" ");
    if (this.year !== undefined) result += `-${this.year}`;
    if (this.reaffirmation !== undefined) result += ` (R${this.reaffirmation})`;
    return result;
  }
}

function codePortion(id: ApiIdentifier): string | undefined {
  if (id.number === undefined) return undefined;
  return id.part !== undefined ? `${id.number}-${id.part}` : id.number;
}

class ApiUrnGenerator extends BaseUrnGenerator<ApiIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "api", "std"];
    if (id.number !== undefined) parts.push(id.number);
    if (id.part !== undefined) parts.push(`-${id.part}`);
    if (id.year !== undefined) parts.push(id.year);
    parts[1] = id.publisher !== undefined ? id.publisher.toLowerCase() : "api";
    return parts.join(":");
  }
}

interface TypeSpec {
  kind: string;
  typeString?: string;
}

function apiClass(spec: TypeSpec, extraAttrs: AttributeTable = {}, render?: (id: ApiIdentifier) => string): IdentifierStatic {
  class ApiConcrete extends ApiIdentifier {
    static polymorphicName = `pubid:api:${spec.kind}`;
    static urnGenerator = ApiUrnGenerator;
    static attributes = extendAttributes(ApiIdentifier, extraAttrs);
    static mappings: FieldMapping[] = [
      ...BASE_MAPPINGS,
      ...Object.keys(extraAttrs).map((k) => ({ wire: k, to: k })) as FieldMapping[],
    ];

    typeString(): string | undefined {
      return spec.typeString;
    }

    render(): string {
      return render !== undefined ? render(this) : super.render();
    }
  }
  registerType(ApiConcrete as unknown as IdentifierStatic);
  return ApiConcrete as unknown as IdentifierStatic;
}

export const BulletinClass = apiClass({ kind: "bulletin", typeString: "BULL" });
export const RecommendedPracticeClass = apiClass({ kind: "recommended-practice", typeString: "RP" });
export const SpecificationClass = apiClass({ kind: "specification", typeString: "SPEC" });
export const StandardClass = apiClass({ kind: "standard", typeString: "STD" });
export const TechnicalReportClass = apiClass({ kind: "technical-report", typeString: "TR" });
export const ContinuousOperationsStandardClass = apiClass({ kind: "continuous-operations-standard", typeString: "COS" });
export const PublicationClass = apiClass({ kind: "publication", typeString: "PUBL" });
export const TypelessStandardClass = apiClass({ kind: "typeless-standard" });

export const MpmsClass = apiClass(
  { kind: "mpms", typeString: "MPMS" },
  { section: { type: "string" }, subsection: { type: "string" } },
  (id) => {
    const self = id as unknown as { section?: string; subsection?: string };
    const parts = ["API", "MPMS"];
    if (id.number !== undefined) parts.push(`CH ${id.number}`);
    if (self.section !== undefined) {
      parts.push(`.${self.section}`);
      if (self.subsection !== undefined) parts.push(`.${self.subsection}`);
    }
    if (id.year !== undefined) parts.push(`-${id.year}`);
    return parts.join(" ").replaceAll(" .", ".");
  },
);

export const TYPE_CLASS_MAP: Record<string, IdentifierStatic> = {
  BULL: BulletinClass,
  MPMS: MpmsClass,
  RP: RecommendedPracticeClass,
  SPEC: SpecificationClass,
  STD: StandardClass,
  TR: TechnicalReportClass,
  COS: ContinuousOperationsStandardClass,
  PUBL: PublicationClass,
};
