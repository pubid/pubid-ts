import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { astmGrammar } from "./grammar.js";
import {
  AdjunctClass,
  AstmIdentifier,
  DataSeriesClass,
  IsoDualPublishedClass,
  ManualClass,
  MonographClass,
  ResearchReportClass,
  StandardClass,
  TechnicalReportClass,
  WorkInProgressClass,
} from "./model.js";

/**
 * Port of lib/pubid/astm/builder.rb — the parse-tree → identifier
 * pipeline (class routing by type/number, code-column assembly,
 * type-specific attributes, 2-digit year conversion).
 */

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v);
  return s.length > 0 ? s : undefined;
};

function convertYear(yearStr: string): string {
  if (yearStr.length === 4) return yearStr;
  const yearInt = Number.parseInt(yearStr, 10);
  return yearInt <= 24 ? `20${yearStr}` : `19${yearStr}`;
}

type AstmCtor = new (attrs?: Record<string, unknown>) => AstmIdentifier;

function determineClass(d: TreeObject): AstmCtor {
  const type = str(d["type"]);
  if ((type === undefined || type === "") && d["number"] !== undefined && d["letter"] === undefined) {
    const numberStr = str(d["number"]) ?? "";
    if (numberStr.startsWith("5")) return IsoDualPublishedClass as unknown as AstmCtor;
    return StandardClass as unknown as AstmCtor;
  }
  switch (type) {
    case "RR": return ResearchReportClass as unknown as AstmCtor;
    case "MNL": return ManualClass as unknown as AstmCtor;
    case "MONO": return MonographClass as unknown as AstmCtor;
    case "DS": return DataSeriesClass as unknown as AstmCtor;
    case "WK": return WorkInProgressClass as unknown as AstmCtor;
    case "ADJ": return AdjunctClass as unknown as AstmCtor;
    case "TR":
    case "ISO/ASTMTR":
      return TechnicalReportClass as unknown as AstmCtor;
    default: return StandardClass as unknown as AstmCtor;
  }
}

class AstmBuilder {
  build(tree: Tree): Identifier {
    const d = Array.isArray(tree) ? (Object.assign({}, ...tree) as TreeObject) : (tree as TreeObject);
    const klass = determineClass(d);
    const self: Record<string, unknown> = {};

    if (d["letter"] !== undefined || d["number"] !== undefined) {
      const letter =
        d["letter"] !== undefined &&
        !(str(d["type"]) === "TR" && (str(d["publisher"]) ?? "").startsWith("ISO/ASTM"))
          ? str(d["letter"])
          : undefined;
      self["letter"] = letter;
      self["number"] = str(d["number"]);
      self["suffix"] = str(d["suffix"]);
      self["subseries"] = str(d["subseries"]);
      self["dual_m"] = d["dual_m"] !== undefined;
    }

    if (str(d["type"]) === "ISO/ASTMTR") {
      self["publisher"] = "ISO/ASTM";
    } else {
      self["publisher"] = str(d["publisher"]) ?? "ASTM";
    }

    if (d["year"] !== undefined) {
      self["year"] = convertYear(str(d["year"]) ?? "");
    }
    if (d["format_suffix"] !== undefined) {
      self["format_suffix"] = `-${str(d["format_suffix"])}`;
    }

    this.buildTypeSpecific(self, klass, d);
    return new klass(self) as unknown as Identifier;
  }

  private buildTypeSpecific(self: Record<string, unknown>, klass: AstmCtor, d: TreeObject): void {
    if (klass === (ResearchReportClass as unknown as AstmCtor) && d["committee"] !== undefined) {
      self["committee"] = str(d["committee"]);
    }
    if (klass === (ManualClass as unknown as AstmCtor)) {
      if (d["edition"] !== undefined) self["edition"] = str(d["edition"]);
      if (d["supplement"] !== undefined) self["supplement"] = true;
      if (d["tp_designation"] !== undefined) self["tp_designation"] = str(d["tp_designation"]);
    }
    if (klass === (MonographClass as unknown as AstmCtor) && d["edition"] !== undefined) {
      self["edition"] = str(d["edition"]);
    }
    if (klass === (DataSeriesClass as unknown as AstmCtor) && d["hol_suffix"] !== undefined) {
      self["hol_suffix"] = true;
    }
    if (klass === (AdjunctClass as unknown as AstmCtor)) {
      if (d["designation"] !== undefined) self["number"] = str(d["designation"]);
      if (d["ea_suffix"] !== undefined && d["ea_suffix"] !== null) self["ea_suffix"] = true;
      if (d["dvd_suffix"] !== undefined && d["dvd_suffix"] !== null) self["dvd_suffix"] = true;
    }
    if (klass === (StandardClass as unknown as AstmCtor) || klass === (IsoDualPublishedClass as unknown as AstmCtor)) {
      if (d["sub_year"] !== undefined) self["sub_year"] = str(d["sub_year"]);
      if (d["reapproval"] !== undefined) self["reapproval"] = str(d["reapproval"]);
      const editionData = d["edition"];
      if (editionData !== undefined) {
        if (isObj(editionData)) {
          const editionNumber = str(editionData["edition_number"]);
          if (editionNumber !== undefined) self["edition"] = editionNumber;
        } else {
          self["edition"] = str(editionData);
        }
      }
    }
  }
}

export function astmGrammarImplementation(): FlavorImplementation {
  const builder = new AstmBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(astmGrammar, input);
      return builder.build(tree);
    },
  };
}
