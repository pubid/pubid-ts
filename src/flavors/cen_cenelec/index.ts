import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { grammarImplementation } from "../index.js";
import { cenCenelecGrammar, preprocessCenCenelec } from "./grammar.js";
import {
  AdoptedEuropeanNormClass,
  AmendmentClass,
  CEN_DOCUMENT_CLASSES,
  CenIdentifier,
  ConsolidatedIdentifierClass,
  CorrigendumClass,
  DEFAULT_TYPED_STAGE,
  EuropeanPrestandardClass,
  FragmentClass,
  PUBLISHER_TYPES,
  locateStage,
  locateTypeClass,
} from "./model.js";

/**
 * Port of lib/pubid/cen_cenelec/builder.rb — the parse-tree → identifier
 * pipeline: base document (adopted / ENV adoption / implicit IEC adoption /
 * plain), then the supplement wrapping (slash → standalone, plus →
 * consolidated) and the fragment path.
 */

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v);
  return s.length > 0 ? s : undefined;
};

const presentString = (v: unknown): string | undefined => {
  const s = str(v);
  return s === undefined || s === "" ? undefined : s;
};

function flattenArray(data: Tree[]): TreeObject {
  return Object.assign({}, ...data) as TreeObject;
}

class CenBuilder {
  build(data: Tree): Identifier {
    const d = Array.isArray(data) ? flattenArray(data as TreeObject[]) : (data as TreeObject);

    if (d["fragment_number"] !== undefined) {
      return this.buildFragmentIdentifier(d);
    }

    const base = this.buildBaseDocument(d);

    if (this.hasSlashSupplements(d)) {
      return this.buildStandaloneSupplement(base, d);
    }
    const supplementsData = this.extractSupplements(d);
    if (supplementsData.length > 0) {
      return this.wrapWithConsolidated(base, supplementsData);
    }
    return base as unknown as Identifier;
  }

  private buildBaseDocument(d: TreeObject): CenIdentifier {
    if (d["adopted_string"] !== undefined) {
      if (str(d["publisher"]) === "ENV") {
        return this.buildEnvAdoptedIdentifier(d);
      }
      return this.buildAdoptedIdentifier(d);
    }

    if (
      str(d["publisher"]) === "EN" &&
      (Array.isArray(d["parts"]) ? d["parts"].length === 0 : true) &&
      !this.hasSupplements(d)
    ) {
      const adopted = this.buildImplicitAdoption(d);
      if (adopted !== undefined) return adopted;
    }

    const baseData = { ...d };
    delete baseData["supplements"];
    return this.buildPlainIdentifier(baseData);
  }

  private hasSupplements(d: TreeObject): boolean {
    return this.hasSlashSupplements(d) || this.extractSupplements(d).length > 0;
  }

  private buildPlainIdentifier(baseData: TreeObject): CenIdentifier {
    const klass = this.locateIdentifierKlass(baseData);
    const attrs = this.assignAttributes(baseData);
    return new (klass as new (attrs?: Record<string, unknown>) => CenIdentifier)(attrs);
  }

  private locateIdentifierKlass(d: TreeObject): unknown {
    if (d["adopted_string"] !== undefined) return AdoptedEuropeanNormClass;

    const publisherStr = str(d["publisher"]) ?? "";
    if (PUBLISHER_TYPES.includes(publisherStr)) {
      const typedStage = locateStage(publisherStr);
      if (typedStage !== undefined) {
        const kind = locateTypeClass(typedStage.type_code);
        if (kind !== undefined) return CEN_DOCUMENT_CLASSES.get(kind);
      }
    }

    const typeOrStage =
      str(d["type_with_stage"]) ?? str(d["type"]) ?? str(d["stage"]) ?? "";
    const typedStage = locateStage(typeOrStage) ?? DEFAULT_TYPED_STAGE;
    return CEN_DOCUMENT_CLASSES.get(locateTypeClass(typedStage.type_code) ?? "en");
  }

  private assignAttributes(baseData: TreeObject): Record<string, unknown> {
    const attrs: Record<string, unknown> = {};

    if (baseData["type_with_stage"] !== undefined) {
      const typedStage = locateStage(str(baseData["type_with_stage"]) ?? "") ?? DEFAULT_TYPED_STAGE;
      attrs["typedStage"] = typedStage;
      attrs["type"] = typedStage.type_code === "en" ? "EN" : typedStage.abbr;
    }
    if (baseData["type"] !== undefined) {
      attrs["type"] = str(baseData["type"]);
    }
    if (baseData["publisher"] !== undefined) {
      attrs["publisher"] = str(baseData["publisher"]);
    }
    if (baseData["copublisher"] !== undefined) {
      attrs["copublishers"] = [str(baseData["copublisher"])];
    }
    if (baseData["number"] !== undefined) {
      attrs["number"] = str(baseData["number"]);
    }
    if (Array.isArray(baseData["parts"]) && baseData["parts"].length > 0) {
      const first = baseData["parts"][0];
      attrs["part"] = isObj(first) ? str(first["part"]) : str(first);
    }
    const year = str(baseData["year"]);
    if (year !== undefined) {
      const month = str(baseData["month"]);
      attrs["date"] = new PubidDateRef(month !== undefined ? { year, month } : { year });
    }

    return attrs;
  }

  private parseAdoptedString(adoptedStr: string): Identifier | undefined {
    if (adoptedStr.startsWith("ISO/IEC") || adoptedStr.includes("ISO/IEC") || adoptedStr.startsWith("ISO")) {
      const impl = grammarImplementation("iso");
      if (impl === undefined) throw new Error("iso implementation unavailable");
      return impl.parse(adoptedStr);
    }
    if (adoptedStr.startsWith("IEC")) {
      const impl = grammarImplementation("iec");
      if (impl === undefined) throw new Error("iec implementation unavailable");
      return impl.parse(adoptedStr);
    }
    return undefined;
  }

  private buildAdoptedIdentifier(d: TreeObject): CenIdentifier {
    const adoptedStr = str(d["adopted_string"])?.trim();
    const adoptedId = adoptedStr !== undefined ? this.parseAdoptedString(adoptedStr) : undefined;

    const copublishers =
      Array.isArray(d["copublishers"])
        ? (d["copublishers"] as TreeObject[]).map((c) => str(c["copublisher"]))
        : d["copublisher"] !== undefined
          ? [str(d["copublisher"])]
          : [];

    const attrs: Record<string, unknown> = { adopted: adoptedId };
    if (d["type_with_stage"] !== undefined) {
      const typedStage = locateStage(str(d["type_with_stage"]) ?? "") ?? DEFAULT_TYPED_STAGE;
      attrs["typedStage"] = typedStage;
      attrs["type"] = "EN";
    }
    if (d["publisher"] !== undefined) {
      attrs["publisher"] = str(d["publisher"]);
    }
    if (copublishers.length > 0) {
      attrs["copublishers"] = copublishers.filter((c): c is string => c !== undefined);
    }
    return new AdoptedEuropeanNormClass(
      attrs as unknown as Record<string, unknown>,
    ) as unknown as CenIdentifier;
  }

  private buildEnvAdoptedIdentifier(d: TreeObject): CenIdentifier {
    const adoptedStr = str(d["adopted_string"])?.trim();
    const adoptedId = adoptedStr !== undefined ? this.parseAdoptedString(adoptedStr) : undefined;
    return new EuropeanPrestandardClass({
      publisher: "ENV",
      adopted: adoptedId,
    } as unknown as Record<string, unknown>) as unknown as CenIdentifier;
  }

  private buildImplicitAdoption(d: TreeObject): CenIdentifier | undefined {
    const numStr = (str(d["number"]) ?? "").trim();
    if (!/^\d{1,6}$/.test(numStr)) return undefined;
    const num = Number.parseInt(numStr, 10);
    if (!(num >= 60000 && num <= 79999)) return undefined;
    const impl = grammarImplementation("iec");
    if (impl === undefined) return undefined;
    return new AdoptedEuropeanNormClass({
      adopted: impl.parse(`IEC ${numStr}`),
    } as unknown as Record<string, unknown>) as unknown as CenIdentifier;
  }

  private buildFragmentIdentifier(d: TreeObject): Identifier {
    const baseData = { ...d };
    delete baseData["amendment_number"];
    delete baseData["fragment_number"];

    delete baseData["amendment_year"];
    const base = this.buildPlainIdentifier(baseData);
    // The compact spelling can carry the amendment's own year
    // (EN 60038/A1:2009 FRAG2); the AMD-keyword spelling cannot.
    const amendment = new AmendmentClass({
      base,
      number: str(d["amendment_number"]),
      ...(str(d["amendment_year"]) !== undefined ? { year: str(d["amendment_year"]) } : {}),
    } as unknown as Record<string, unknown>);
    return new FragmentClass({
      base: amendment,
      number: str(d["fragment_number"]),
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  private supplementDataOf(s: unknown): TreeObject {
    if (isObj(s) && s["supplement"] !== undefined) return s["supplement"] as TreeObject;
    return s as TreeObject;
  }

  private extractSupplements(d: TreeObject): { type: "amendment" | "corrigendum"; number?: string | undefined; year?: string | undefined; month?: string | undefined }[] {
    const supps = d["supplements"];
    if (!Array.isArray(supps) || supps.length === 0) return [];
    return supps
      .map((s) => this.supplementDataOf(s))
      .filter((suppData) => suppData["amd_sep_plus"] !== undefined)
      .map((suppData) => ({
        type: (suppData["amd_number"] !== undefined ? "amendment" : "corrigendum") as "amendment" | "corrigendum",
        number: str(suppData["amd_number"]) ?? str(suppData["cor_number"]),
        year: str(suppData["amd_year"]) ?? str(suppData["year"]),
        month: str(suppData["month"]),
      }));
  }

  private hasSlashSupplements(d: TreeObject): boolean {
    const supps = d["supplements"];
    if (!Array.isArray(supps) || supps.length === 0) return false;
    return supps.some((s) => this.supplementDataOf(s)["amd_sep_slash"] !== undefined);
  }

  private buildStandaloneSupplement(base: CenIdentifier, d: TreeObject): Identifier {
    const supps = d["supplements"] as Tree[];
    const suppData = this.supplementDataOf(supps[0]);
    if (suppData["amd_number"] !== undefined) {
      return new AmendmentClass({
        base,
        number: str(suppData["amd_number"]),
        year: presentString(suppData["amd_year"]),
      } as unknown as Record<string, unknown>) as unknown as Identifier;
    }
    return new CorrigendumClass({
      base,
      number: presentString(suppData["cor_number"]),
      year: presentString(suppData["year"]),
      month: presentString(suppData["month"]),
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  private wrapWithConsolidated(
    base: CenIdentifier,
    supplementsData: { type: "amendment" | "corrigendum"; number?: string | undefined; year?: string | undefined; month?: string | undefined }[],
  ): Identifier {
    const supplementIds = supplementsData.map((supp) =>
      supp.type === "amendment"
        ? new AmendmentClass({
            number: presentString(supp.number),
            year: presentString(supp.year),
          } as unknown as Record<string, unknown>)
        : new CorrigendumClass({
            number: presentString(supp.number),
            year: presentString(supp.year),
            month: presentString(supp.month),
          } as unknown as Record<string, unknown>),
    );
    return new ConsolidatedIdentifierClass({
      identifiers: [base, ...supplementIds],
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }
}

import { PubidDate as PubidDateRef } from "../../model/component.js";

/** The tree → identifier pipeline, shared with composed flavors (evs). */
export function buildCenIdentifier(tree: Tree): Identifier {
  return new CenBuilder().build(tree);
}

export function cenCenelecGrammarImplementation(): FlavorImplementation {
  const builder = new CenBuilder();
  return {
    parse(input: string): Identifier {
      const cleaned = preprocessCenCenelec(input);
      const tree = parseGrammar(cenCenelecGrammar, cleaned);
      return builder.build(tree);
    },
  };
}
