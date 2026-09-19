import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { keyValue, extendAttributes, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { CenIdentifier } from "../cen_cenelec/model.js";

/**
 * Port of lib/pubid/evs: the national-adoption identifier wrapping a
 * CEN/CENELEC base, the renderer ("EVS" + separator + adopted) and the
 * URN generator (the adopted CEN URN with urn:cen: swapped for
 * urn:evs:).
 */

const CEN_NAMESPACE = "urn:cen:";
const EVS_NAMESPACE = "urn:evs:";

class EvsUrnGenerator extends BaseUrnGenerator<EvsIdentifier> {
  generate(): string {
    const adoptedUrn = this.identifier.base?.toUrn() ?? "";
    if (!adoptedUrn.startsWith(CEN_NAMESPACE)) {
      throw new Error(`expected adopted CEN URN, got ${JSON.stringify(adoptedUrn)}`);
    }
    return EVS_NAMESPACE + adoptedUrn.slice(CEN_NAMESPACE.length);
  }
}

export abstract class EvsIdentifier extends BaseIdentifier {
  declare readonly base: CenIdentifier | undefined;
  // "-" or " " — preserves the printed separator ("EVS-EN" vs "EVS EN").
  declare readonly separator: string | undefined;
}

export class NationalAdoption extends EvsIdentifier {
  static polymorphicName = "pubid:evs:national-adoption";
  static urnGenerator = EvsUrnGenerator;
  static attributes = extendAttributes(EvsIdentifier, {
    base: { type: CenIdentifier as unknown as IdentifierStatic },
    separator: { type: "string", default: "-" },
  });
  static mappings: FieldMapping[] = keyValue(
    { wire: "base", to: "base" },
    { wire: "separator", to: "separator" },
  );

  render(): string {
    return `EVS${this.separator ?? "-"}${this.base?.toHuman() ?? ""}`;
  }
}

registerType(NationalAdoption as unknown as IdentifierStatic);
