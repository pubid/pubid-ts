import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { grammarImplementation } from "../index.js";
import { ieeeGrammar } from "./grammar.js";
import { preParse, preprocessIeee } from "./preprocessor.js";
import { applyUpdateCodes } from "./update_codes.js";
import {
  AdoptedStandardClass,
  AieeClass,
  AmendmentClass,
  ConformanceClass,
  CorrigendumClass,
  CsaDualPublishedClass,
  DualPublishedClass,
  IecIeeeCopublishedClass,
  IeeeCode,
  IeeeDraft,
  IeeeIdentifier,
  IeeeRelationship,
  IeeeTypedStage,
  InterpretationClass,
  IreClass,
  JointDevelopmentClass,
  MultiNumberedClass,
  NescDraftClass,
  NescEditionClass,
  NescHandbookClass,
  NescRedlineClass,
  NescStandardClass,
  ProjectDraftIdentifierClass,
  SiStandardClass,
  StandardClass,
  locateStage,
  type TypedStageRecord,
} from "./model.js";

/**
 * Port of lib/pubid/ieee/{builder}.rb + Identifier.parse orchestration
 * (pre-parser dispatch, adopted/dual constructors, sub-builders).
 */

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const extractValue = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const joined = value.join("");
    return joined.length > 0 ? joined : undefined;
  }
  const strValue = String(value).trim();
  return strValue.length > 0 ? strValue : undefined;
};

function mergeParsedArray(parsedArray: Tree[]): TreeObject {
  return Object.assign({}, ...parsedArray) as TreeObject;
}

const asHash = (v: Tree): TreeObject => (Array.isArray(v) ? mergeParsedArray(v) : (v as TreeObject));

const SI_STAGES: TypedStageRecord[] = [
  { abbr: ["SI"], stage_code: "published", type_code: "SI" },
  { abbr: ["PSI"], stage_code: "draft", type_code: "SI" },
];

// --- Builder -----------------------------------------------------------------

class IeeeBuilder {
  originalInput = "";

  build(parsed: Tree): Identifier {
    const d = Array.isArray(parsed) ? mergeParsedArray(parsed) : (parsed as TreeObject);

    if (d["ieee_portion"] !== undefined && d["csa_portion"] !== undefined) {
      return this.buildCsaDualPublished(d);
    }
    if (d["s_number"] !== undefined) return this.buildSDesignation(d);
    if (d["first_aiee"] !== undefined && d["second_aiee"] !== undefined) {
      return this.buildCombinedAiee(d);
    }
    if (d["content"] !== undefined) return this.buildIecIeeCopublished(d);
    if (d["nesc"] !== undefined) return this.buildNesc(asHash(d["nesc"] as Tree));
    if (d["aiee"] !== undefined) return this.buildAiee(asHash(d["aiee"] as Tree));
    if (d["ire"] !== undefined) return this.buildIre(asHash(d["ire"] as Tree));
    if (d["si_type"] !== undefined) return this.buildSiPsi(d);

    return this.buildSingleIdentifier(d, false) as unknown as Identifier;
  }

  // --- single identifier -----------------------------------------------------

  buildSingleIdentifier(parsed: TreeObject, buildingSecondary: boolean): unknown {
    const parsedHash = asHash(parsed as Tree);

    if (
      !buildingSecondary && parsedHash["primary_identifier"] !== undefined &&
      (parsedHash["secondary_crossref"] !== undefined || parsedHash["secondary_joint"] !== undefined)
    ) {
      return this.buildMultiNumbered(parsedHash);
    }

    if (parsedHash["base"] !== undefined && parsedHash["cor_number"] !== undefined) {
      return this.buildCorrigendumSupplement(parsedHash);
    }
    // A corrigendum capture that is a bare STRING matched the marker
    // without its ordinal - never a valid complete parse (the reference
    // rejects "…Corrigendum/D1").
    if (typeof parsedHash["corrigendum"] === "string") {
      throw new ParseFailed("corrigendum marker without ordinal", 0);
    }
    if (isObj(parsedHash["corrigendum"]) && parsedHash["base"] === undefined) {
      // A corrigendum marker without its ordinal is not a marker - the
      // reference never completes such a parse ("…Corrigendum/D1").
      const cor = asHash(parsedHash["corrigendum"] as Tree);
      if (cor["cor_number"] === undefined && cor["cor_year"] === undefined) {
        throw new ParseFailed("corrigendum marker without ordinal", 0);
      }
      return this.buildFlatCorrigendum(parsedHash);
    }
    if (parsedHash["base"] !== undefined && parsedHash["amd_number"] !== undefined) {
      return this.buildAmendmentSupplement(parsedHash);
    }
    if (isObj(parsedHash["amendment"]) && parsedHash["base"] === undefined) {
      return this.buildFlatAmendment(parsedHash);
    }
    if (
      parsedHash["base"] !== undefined &&
      (parsedHash["int_year"] !== undefined || parsedHash["interpretation"] !== undefined)
    ) {
      return this.buildInterpretationSupplement(parsedHash);
    }
    if (parsedHash["interpretation"] !== undefined && parsedHash["base"] === undefined) {
      return this.buildFlatInterpretation(parsedHash);
    }
    if (parsedHash["base"] !== undefined && parsedHash["conf_number"] !== undefined) {
      return this.buildConformanceSupplement(parsedHash);
    }
    if (parsedHash["joint_publishers"] !== undefined || parsedHash["iso_stage"] !== undefined) {
      return this.buildJointDevelopment(parsedHash);
    }

    const attributes = this.extractAttributes(parsedHash);

    if (parsedHash["relationship_type"] !== undefined || parsedHash["relationship_clause"] !== undefined) {
      attributes["relationships"] = this.buildRelationships(parsedHash);
    }

    const klass = this.determineIdentifierClass(attributes);
    // ProjectDraftIdentifier#initialize strips the leading P off the code
    // string (the project marker lives in the stage, not the columns).
    if ((klass as unknown as IdentifierStatic) === ProjectDraftIdentifierClass) {
      // The strip happens on the CODE STRING before Code.parse (Ruby
      // ProjectDraftIdentifier#initialize), so "PIEEP62" -> prefix I.
      const codeStr = attributes["__code"] as string | undefined;
      if (codeStr !== undefined && codeStr.startsWith("P")) {
        const codeObj = IeeeCode.parse(codeStr.slice(1));
        delete attributes["prefix"];
        delete attributes["parts"];
        delete attributes["separator"];
        attributes["number"] = codeObj?.number;
        if (codeObj?.prefix !== undefined) attributes["prefix"] = codeObj.prefix;
        if (codeObj !== undefined && codeObj.parts.length > 0) attributes["parts"] = codeObj.parts;
        if (codeObj?.originalSeparator !== undefined) attributes["separator"] = codeObj.originalSeparator;
        // P = project (the document is a draft): the marker is
        // identity-bearing, so stripping the letter must not strip the
        // fact (docs/IEEE-DRAFT-STAGES.md §1.1).
        attributes["project_marker"] = true;
      }
    }
    delete attributes["__code"];
    this.renameSupplementKeys(attributes);
    return new klass(attributes as Record<string, unknown>) as unknown as Identifier;
  }

  renameSupplementKeys(attributes: Record<string, unknown>): void {
    const ordinal =
      attributes["cor_number"] ?? attributes["amd_number"] ?? attributes["conf_number"];
    delete attributes["cor_number"];
    delete attributes["amd_number"];
    delete attributes["conf_number"];
    if (ordinal !== undefined) attributes["number"] = ordinal;
    const year =
      attributes["cor_year"] ?? attributes["amd_year"] ?? attributes["conf_year"] ?? attributes["int_year"];
    delete attributes["cor_year"];
    delete attributes["amd_year"];
    delete attributes["conf_year"];
    delete attributes["int_year"];
    if (year !== undefined) attributes["year"] = year;
  }

  determineIdentifierClass(attributes: Record<string, unknown>): (new (attrs?: Record<string, unknown>) => unknown) & { polymorphicName: string } {
    if (attributes["publisher"] === "AIEE") return AieeClass as never;
    const typeCode = attributes["type"];
    if (typeCode === "P") return ProjectDraftIdentifierClass as never;
    if (typeCode === "SI" || typeCode === "PSI") return SiStandardClass as never;
    if (attributes["interpretation"] === true || attributes["int_year"] !== undefined) {
      return InterpretationClass as never;
    }
    if (attributes["conf_number"] !== undefined) return ConformanceClass as never;
    if (attributes["cor_number"] !== undefined) return CorrigendumClass as never;
    if (attributes["amd_number"] !== undefined) return AmendmentClass as never;
    if (attributes["adoption"] !== undefined) return AdoptedStandardClass as never;
    return StandardClass as never;
  }

  // --- extract_attributes ----------------------------------------------------

  extractAttributes(parsed: TreeObject): Record<string, unknown> {
    const attributes: Record<string, unknown> = {};

    if (parsed["publishers"] !== undefined) {
      const pubData = asHash(parsed["publishers"] as Tree);
      attributes["publisher"] = extractValue(pubData["publisher"]);
      if (pubData["copublishers"] !== undefined) {
        const copubs = Array.isArray(pubData["copublishers"])
          ? (pubData["copublishers"] as Tree[])
          : [pubData["copublishers"] as Tree];
        attributes["copublisher"] = copubs
          .map((cp) => extractValue(asHash(cp as Tree)["copublisher"]))
          .filter((cp): cp is string => cp !== undefined);
      }
    } else if (parsed["publisher"] !== undefined) {
      attributes["publisher"] = extractValue(parsed["publisher"]);
    }

    const codeParts: string[] = [];
    if (parsed["part"] !== undefined) codeParts.push(extractValue(parsed["part"]) ?? "");
    if (parsed["subpart"] !== undefined) {
      const subparts = Array.isArray(parsed["subpart"]) ? (parsed["subpart"] as Tree[]) : [parsed["subpart"] as Tree];
      for (const sp of subparts) {
        const v = extractValue(sp);
        if (v !== undefined) codeParts.push(v);
      }
    }

    let codeStr = extractValue(parsed["number"]);

    let typeValue = extractValue(parsed["type"]);
    const draftStatusValue = extractValue(parsed["draft_status"]);

    if (typeValue === undefined && this.originalInput !== "" && /IEEE\s+P/.test(this.originalInput)) {
      typeValue = "P";
    }
    if (typeValue === undefined && this.originalInput !== "" && /ANSI\s+P/.test(this.originalInput)) {
      typeValue = "P";
    }

    if (codeStr !== undefined && codeStr.startsWith("P") && this.originalInput.includes("/CSA")) {
      const pubData = parsed["publishers"] !== undefined ? asHash(parsed["publishers"] as Tree) : undefined;
      const hasCsaCopub =
        pubData?.["copublishers"] !== undefined
          ? (Array.isArray(pubData["copublishers"]) ? (pubData["copublishers"] as Tree[]) : [pubData["copublishers"] as Tree])
              .some((cp) => (extractValue(asHash(cp as Tree)["copublisher"]) ?? "").includes("CSA"))
          : this.originalInput.includes("/CSA");
      if (hasCsaCopub) codeStr = codeStr.replace(/^P/, "");
    }

    if (codeStr !== undefined && codeParts.length > 0) {
      codeStr += `.${codeParts.join(".")}`;
    }

    if (
      codeStr !== undefined && parsed["year"] === undefined && codeParts.length === 0
    ) {
      const m = /^(.+)-(\d{4})$/.exec(codeStr);
      if (m !== null) {
        const potentialYear = Number.parseInt(m[2]!, 10);
        if (potentialYear >= 1884 && potentialYear <= 2099) {
          codeStr = m[1]!;
          parsed["year"] = m[2]!;
        }
      }
    }

    const codeObj = codeStr !== undefined ? IeeeCode.parse(codeStr) : undefined;
    if (codeStr !== undefined) attributes["__code"] = codeStr;
    if (codeObj !== undefined) {
      attributes["number"] = codeObj.number;
      if (codeObj.prefix !== undefined) attributes["prefix"] = codeObj.prefix;
      if (codeObj.parts.length > 0) attributes["parts"] = codeObj.parts;
      if (codeObj.originalSeparator !== undefined) attributes["separator"] = codeObj.originalSeparator;
    }

    if (parsed["year"] !== undefined) {
      attributes["year"] = extractValue(parsed["year"]);
    } else if (parsed["edition_year"] !== undefined) {
      attributes["year"] = extractValue(parsed["edition_year"]);
    } else if (parsed["trailing_year"] !== undefined) {
      attributes["year"] = extractValue(parsed["trailing_year"]);
      if (parsed["trailing_month"] !== undefined) {
        attributes["month"] = extractValue(parsed["trailing_month"]);
      }
    }

    if (parsed["edition_month"] !== undefined) {
      attributes["edition_month"] = extractValue(parsed["edition_month"]);
    }

    // The historical "No"-prefixed spellings ("IEEE No148, April 1959")
    // are plain standards - No normalizes to Std so the render prints
    // "IEEE Std 148" and the stage lookup resolves. AIEE keeps its No.
    if (typeValue !== undefined && /^No\.?$/.test(typeValue) &&
        /^IEEE\s/.test(this.originalInput)) {
      typeValue = "Std";
    }
    if (typeValue !== undefined) attributes["type"] = typeValue;

    const typedStageAbbr = this.determineStageAbbr(typeValue, parsed);
    if (typedStageAbbr !== undefined) {
      const record = locateStage(typedStageAbbr);
      if (record !== undefined) attributes["typed_stage"] = new IeeeTypedStage(record);
    }

    attributes["draft_status"] = draftStatusValue;

    for (const key of ["edition", "revision"] as const) {
      const value = extractValue(parsed[key]);
      if (value !== undefined) attributes[key] = value;
    }
    if (attributes["edition_month"] === undefined) {
      const month = extractValue(parsed["month"]);
      if (month !== undefined) attributes["month"] = month;
    }
    const day = extractValue(parsed["day"]);
    if (day !== undefined) attributes["day"] = day;

    this.handleDraft(parsed, attributes);
    this.applyDefaultDraftVersion(attributes, typeValue);
    this.handleKeyedHash(parsed, "corrigendum", attributes, "cor_number", "cor_year");
    this.handleKeyedHash(parsed, "amendment", attributes, "amd_number", "amd_year");
    this.handleKeyedHash(parsed, "conformance", attributes, "conf_number", "conf_year");
    this.handleAshraeCopub(parsed, attributes);
    this.handleIeeeCrossref(parsed, attributes);
    this.handleReaffirmed(parsed, attributes);
    this.handleParameters(parsed, attributes);

    if (parsed["nickname"] !== undefined) {
      attributes["nickname"] = extractValue(parsed["nickname"]);
    }
    if (parsed["interpretation"] !== undefined) attributes["interpretation"] = true;
    if (parsed["redline"] !== undefined) attributes["redline"] = true;

    return attributes;
  }

  determineStageAbbr(typeValue: string | undefined, parsed: TreeObject): string | undefined {
    // An explicit joint stage on the draft ("=DFDIS.3") IS the stage —
    // it outranks the ordinal ladder, which classifies IEEE-internal
    // drafts only (docs/IEEE-DRAFT-STAGES.md §1.3).
    if (parsed["draft"] !== undefined) {
      let draftData = parsed["draft"] as Tree;
      if (Array.isArray(draftData)) {
        draftData = mergeParsedArray(draftData as TreeObject[]);
      }
      if (isObj(draftData) && draftData["draft_iso_stage"] !== undefined) {
        const stage = extractValue(draftData["draft_iso_stage"]) ?? "";
        // The doubled-D alias ("DFDIS") carries its own draft marker;
        // the stage is what remains.
        const rest = stage.slice(1);
        return stage.startsWith("D") && ["PWI", "NP", "WD", "CD", "CDV", "DIS", "FDIS"].includes(rest)
          ? rest
          : stage;
      }
      if (isObj(draftData) && draftData["draft_version"] !== undefined) {
        const dv = draftData["draft_version"];
        const version = Array.isArray(dv) ? dv.map((v) => extractValue(v) ?? "").join("") : extractValue(dv);
        if (version !== undefined) {
          const draftAbbr = `D${version}`;
          const stage = locateStage(draftAbbr);
          if (stage !== undefined && stage.abbr.includes(draftAbbr)) return draftAbbr;
        }
      }
    }

    if (typeValue !== undefined) {
      if (typeValue.startsWith("P")) return "P";
      if (typeValue === "Std") return "Std";
      if (typeValue === "Draft Std" && parsed["draft"] === undefined && parsed["digit_draft"] === undefined) {
        return "D1";
      }
      if (/^No\.?$/.test(typeValue)) return typeValue;
    }
    return "Std";
  }

  handleDraft(parsed: TreeObject, attributes: Record<string, unknown>): void {
    let draftData: Tree | undefined = parsed["draft"] ?? parsed["digit_draft"];
    if (draftData === undefined) return;

    if (Array.isArray(draftData)) {
      const hashes = draftData.filter((e): e is TreeObject => isObj(e));
      const versions = hashes
        .map((e) => e["draft_version"])
        .filter((v) => v !== undefined);
      const merged = Object.assign({}, ...hashes) as TreeObject;
      if (versions.length > 0) merged["draft_version"] = versions;
      draftData = merged;
    }

    let version: string | undefined;
    let revision: string | undefined;
    let isoStage: string | undefined;
    let isoIteration: string | undefined;
    let month: string | undefined;
    let year: string | undefined;
    let day: string | undefined;
    let commaBeforeMonth = false;

    if (isObj(draftData)) {
      if (draftData["draft_version"] !== undefined) {
        const dv = draftData["draft_version"];
        version = Array.isArray(dv) ? dv.map((v) => extractValue(v) ?? "").join("") : extractValue(dv);
        if (version !== undefined) version = version.replace(/^-/, "");
      }
      revision = extractValue(draftData["revision"]);
      isoStage = extractValue(draftData["draft_iso_stage"]);
      isoIteration = extractValue(draftData["draft_iso_iteration"]);
      month = extractValue(draftData["month"]);
      year = extractValue(draftData["year"]);
      day = extractValue(draftData["day"]);
      if (this.originalInput !== "" && month !== undefined) {
        commaBeforeMonth = new RegExp(`,\\s+${month.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
          .test(this.originalInput);
      }
      if (
        version !== undefined && this.originalInput !== "" &&
        new RegExp(`\\s+/D${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(this.originalInput)
      ) {
        attributes["space_before_draft"] = true;
      }
    } else {
      version = extractValue(draftData);
    }

    if (version !== undefined || (isObj(draftData) && draftData["draft_iso_stage"] !== undefined)) {
      const draftObj = new IeeeDraft({
        version,
        revision,
        iso_stage: isoStage,
        iso_iteration: isoIteration,
        month,
        year,
        day,
        comma_before_month: commaBeforeMonth,
      });
      attributes["draft"] = draftObj.render();
    }
  }

  applyDefaultDraftVersion(attributes: Record<string, unknown>, typeValue: string | undefined): void {
    if (attributes["draft"] !== undefined) return;
    if (typeValue !== "Draft Std") return;
    attributes["draft"] = new IeeeDraft({ version: "1", year: attributes["year"] as string | undefined }).render();
  }

  handleKeyedHash(
    parsed: TreeObject,
    key: string,
    attributes: Record<string, unknown>,
    numberKey: string,
    yearKey: string,
  ): void {
    if (isObj(parsed[key])) {
      const data = parsed[key] as TreeObject;
      attributes[numberKey] = extractValue(data[numberKey]);
      if (data[yearKey] !== undefined) attributes[yearKey] = extractValue(data[yearKey]);
    }
  }

  handleAshraeCopub(parsed: TreeObject, attributes: Record<string, unknown>): void {
    if (isObj(parsed["ashrae_copub"])) {
      const data = parsed["ashrae_copub"] as TreeObject;
      attributes["ashrae_number"] = extractValue(data["ashrae_number"]);
      if (data["ashrae_year"] !== undefined) {
        attributes["ashrae_year"] = extractValue(data["ashrae_year"]);
      }
    }
  }

  handleIeeeCrossref(parsed: TreeObject, attributes: Record<string, unknown>): void {
    if (parsed["ieee_crossref"] !== undefined) {
      const raw = extractValue(parsed["ieee_crossref"]) ?? "";
      attributes["crossref"] = `/C${raw.replace(/^\//, "")}`;
    }
  }

  handleReaffirmed(parsed: TreeObject, attributes: Record<string, unknown>): void {
    if (isObj(parsed["reaffirmed"])) {
      attributes["reaffirmed"] = extractValue((parsed["reaffirmed"] as TreeObject)["year"]);
    } else if (parsed["reaffirmed"] !== undefined) {
      attributes["reaffirmed"] = extractValue(parsed["reaffirmed"]);
    }
  }

  handleParameters(parsed: TreeObject, attributes: Record<string, unknown>): void {
    if (!isObj(parsed["parameters"])) return;
    const paramData = parsed["parameters"] as TreeObject;
    for (const key of ["parenthetical_content", "revision_of", "amendment_to", "adoption", "note"] as const) {
      const value = extractValue(paramData[key]);
      if (value !== undefined) attributes[key] = value;
    }
  }

  parseIdentifierList(listData: unknown): Identifier[] {
    if (listData === undefined || listData === null) return [];
    const entries: unknown[] = Array.isArray(listData) ? listData : [listData];
    const idStrings: string[] = [];
    for (const entry of entries) {
      if (isObj(entry) && entry["id"] !== undefined) {
        idStrings.push(String(entry["id"]).trim());
      }
    }
    return idStrings.map((idStr) => {
      try {
        return ieeeParse(idStr);
      } catch {
        return new StandardClass({ parenthetical_content: idStr }) as unknown as Identifier;
      }
    });
  }

  relationshipFrom(relData: TreeObject): IeeeRelationship | undefined {
    if (!isObj(relData["relationship_type"])) return undefined;
    const firstKey = Object.keys(relData["relationship_type"] as TreeObject)[0];
    if (firstKey === undefined) return undefined;
    let amendments: Identifier[] = [];
    if (relData["amendments"] !== undefined && !isObj(relData["amendments"])) {
      amendments = this.parseIdentifierList(relData["amendments"]);
    }
    return new IeeeRelationship(
      firstKey,
      this.parseIdentifierList(relData["related_ids"]),
      amendments,
      isObj(relData["amendments"]) && (relData["amendments"] as TreeObject)["approved_amendments"] !== undefined,
    );
  }

  buildRelationships(parsedHash: TreeObject): IeeeRelationship[] {
    const relationships: IeeeRelationship[] = [];
    if (parsedHash["relationship_type"] !== undefined || parsedHash["relationship_clause"] !== undefined) {
      const rel = this.relationshipFrom(parsedHash);
      if (rel !== undefined) relationships.push(rel);
    }
    if (parsedHash["additional_rels"] !== undefined) {
      const additional = Array.isArray(parsedHash["additional_rels"])
        ? (parsedHash["additional_rels"] as Tree[])
        : [parsedHash["additional_rels"] as Tree];
      for (const relData of additional) {
        if (isObj(relData)) {
          const rel = this.relationshipFrom(relData);
          if (rel !== undefined) relationships.push(rel);
        }
      }
    }
    return relationships;
  }

  // --- supplements and wrappers ----------------------------------------------

  reconstructBaseString(baseData: TreeObject): string {
    const baseParts: string[] = [];
    if (baseData["publishers"] !== undefined) {
      const pubData = asHash(baseData["publishers"] as Tree);
      let publisherStr = extractValue(pubData["publisher"]) ?? "";
      if (pubData["copublishers"] !== undefined && pubData["copublishers"] !== "") {
        const copubs = Array.isArray(pubData["copublishers"])
          ? (pubData["copublishers"] as Tree[])
          : [pubData["copublishers"] as Tree];
        const copubStrs = copubs
          .map((cp) => extractValue(asHash(cp as Tree)["copublisher"]))
          .filter((cp): cp is string => cp !== undefined);
        if (copubStrs.length > 0) publisherStr += `/${copubStrs.join("/")}`;
      }
      baseParts.push(publisherStr);
    }
    if (baseData["type"] !== undefined) {
      baseParts.push(extractValue(baseData["type"]) ?? "");
    }
    let numberStr = extractValue(baseData["number"]) ?? "";
    if (baseData["part"] !== undefined) {
      numberStr += `.${extractValue(baseData["part"]) ?? ""}`;
    }
    if (baseData["subpart"] !== undefined) {
      const subparts = Array.isArray(baseData["subpart"]) ? (baseData["subpart"] as Tree[]) : [baseData["subpart"] as Tree];
      for (const sp of subparts) {
        const v = extractValue(sp);
        if (v !== undefined) numberStr += `.${v}`;
      }
    }
    if (baseData["year"] !== undefined) {
      numberStr += `-${extractValue(baseData["year"]) ?? ""}`;
    }
    baseParts.push(numberStr);
    return baseParts.join(" ");
  }

  buildCorrigendumSupplement(parsedHash: TreeObject): Identifier {
    const base = ieeeParseSingle(this.reconstructBaseString(asHash(parsedHash["base"] as Tree)));
    const corNumber = extractValue(parsedHash["cor_number"]);
    const corYear = extractValue(parsedHash["cor_year"]);
    return new CorrigendumClass({
      base, number: corNumber, year: corYear,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildFlatCorrigendum(parsedHash: TreeObject): Identifier {
    const corData = parsedHash["corrigendum"] as TreeObject;
    const corNumber = extractValue(corData["cor_number"]);
    const corYear = corData["cor_year"] !== undefined ? extractValue(corData["cor_year"]) : undefined;
    const baseHash = { ...parsedHash };
    delete baseHash["corrigendum"];
    const base = this.buildSingleIdentifier(baseHash, false);
    return new CorrigendumClass({
      base, number: corNumber, year: corYear,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildFlatAmendment(parsedHash: TreeObject): Identifier {
    const amdData = parsedHash["amendment"] as TreeObject;
    const amdNumber = extractValue(amdData["amd_number"]);
    const amdYear = amdData["amd_year"] !== undefined ? extractValue(amdData["amd_year"]) : undefined;
    const baseHash = { ...parsedHash };
    delete baseHash["amendment"];
    const base = this.buildSingleIdentifier(baseHash, false);
    return new AmendmentClass({
      base, number: amdNumber, year: amdYear,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildFlatInterpretation(parsedHash: TreeObject): Identifier {
    const intYear = parsedHash["trailing_year"] !== undefined
      ? extractValue(parsedHash["trailing_year"])
      : undefined;
    const baseHash = { ...parsedHash };
    delete baseHash["interpretation"];
    delete baseHash["trailing_month"];
    delete baseHash["trailing_year"];
    const base = this.buildSingleIdentifier(baseHash, false);
    return new InterpretationClass({
      base, year: intYear,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildInterpretationSupplement(parsedHash: TreeObject): Identifier {
    const base = ieeeParseSingle(
      this.reconstructBaseString(asHash(parsedHash["base"] as Tree)),
    );
    const intYear = extractValue(parsedHash["int_year"]);
    return new InterpretationClass({
      base, year: intYear,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildAmendmentSupplement(parsedHash: TreeObject): Identifier {
    const base = ieeeParseSingle(this.reconstructBaseString(asHash(parsedHash["base"] as Tree)));
    return new AmendmentClass({
      base,
      number: extractValue(parsedHash["amd_number"]),
      year: extractValue(parsedHash["amd_year"]),
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildConformanceSupplement(parsedHash: TreeObject): Identifier {
    const base = ieeeParseSingle(this.reconstructBaseString(asHash(parsedHash["base"] as Tree)));
    return new ConformanceClass({
      base,
      number: extractValue(parsedHash["conf_number"]),
      year: extractValue(parsedHash["conf_year"]),
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildJointDevelopment(parsed: TreeObject): Identifier {
    const attributes: Record<string, unknown> = {};

    if (parsed["joint_publishers"] !== undefined) {
      const jointPubStr = extractValue(parsed["joint_publishers"]) ?? "";
      const pubs = jointPubStr.split("/");
      attributes["publishers"] = pubs;
      attributes["publisher"] = pubs[0];
      attributes["copublisher"] = pubs.slice(1);
    }

    const codeParts: string[] = [];
    if (parsed["part"] !== undefined) codeParts.push(extractValue(parsed["part"]) ?? "");
    let codeStr = extractValue(parsed["number"]);
    if (codeStr !== undefined && codeParts.length > 0) {
      codeStr += `.${codeParts.join(".")}`;
    }
    // P = project (a draft): identity-bearing, preserved as spelled.
    if (parsed["project_marker"] !== undefined && codeStr !== undefined) {
      codeStr = `P${codeStr}`;
    }
    if (codeStr !== undefined) {
      const codeObj = IeeeCode.parse(codeStr);
      if (codeObj !== undefined) {
        attributes["number"] = codeObj.number;
        if (codeObj.prefix !== undefined) attributes["prefix"] = codeObj.prefix;
        if (codeObj.parts.length > 0) attributes["parts"] = codeObj.parts;
        if (codeObj.originalSeparator !== undefined) attributes["separator"] = codeObj.originalSeparator;
      }
    }

    if (parsed["year"] !== undefined) {
      attributes["year"] = extractValue(parsed["year"]);
    } else if (parsed["edition_year"] !== undefined) {
      attributes["year"] = extractValue(parsed["edition_year"]);
    }
    if (parsed["month"] !== undefined) attributes["month"] = extractValue(parsed["month"]);
    if (parsed["draft_year"] !== undefined) {
      if (attributes["year"] === undefined) attributes["year"] = extractValue(parsed["draft_year"]);
      if (attributes["month"] === undefined) attributes["month"] = extractValue(parsed["draft_month"]);
    }

    if (parsed["edition"] !== undefined) attributes["edition"] = extractValue(parsed["edition"]);
    if (parsed["edition_month"] !== undefined) {
      attributes["edition_month"] = extractValue(parsed["edition_month"]);
    }

    if (parsed["draft_version"] !== undefined) {
      const draftVer = (extractValue(parsed["draft_version"]) ?? "").replace(/^D/, "");
      if (draftVer !== "") attributes["ieee_draft"] = `D${draftVer}`;
    }

    // The "(E)" edition marker of an ISO/IEC label rides on the joint
    // reference as parenthetical_content - either from the trailing
    // parenthetical slot (the double-label form) or the mid-rule slot
    // before an amendment tail.
    const parenthetical = parsed["parameters"];
    if (parenthetical !== undefined && typeof parenthetical === "object" && !Array.isArray(parenthetical)) {
      const content = (parenthetical as Record<string, unknown>)["parenthetical_content"];
      if (content !== undefined) attributes["parenthetical_content"] = extractValue(content);
    }
    if (attributes["parenthetical_content"] === undefined && parsed["edition_marker"] !== undefined) {
      attributes["parenthetical_content"] = extractValue(parsed["edition_marker"]);
    }

    // The joint stage-draft clause (docs/IEEE-DRAFT-STAGES.md §1.3):
    // variant 1's compound tail composes onto the IEEE ordinal
    // ("D5=DIS.3"); variant 1b is the ordinal-less stage draft whose
    // date rides inside the designator ("D=CDV:2020"). The doubled-D
    // alias spelling echoes as spelled.
    if (parsed["draft_iso_stage"] !== undefined) {
      const stageText = `${extractValue(parsed["draft_stage_d"]) ?? ""}${extractValue(parsed["draft_iso_stage"]) ?? ""}`;
      let jointDraft = parsed["draft_version"] !== undefined
        ? `D${(extractValue(parsed["draft_version"]) ?? "").replace(/^D/, "")}=${stageText}`
        : `D=${stageText}`;
      if (parsed["draft_iso_iteration"] !== undefined) {
        jointDraft += `.${extractValue(parsed["draft_iso_iteration"])}`;
      }
      if (parsed["draft_stage_year"] !== undefined) {
        jointDraft += `:${extractValue(parsed["draft_stage_year"])}`;
      }
      attributes["ieee_draft"] = jointDraft;
    }

    // The catalogue-PRINTED joint form (dash-year / ", Month YYYY" /
    // date-trailing-the-draft / date-less parenthetical): a Standard
    // carrying publisher/copublisher renders it as printed; the colon-year
    // spelling stays the ISO-style JointDevelopment. Stage-WORD drafts
    // (letters, not a D-number) stay joint - their canonical renders drop
    // the P and keep the joint spelling.
    const numericDraft = parsed["draft_version"] !== undefined &&
      /^\d/.test(extractValue(parsed["draft_version"]) ?? "");
    if (
      parsed["iso_published"] !== undefined &&
      (parsed["printed_dash_year"] !== undefined || parsed["printed_month_year"] !== undefined ||
        (numericDraft && parsed["draft_month"] !== undefined) ||
        (parsed["year"] === undefined && parsed["parameters"] !== undefined &&
          typeof parsed["parameters"] === "object" && !Array.isArray(parsed["parameters"]) &&
          (parsed["parameters"] as TreeObject)["parenthetical_content"] !== undefined))
    ) {
      const sep = parsed["part_dash"] !== undefined ? "-" : ".";
      let printedCode = [extractValue(parsed["number"]), extractValue(parsed["part"])]
        .filter((x) => x !== undefined).join(sep);
      // P = project: the marker is identity, preserved as spelled.
      if (parsed["project_marker"] !== undefined) printedCode = `P${printedCode}`;
      const printedAttrs: Record<string, unknown> = {
        publisher: attributes["publisher"],
        copublisher: attributes["copublisher"],
        typed_stage: locateStage("Std") !== undefined ? new IeeeTypedStage(locateStage("Std")!) : undefined,
      };
      let printedDraft = attributes["ieee_draft"] as string | undefined;
      let finalCode = printedCode;
      if (parsed["printed_dash_year"] !== undefined && parsed["month"] !== undefined) {
        // A dash-year-month date glues onto the printed code before any
        // draft - the render's month slot would lose the printed form.
        finalCode = `${printedCode}-${attributes["year"]}-${attributes["month"]}`;
      } else if (parsed["printed_dash_year"] !== undefined) {
        // A bare dash-year is the identity year - an attribute.
        printedAttrs["year"] = attributes["year"];
      } else if (parsed["printed_month_year"] !== undefined) {
        printedAttrs["year"] = attributes["year"];
        printedAttrs["month"] = attributes["month"];
      } else if (parsed["draft_month"] !== undefined) {
        // The date trails the draft itself; keep it inside the draft so
        // the code stays date-less.
        printedDraft = `${printedDraft}, ${extractValue(parsed["draft_month"])} ${extractValue(parsed["draft_year"])}`;
      }
      const codeObj = IeeeCode.parse(finalCode);
      if (codeObj !== undefined) {
        printedAttrs["number"] = codeObj.number;
        if (codeObj.prefix !== undefined) printedAttrs["prefix"] = codeObj.prefix;
        if (codeObj.parts.length > 0) printedAttrs["parts"] = codeObj.parts;
        if (codeObj.originalSeparator !== undefined) printedAttrs["separator"] = codeObj.originalSeparator;
      }
      if (printedDraft !== undefined) printedAttrs["draft"] = printedDraft;
      if (attributes["edition"] !== undefined) printedAttrs["edition"] = attributes["edition"];
      if (attributes["edition_month"] !== undefined) printedAttrs["edition_month"] = attributes["edition_month"];
      const params = parsed["parameters"] as TreeObject | undefined;
      if (params !== undefined && typeof params === "object" && !Array.isArray(params) &&
          params["parenthetical_content"] !== undefined) {
        printedAttrs["parenthetical_content"] = extractValue(params["parenthetical_content"]);
      }
      for (const k of Object.keys(printedAttrs)) {
        if (printedAttrs[k] === undefined) delete printedAttrs[k];
      }
      return new StandardClass(printedAttrs as unknown as Record<string, unknown>) as unknown as Identifier;
    }

    if (parsed["iso_stage"] !== undefined) {
      attributes["lead_party"] = "ISO";
      const stageAbbr = extractValue(parsed["iso_stage"]);
      attributes["iso_stage"] = stageAbbr;
      if (stageAbbr !== undefined) {
        const record = locateStage(stageAbbr);
        if (record !== undefined) attributes["typed_stage"] = new IeeeTypedStage(record);
      }
    } else if (parsed["iso_published"] !== undefined) {
      attributes["lead_party"] = "ISO";
    } else {
      attributes["lead_party"] = "IEEE";
      attributes["type"] = "P";
      const record = locateStage("P");
      if (record !== undefined) attributes["typed_stage"] = new IeeeTypedStage(record);
    }

    const joint = new JointDevelopmentClass(attributes) as unknown as Identifier;
    if (parsed["amd_number"] === undefined) return joint;

    const amdYear = parsed["amd_year"] !== undefined ? extractValue(parsed["amd_year"]) : undefined;
    return new AmendmentClass({
      base: joint,
      number: extractValue(parsed["amd_number"]),
      year: amdYear,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildSiPsi(parsed: TreeObject): Identifier {
    const attributes: Record<string, unknown> = {};
    const siType = extractValue(parsed["si_type"]);

    if (parsed["publishers"] !== undefined) {
      const publishersStr = extractValue(parsed["publishers"]) ?? "";
      const pubs = publishersStr.split("/");
      attributes["publisher"] = pubs[0];
      if (pubs.length > 1) attributes["copublisher"] = pubs.slice(1);
    }

    const codeStr = extractValue(parsed["number"]);
    if (codeStr !== undefined) {
      const codeObj = IeeeCode.parse(codeStr);
      if (codeObj !== undefined) {
        attributes["number"] = codeObj.number;
        if (codeObj.prefix !== undefined) attributes["prefix"] = codeObj.prefix;
        if (codeObj.parts.length > 0) attributes["parts"] = codeObj.parts;
        if (codeObj.originalSeparator !== undefined) attributes["separator"] = codeObj.originalSeparator;
      }
    }

    const stageRecord = SI_STAGES.find((ts) => siType !== undefined && ts.abbr.includes(siType));
    if (stageRecord !== undefined) attributes["typed_stage"] = new IeeeTypedStage(stageRecord);
    if (siType === "PSI" && parsed["draft_version"] !== undefined) {
      attributes["draft"] = new IeeeDraft({ version: extractValue(parsed["draft_version"]) ?? "" }).render();
    }

    if (parsed["year"] !== undefined) attributes["year"] = extractValue(parsed["year"]);
    if (parsed["month"] !== undefined) attributes["month"] = extractValue(parsed["month"]);

    if (parsed["relationship_type"] !== undefined || parsed["relationship_clause"] !== undefined) {
      attributes["relationships"] = this.buildRelationships(parsed);
    }
    this.handleParameters(parsed, attributes);

    return new SiStandardClass(attributes) as unknown as Identifier;
  }

  buildMultiNumbered(parsed: TreeObject): Identifier {
    const primaryId = this.buildSingleIdentifier(asHash(parsed["primary_identifier"] as Tree), false);
    let secondaryId: unknown;
    if (parsed["secondary_crossref"] !== undefined) {
      const crossref = extractValue(parsed["secondary_crossref"]) ?? "";
      secondaryId = new StandardClass({
        publisher: "IEEE",
        number: crossref.replace(/^\//, ""),
      });
    } else if (parsed["secondary_joint"] !== undefined) {
      secondaryId = this.buildSingleIdentifier(asHash(parsed["secondary_joint"] as Tree), true);
    }
    return new MultiNumberedClass({
      primary_identifier: primaryId,
      secondary_identifier: secondaryId,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildCsaDualPublished(parsed: TreeObject): Identifier {
    const ieeeId = this.buildSingleIdentifier(asHash(parsed["ieee_portion"] as Tree), false) as IeeeIdentifier;
    // The CSA portion normalizes "No." to the catalogue's "NO." spelling
    // (the Ruby CSA component uppercases it) so every alias renders the
    // same canonical form.
    const csaString = (extractValue(parsed["csa_portion"]) ?? "").replace(/\bNo\./, "NO.");
    return new CsaDualPublishedClass({
      ieee_identifier: ieeeId,
      csa_string: csaString,
      year: ieeeId.year,
      typed_stage: ieeeId.typed_stage,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildSDesignation(parsed: TreeObject): Identifier {
    const attributes: Record<string, unknown> = {
      number: extractValue(parsed["s_number"]),
      publisher: extractValue(parsed["publisher"]) ?? "IEEE",
      type: "Std",
    };
    const stdRecord = locateStage("Std");
    if (stdRecord !== undefined) attributes["typed_stage"] = new IeeeTypedStage(stdRecord);
    if (parsed["ipcea_copub"] !== undefined) {
      attributes["crossref"] = extractValue(parsed["ipcea_copub"]);
    }
    this.handleParameters(parsed, attributes);
    return new StandardClass(attributes) as unknown as Identifier;
  }

  buildCombinedAiee(parsed: TreeObject): Identifier {
    const firstId = this.buildAiee(asHash(parsed["first_aiee"] as Tree));
    const secondId = this.buildAiee(asHash(parsed["second_aiee"] as Tree));
    return new DualPublishedClass({
      first_identifier: firstId,
      second_identifier: secondId,
    } as unknown as Record<string, unknown>) as unknown as Identifier;
  }

  buildIecIeeCopublished(parsed: TreeObject): Identifier {
    const content = extractValue(parsed["content"]);
    let copublishedNumber: string | undefined;
    let draftInfo: string | undefined;
    let iecYear: string | undefined;
    let dateInfo: string | undefined;

    if (content !== undefined) {
      if (content.includes("IEC:")) {
        copublishedNumber = content.split(" IEC:")[0]?.trim();
      } else if (content.includes(", ")) {
        copublishedNumber = content.split(", ")[0]?.trim();
      } else if (content.includes(" (")) {
        copublishedNumber = content.split(" (")[0]?.trim();
      } else {
        copublishedNumber = content.trim();
      }

      if (copublishedNumber !== undefined && copublishedNumber.includes("/D")) {
        const parts = copublishedNumber.split("/D");
        copublishedNumber = parts[0];
        draftInfo = `/D${parts[1] ?? ""}`;
      }

      if (content.includes("IEC:")) {
        const iecPart = content.split("IEC:")[1];
        if (iecPart !== undefined) iecYear = iecPart.split(" ")[0];
      }

      if (content.includes(" (")) {
        const datePart = content.split(" (")[1];
        if (datePart !== undefined && datePart.includes(")")) {
          dateInfo = datePart.split(")")[0];
        }
      }
    }

    const attrs: Record<string, unknown> = {};
    if (draftInfo !== undefined) attrs["draft_info"] = draftInfo;
    if (iecYear !== undefined) attrs["iec_year"] = iecYear;
    if (dateInfo !== undefined) attrs["date_info"] = dateInfo;
    Object.assign(attrs, copublishedStructured(copublishedNumber));
    return new IecIeeeCopublishedClass(attrs) as unknown as Identifier;
  }

  // --- AIEE / IRE / NESC builders ---------------------------------------------

  buildAiee(parsed: TreeObject): Identifier {
    const attributes: Record<string, unknown> = { publisher: "AIEE" };
    const typeStr = extractValue(parsed["type"]);
    attributes["type"] = typeStr !== undefined && typeStr.startsWith("Standard") ? "No" : typeStr;

    const numberValue = parsed["number"];
    let codeStr: string | undefined;
    if (isObj(numberValue)) {
      const main = extractValue((numberValue as TreeObject)["main_number"]);
      const paren = (numberValue as TreeObject)["parenthetical"];
      const alt = isObj(paren) ? extractValue((paren as TreeObject)["alt_number"]) : undefined;
      codeStr = alt !== undefined && main !== undefined ? `${main} (${alt})` : main;
    } else {
      codeStr = extractValue(numberValue);
    }
    if (codeStr !== undefined) {
      const codeObj = IeeeCode.parse(codeStr);
      if (codeObj !== undefined) {
        attributes["number"] = codeObj.number;
        if (codeObj.prefix !== undefined) attributes["prefix"] = codeObj.prefix;
        if (codeObj.parts.length > 0) attributes["parts"] = codeObj.parts;
        if (codeObj.originalSeparator !== undefined) attributes["separator"] = codeObj.originalSeparator;
      }
    }

    attributes["year"] = extractValue(parsed["year"]);
    const monthStr = extractValue(parsed["month"]);
    if (monthStr !== undefined) attributes["month"] = monthStr;
    const separatorStr = extractValue(parsed["separator"]);
    if (separatorStr !== undefined) attributes["date_separator"] = separatorStr;
    attributes["original_format"] = separatorStr !== undefined || monthStr !== undefined ? "long" : "short";
    return new AieeClass(attributes) as unknown as Identifier;
  }

  buildIre(parsed: TreeObject): Identifier {
    const attributes: Record<string, unknown> = {};
    attributes["publisher"] = extractValue(parsed["publisher"]);
    attributes["type"] = extractValue(parsed["type"]);
    const numberStr = extractValue(parsed["number"]);
    if (numberStr !== undefined) {
      const codeObj = IeeeCode.parse(numberStr);
      if (codeObj !== undefined) {
        attributes["number"] = codeObj.number;
        if (codeObj.prefix !== undefined) attributes["prefix"] = codeObj.prefix;
        if (codeObj.parts.length > 0) attributes["parts"] = codeObj.parts;
        if (codeObj.originalSeparator !== undefined) attributes["separator"] = codeObj.originalSeparator;
      }
    }
    const yearStr = extractValue(parsed["year"]);
    if (yearStr !== undefined) {
      const yearInt = Number.parseInt(yearStr, 10);
      attributes["year"] = String(yearInt >= 12 && yearInt <= 63 ? yearInt + 1900 : yearInt);
    }
    const fullYearStr = extractValue(parsed["full_year"]);
    if (fullYearStr !== undefined) attributes["year"] = String(Number.parseInt(fullYearStr, 10));
    return new IreClass(attributes) as unknown as Identifier;
  }

  buildNesc(parsedHash: TreeObject): Identifier {
    // Ruby falls through the variant case on a non-matching value (the
    // nested name_first variant captures as a hash) and reaches Standard
    // via the code check; Edition is only the no-code fallback.
    let klass: (new (attrs?: Record<string, unknown>) => unknown) = NescEditionClass;
    if (parsedHash["draft"] !== undefined) {
      klass = NescDraftClass;
    } else if (typeof parsedHash["variant"] === "string") {
      const variant = parsedHash["variant"];
      if (variant === "Handbook") klass = NescHandbookClass;
      else if (variant === "Redline") klass = NescRedlineClass;
    }
    if (klass === NescEditionClass && parsedHash["code"] !== undefined) {
      klass = NescStandardClass;
    }

    const attrs: Record<string, unknown> = { code: parsedHash["code"] ?? "C2" };
    const codeObj = IeeeCode.parse(String(attrs["code"]));
    if (codeObj !== undefined) {
      attrs["number"] = codeObj.number;
      if (codeObj.prefix !== undefined) attrs["prefix"] = codeObj.prefix;
      if (codeObj.parts.length > 0) attrs["parts"] = codeObj.parts;
    }
    if (parsedHash["year"] !== undefined) attrs["year"] = String(parsedHash["year"]);
    if (parsedHash["variant"] !== undefined) attrs["variant"] = String(parsedHash["variant"]);
    if (parsedHash["edition"] !== undefined) attrs["edition"] = String(parsedHash["edition"]);
    if (parsedHash["month"] !== undefined) attrs["month"] = String(parsedHash["month"]);
    if (parsedHash["name_registered"] !== undefined || parsedHash["abbr_registered"] !== undefined) {
      attrs["registered"] = true;
    }
    if (parsedHash["paren_abbr"] !== undefined) {
      attrs["abbr_suffix"] = true;
      if (parsedHash["paren_registered"] !== undefined) attrs["abbr_suffix_registered"] = true;
    }
    return new klass(attrs) as unknown as Identifier;
  }
}

function copublishedStructured(copublishedNumber: string | undefined): Record<string, unknown> {
  if (copublishedNumber === undefined || copublishedNumber === "") return {};
  const attrs: Record<string, unknown> = {};

  let remainder = copublishedNumber;
  let year: string | undefined;
  let yearSep: string | undefined;
  const yearMatch = /([-:])((?:19|20)\d\d)$/.exec(copublishedNumber);
  if (yearMatch !== null) {
    yearSep = yearMatch[1];
    year = yearMatch[2];
    remainder = copublishedNumber.slice(0, copublishedNumber.length - yearSep!.length - year!.length);
  }

  const all = remainder.match(/^[^.\-]+|[.\-][^.\-]+/g) ?? [];
  const parts: string[] = [];
  const separators: string[] = [];
  for (const token of all.slice(1)) {
    parts.push(token.slice(1));
    separators.push(token[0] ?? "");
  }
  attrs["number"] = all[0];
  if (parts.length > 0) {
    attrs["parts"] = parts;
    attrs["separators"] = separators;
  }
  if (year !== undefined) {
    attrs["year"] = year;
    if (yearSep !== "-") attrs["year_sep"] = yearSep;
  }
  return attrs;
}

// --- parse orchestration -------------------------------------------------------

function ieeeParseSingle(input: string): Identifier {
  const normalized = applyUpdateCodes(input);
  // UpdateCodes may introduce the "; " double-label separator (the
  // ISO/IEC and IEEE labels of one document), but the dispatch ran on
  // the raw input - re-dispatch so the dual construction sees it.
  if (normalized !== input && normalized.includes("; ")) {
    const re = preParse(normalized);
    if (re.dispatch === "dual_semicolon") return buildDual(re.parts);
  }
  const cleaned = preprocessIeee(normalized);
  const tree = parseGrammar(ieeeGrammar, cleaned);
  const builder = new IeeeBuilder();
  builder.originalInput = input;
  return builder.build(tree);
}

// The aiee_simple fallback parses WITHOUT the legacy update-codes table -
// the Ruby reference routes "AIEE …" to the AIEE sub-parser only, so an
// update-codes rewrite (e.g. "AIEE Nos 72 and 73 - 1932") must not make
// a line parse that the reference rejects.
function ieeeParseSingleNoCodes(input: string): Identifier {
  const tree = parseGrammar(ieeeGrammar, preprocessIeee(input));
  const builder = new IeeeBuilder();
  builder.originalInput = input;
  return builder.build(tree);
}

// The aiee_simple fallback parses WITHOUT the legacy update-codes table -
// the Ruby reference routes "AIEE …" to the AIEE sub-parser only, so an
// update-codes rewrite (e.g. "AIEE Nos 72 and 73 - 1932") must not make
// a line parse that the reference rejects.
function parseAieeDirect(input: string): Identifier {
  const builder = new IeeeBuilder();
  builder.originalInput = input;
  const tree = parseGrammar({ rules: ieeeGrammar.rules, root: "aiee_identifier" }, input);
  return builder.buildAiee(asHash(tree as Tree));
}

function normalizeIecAdoption(part: string): string {
  return part
    .replace(/\s+Edition\s+([0-9.]+)\s+([0-9-]+)/, ":$2 ED$1")
    .replace(/\s+Edition\s+([0-9.]+)\s*$/, " ED$1");
}

function buildDual(parts: string[]): Identifier {
  const first = ieeeParseSingle(parts[0]!);
  const second = ieeeParseSingle(parts[1]!);
  return new DualPublishedClass({
    first_identifier: first,
    second_identifier: second,
  } as unknown as Record<string, unknown>) as unknown as Identifier;
}

function buildReaffirmed(input: string, reaffirmed: string): Identifier {
  const parsed = ieeeParseSingle(input);
  (parsed as unknown as Record<string, unknown>)["reaffirmed"] = reaffirmed;
  return parsed;
}

function buildDualWithReaffirmed(parts: string[], reaffirmed: string): Identifier {
  const ieeeId = ieeeParseSingle(parts[0]!);
  (ieeeId as unknown as Record<string, unknown>)["reaffirmed"] = reaffirmed;
  const ireId = ieeeParseSingle(parts[1]!);
  return new DualPublishedClass({
    first_identifier: ieeeId,
    second_identifier: ireId,
  } as unknown as Record<string, unknown>) as unknown as Identifier;
}

function parseAdoptedPart(part: string): Identifier {
  if (part.startsWith("IEC")) {
    const impl = grammarImplementation("iec");
    if (impl === undefined) throw new ParseFailed("IEC implementation unavailable", 0);
    return impl.parse(normalizeIecAdoption(part));
  }
  if (part.startsWith("ANSI")) {
    const impl = grammarImplementation("ansi");
    if (impl === undefined) throw new ParseFailed("ANSI implementation unavailable", 0);
    return impl.parse(part);
  }
  return ieeeParseSingle(part);
}

function buildAdopted(parts: string[]): Identifier {
  const ieeeId = ieeeParseSingle(parts[0]!);
  const adoptedParts = parts[1]!.split(",").map((p) => p.trim());
  const adoptedIds = adoptedParts.map(parseAdoptedPart);
  const AdoptedClass = AdoptedStandardClass;
  return new AdoptedClass({
    ieee_identifier: ieeeId,
    adopted_identifiers: adoptedIds,
  } as unknown as Record<string, unknown>) as unknown as Identifier;
}

// A sentinel for "the reference rejects this line outright" - distinct from
// ParseFailed so ieeeParse's blanket retry (load-bearing for other forms)
// does not resurrect it.
class RejectedOutright extends Error {}

export function ieeeParse(input: string): Identifier {
  try {
    return ieeeParseDispatched(input);
  } catch (e) {
    if (e instanceof ParseFailed && !(e instanceof RejectedOutright)) return ieeeParseSingle(input);
    if (e instanceof RejectedOutright) throw new ParseFailed(e.message, 0);
    throw e;
  }
}

function ieeeParseDispatched(input: string): Identifier {
  const result = preParse(input);
  switch (result.dispatch) {
    case "aiee_simple":
      // Ruby: Aiee::Identifier.parse, with the WHOLE parse falling back to
      // parse_single on ParseFailed (forms the AIEE sub-grammar rejects,
      // e.g. "AIEE 15-May 1928", parse through the generic bucket).
      try {
        return parseAieeDirect(result.input);
      } catch {
        // Ruby: Aiee::Identifier.parse with no retry - an update-codes
        // rewrite must not make an AIEE-form line parse that the
        // reference rejects ("AIEE Nos 72 and 73 - 1932").
        try {
          return ieeeParseSingleNoCodes(input);
        } catch {
          throw new RejectedOutright(input);
        }
      }
    case "iec_ieee_copublished":
    case "dual_semicolon":
    case "dual_space_separated":
      if (result.dispatch === "dual_semicolon" || result.dispatch === "dual_space_separated") {
        return buildDual(result.parts);
      }
      try {
        return ieeeParseSingle(result.input);
      } catch {
        return ieeeParseSingle(input);
      }
    case "dual_reaffirmed":
      return buildReaffirmed(result.input, result.metadata["reaffirmed"] ?? "");
    case "dual_ire":
      return buildDualWithReaffirmed(result.parts, result.metadata["reaffirmed"] ?? "");
    case "dual_and":
    case "dual_ampersand":
      return buildDual(result.parts);
    case "aiee_asa_adoption": {
      const aieeId = ieeeParseSingle(result.parts[0]!);
      const asaId = ieeeParseSingle(result.parts[1]!);
      const AdoptedClass = AdoptedStandardClass;
      return new AdoptedClass({
        ieee_identifier: aieeId,
        adopted_identifiers: [asaId],
      } as unknown as Record<string, unknown>) as unknown as Identifier;
    }
    case "adopted":
      return buildAdopted(result.parts);
    default:
      try {
        return ieeeParseSingle(result.input);
      } catch {
        return ieeeParseSingle(input);
      }
  }
}

export function ieeeGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return ieeeParse(input);
    },
  };
}
