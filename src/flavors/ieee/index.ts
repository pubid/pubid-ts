import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import { artifactToBuilderTree } from "./artifact_tree.js";
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
  NescPreprintClass,
  NescRedlineClass,
  NescStandardClass,
  DRAFT_MONTH_NAMES,
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
    this.normalizeDraftDashYear(d);

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

  // The artifact binds a dash-year draft tail as a second draft element
  // ({draft_version: {dash_year: ...}}); the reference's builder hoists
  // the dash fields and rejoins the version ("D9-2006", "/DPub2-2012").
  normalizeDraftDashYear(d: TreeObject): void {
    const raw = d["draft"];
    if (raw === undefined) return;
    const drafts = Array.isArray(raw) ? raw : [raw];
    // The compound-stage captures nest inside the draft elements (the
    // artifact's binding); the hand mirror bound them top-level, so the
    // joint-designator block reads them from `parsed` directly.
    for (const key of ["draft_iso_stage", "draft_iso_iteration", "draft_stage_d", "draft_stage_year"] as const) {
      if (d[key] === undefined) {
        for (const e of drafts) {
          if (isObj(e) && e[key] !== undefined) {
            d[key] = e[key];
            break;
          }
        }
      }
    }
    for (const e of drafts) {
      if (!isObj(e)) continue;
      const dv = e["draft_version"];
      if (!isObj(dv)) continue;
      if (dv["dash_year"] !== undefined) e["dash_year"] = dv["dash_year"];
      if (dv["dash_month"] !== undefined) e["dash_month"] = dv["dash_month"];
      delete e["draft_version"];
    }
    // A numeric month trailing a draft is the draft's own date: it embeds
    // in the designator ("D09, 04 2011" -> "D09-2011-04") rather than
    // printing the long-format comma face (a month name keeps the comma,
    // "D7.2, Nov 2006") - pubid ruling 2026-10-13.
    if (d["dash_year"] === undefined && d["draft"] !== undefined) {
      const m = d["month"] ?? d["trailing_month"];
      const y = d["year"] ?? d["trailing_year"];
      const mVal = extractValue(m as Tree);
      const yVal = extractValue(y as Tree);
      if (mVal !== undefined && /^\d{1,2}$/.test(String(mVal)) && yVal !== undefined) {
        const host = drafts.find((e) => isObj(e) && e["draft_version"] !== undefined);
        if (host !== undefined && isObj(host)) {
          const hv = host["draft_version"];
          const joined = Array.isArray(hv)
            ? hv.map((v) => (isObj(v) ? ((v["value"] as string) ?? "") : String(v))).join("")
            : String(extractValue(hv as Tree) ?? "");
          host["draft_version"] = [joined, String(yVal), String(mVal)]
            .filter((s) => s !== "")
            .join("-");
          delete d["month"];
          delete d["year"];
          delete d["trailing_month"];
          delete d["trailing_year"];
        }
      }
    }
    const dash = drafts.find((e) => isObj(e) && e["dash_year"] !== undefined) ??
      (d["dash_year"] !== undefined ? d : undefined);
    if (dash === undefined) return;
    const objs = drafts.filter(isObj);
    const joined = objs
      .map((e) => e["draft_version"])
      .filter((v) => v !== undefined)
      .map((v) => (isObj(v) ? ((v["value"] as string) ?? "") : String(v)))
      .join("");
    const bareJointDraft = d["joint_publishers"] !== undefined &&
      d["part"] === undefined && d["iso_stage"] === undefined &&
      objs.some((e) => e["draft_version"] !== undefined);
    const dashLed = joined.startsWith("-");
    const dashYear = extractValue((dash as TreeObject)["dash_year"] as Tree);
    const dashMonth = (dash as TreeObject)["dash_month"];
    if (bareJointDraft && dashLed) {
      d["part"] = dashYear;
    } else if (dashMonth !== undefined || dashLed) {
      // A dash_month beside a draft host is the draft's own date
      // ("/R-i-2011-04" -> "D09-2011-04"); with no host it is the
      // identifier's year/month.
      const host = objs.find((e) => e["draft_version"] !== undefined);
      const dm = extractValue(dashMonth as Tree);
      if (dm !== undefined && host !== undefined) {
        const hv = host["draft_version"];
        const joined = Array.isArray(hv)
          ? hv.map((v) => (isObj(v) ? ((v["value"] as string) ?? "") : String(v))).join("")
          : String(extractValue(hv as Tree) ?? "");
        host["draft_version"] = [joined, dashYear, String(dm)].join("-");
        delete (dash as TreeObject)["dash_year"];
        delete (dash as TreeObject)["dash_month"];
      } else if (d["year"] === undefined) {
        d["year"] = dashYear;
        d["month"] = dm;
      }
    } else {
      const host = objs.find((e) => e["draft_version"] !== undefined);
      if (host !== undefined) {
        host["draft_version"] = `${joined}-${dashYear}`;
        delete (dash as TreeObject)["dash_year"];
        delete (dash as TreeObject)["dash_month"];
      } else if (d["year"] === undefined) {
        d["year"] = dashYear;
        d["month"] = extractValue(dashMonth as Tree);
      }
    }
  }

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
    // The ORDINAL-LESS D= designator on a multi-publisher row is the
    // joint compound form ("ISO/IEC/IEEE P16326:2017/D=WD.4a"); the
    // ordinal compound ("D8=DIS.3") is a project draft whatever the
    // publishers — the D-ordinal is the draft, the stage the target.
    if (parsedHash["draft_iso_stage"] !== undefined) {
      const draftHash = parsedHash["draft"] !== undefined
        ? asHash(parsedHash["draft"] as Tree)
        : undefined;
      const hasOrdinal = extractValue(parsedHash["draft_version"]) !== undefined ||
        extractValue(draftHash?.["draft_version"] as Tree) !== undefined;
      if (!hasOrdinal) {
        const pubData = parsedHash["publishers"] !== undefined
          ? asHash(parsedHash["publishers"] as Tree)
          : undefined;
        const copubs = pubData?.["copublishers"] !== undefined
          ? (Array.isArray(pubData["copublishers"]) ? (pubData["copublishers"] as Tree[]) : [pubData["copublishers"] as Tree])
          : [];
        if (copubs.length > 0) return this.buildJointDevelopment(parsedHash);
      }
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
      // The P is identity on a non-IEEE-led publisher too (the C1
      // ruling): record the marker so the render prepends it —
      // "ANSI PN42.34/D9a, 2015" round-trips.
      attributes["project_marker"] = true;
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
      // Captures carry their own separator when present (the artifact's
      // part/subpart bind ".18" / "-10"); bare tokens fall back to the
      // hand grammar's part_sep. Joins verbatim like the reference's
      // extract_attributes — a dashed "62271-37-082" stays dashed.
      const partSep = extractValue(parsed["part_sep"]) ?? ".";
      codeStr += codeParts.map((cp) => /^[._-]/.test(cp) ? cp : `${partSep}${cp}`).join("");
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
    // The canonical type word is the short form (C2 ruling):
    // "IEEE Standard 495-2007" and "IEEE Std 495-2007" are the same
    // identifier. A DRAFT type word never reaches the wire (the
    // draft-ness rides draft_status + the draft component; "Draft Std"
    // is banned from canonical output) - it still feeds
    // determineStageAbbr below (the version-less D1 fabrication).
    if (typeValue === "Standard") typeValue = "Std";
    if (typeValue !== undefined && !/^Draft/.test(typeValue)) attributes["type"] = typeValue;

    const typedStageAbbr = this.determineStageAbbr(typeValue, parsed);
    if (typedStageAbbr !== undefined) {
      const record = locateStage(typedStageAbbr);
      if (record !== undefined) attributes["typed_stage"] = new IeeeTypedStage(record);
    }

    attributes["draft_status"] = draftStatusValue;

    for (const key of ["edition", "revision", "rev_sep"] as const) {
      const value = extractValue(parsed[key]);
      if (value !== undefined) attributes[key] = value;
    }
    if (parsed["rev_bare"] !== undefined) attributes["rev_bare"] = true;
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

    // Glued identity year-month provenance (gem#520): the input tail is
    // the glued "-YYYY-MM" on a draft-free, revision-free identity.
    if (attributes["month"] !== undefined && attributes["year"] !== undefined &&
        attributes["draft"] === undefined && attributes["revision"] === undefined &&
        /-\d{4}-\d{2}$/.test(this.originalInput ?? "")) {
      attributes["month_glued"] = true;
    }

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
          // relaton's hyphenated "/D-2" spelling captures the dash inside
          // draft_version; the stage registry keys on "D2". A date-embedded
          // version ("3-2017-07") keys on its leading ordinal.
          const draftAbbr = `D${version.replace(/^-/, "").replace(/-\d{4}(-\d{2})?$/, "")}`;
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
      // FDIS/CDV/… are ISO/IEC stage tokens, not draft ordinals (C1
      // ruling, testsuite#2). "/DDIS" and "/DFDIS" are hallucinated
      // concatenations — the designator D does not merge onto a stage
      // word. The draft of a stage rides the iso_stage slot, which
      // Draft#to_s renders as the D= designator face ("…/D=DIS-2020").
      if (version !== undefined && /^(FDIS|FCD|CDV|DIS|CD|WD|PWI|NP)$/.test(version)) {
        isoStage = version;
        version = undefined;
      }
      month = extractValue(draftData["month"]);
      year = extractValue(draftData["year"]);
      // The apostrophe-year catalogue convention ("P1484.20.1/D7,
      // May 07"): the 2-digit year expands with the <30 pivot so the
      // hash carries an unambiguous year (the reference's builder).
      if (year !== undefined && /^\d{2}$/.test(year)) {
        year = `${Number(year) < 30 ? 20 : 19}${year}`;
      }
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

    // A REV-carrying draft embeds its print date into the designator
    // with the month canonicalized numeric (pubid ruling 2026-10-14):
    // "P802.11-REVmc/D8.0, Aug 2016" renders ".../D8.0-2016-08".
    // Drafts without a REV keep the comma face.
    if (
      (attributes["revision"] !== undefined || attributes["rev_bare"] === true) &&
      month !== undefined && year !== undefined && version !== undefined
    ) {
      const monthNumber = DRAFT_MONTH_NAMES[String(month).replace(/\.$/, "")];
      if (monthNumber !== undefined) {
        // The canonical face zero-pads ("D8.0-2016-08"), matching the
        // reference's REV_MONTH_NUMBERS.
        version = `${version}-${year}-${monthNumber.padStart(2, "0")}`;
        month = year = day = undefined;
      }
    }

    if (version !== undefined || isoStage !== undefined ||
        (isObj(draftData) && draftData["draft_iso_stage"] !== undefined)) {
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
    // The reference stores the fabricated designator comma-joined with the
    // identity year ("D1, 2012" — the gem's Draft#to_s), not space-joined.
    attributes["draft"] = attributes["year"] === undefined
      ? "D1"
      : `D1, ${attributes["year"]}`;
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
    const baseSep = extractValue(baseData["part_sep"]) ?? ".";
    if (baseData["part"] !== undefined) {
      const pv = extractValue(baseData["part"]) ?? "";
      numberStr += /^[._-]/.test(pv) ? pv : `${baseSep}${pv}`;
    }
    if (baseData["subpart"] !== undefined) {
      const subparts = Array.isArray(baseData["subpart"]) ? (baseData["subpart"] as Tree[]) : [baseData["subpart"] as Tree];
      for (const sp of subparts) {
        const v = extractValue(sp);
        if (v !== undefined) numberStr += /^[._-]/.test(v) ? v : `${baseSep}${v}`;
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
    } else if (parsed["publishers"] !== undefined) {
      // Stage-bearing rows the artifact routes without a
      // joint_publishers capture ("ISO/IEC/IEEE P26511/D8=DDIS.3"):
      // the publishers hash carries the same information.
      const pubData = asHash(parsed["publishers"] as Tree);
      const lead = extractValue(pubData["publisher"]) ?? "";
      const copubs = pubData["copublishers"] !== undefined
        ? (Array.isArray(pubData["copublishers"])
          ? (pubData["copublishers"] as Tree[])
          : [pubData["copublishers"] as Tree])
            .map((cp) => extractValue(asHash(cp as Tree)["copublisher"]))
            .filter((cp): cp is string => cp !== undefined)
        : [];
      attributes["publishers"] = [lead, ...copubs];
      attributes["publisher"] = lead;
      attributes["copublisher"] = copubs;
    }

    const codeParts: string[] = [];
    if (parsed["part"] !== undefined) codeParts.push(extractValue(parsed["part"]) ?? "");
    // The part/subpart captures carry their printed separator
    // (separator-in-capture); the subpart rides after the part
    // ("P65700.19.03", "60079-30-2" — the reference's joint code
    // assembly).
    if (parsed["subpart"] !== undefined) {
      const subs = Array.isArray(parsed["subpart"]) ? (parsed["subpart"] as Tree[]) : [parsed["subpart"] as Tree];
      for (const sp of subs) codeParts.push(extractValue(sp) ?? "");
    }
    let codeStr = extractValue(parsed["number"]);
    if (codeStr !== undefined && codeParts.length > 0) {
      // The ISO/IEC label's part may be dash-joined ("8802-9") - keep the
      // printed separator. Separator-carrying captures (the artifact's
      // part binds ".2") join verbatim.
      const sep = parsed["iec_label_dash"] !== undefined ? "-" : ".";
      codeStr += codeParts.map((cp) => /^[._-]/.test(cp) ? cp : `${sep}${cp}`).join("");
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

    // The IEEE-led tail word-stage ("IEEE/ISO/IEC P15026-3/CD,
    // December 2021") composes the D= designator with the glued
    // 6-digit date — the identity its D= twin spelling parses to (the
    // corpus canonical: joint-development, lead IEEE, stage P). The
    // ISO-led lists converge to the published-Std identity (the issue
    // #216 semantics). The zero-width printed_month_year capture
    // carries "" — truthy in the reference (nil-check), falsy in JS:
    // test presence, not truth.
    if (parsed["tail_iso_stage"] !== undefined &&
        parsed["printed_month_year"] !== undefined &&
        parsed["part"] !== undefined) {
      const stage = extractValue(parsed["tail_iso_stage"]);
      const year = extractValue(parsed["year"]) ?? "";
      const monthName = (extractValue(parsed["month"]) ?? "").replace(/\.$/, "");
      const monthNum = DRAFT_MONTH_NAMES[monthName];
      if (stage !== undefined && monthNum !== undefined) {
        attributes["ieee_draft"] = `D=${stage}-${year}${monthNum.padStart(2, "0")}`;
        parsed["year"] = undefined;
        parsed["month"] = undefined;
        parsed["printed_month_year"] = undefined;
        delete attributes["year"];
        delete attributes["month"];
        // The ISO-led lists converge to the published-Std identity; the
        // IEEE-led lists stay the live project draft (stage P).
        if (attributes["publisher"] !== "IEEE") {
          parsed["iso_published"] = { value: "" };
          const stdRecord = locateStage("Std");
          if (stdRecord !== undefined) {
            attributes["typed_stage"] = new IeeeTypedStage(stdRecord);
          }
        }
      }
    }

    if (parsed["edition"] !== undefined) attributes["edition"] = extractValue(parsed["edition"]);
    if (parsed["edition_month"] !== undefined) {
      attributes["edition_month"] = extractValue(parsed["edition_month"]);
    }

    if (parsed["draft_version"] !== undefined) {
      const draftVer = (extractValue(parsed["draft_version"]) ?? "").replace(/^D/, "");
      if (draftVer !== "") {
        // A date trailing the draft (", June 2010") belongs to the draft
        // component (canonical month, comma form); the identity
        // year/month the promotion filled from the same captures are
        // vacated. Stage-first ISO rows are exempt: their canonical is
        // the ISO face, which prints the date from the identity slots
        // (", March 2017", pubid#216).
        if (parsed["draft_month"] !== undefined && parsed["iso_stage"] === undefined) {
          const dm = extractValue(parsed["draft_month"]) ?? "";
          const dy = extractValue(parsed["draft_year"]) ?? "";
          const monthNum = DRAFT_MONTH_NAMES[dm.replace(/\.$/, "")];
          if (
            JSON.stringify(attributes["publishers"]) === JSON.stringify(["IEEE", "CSA"]) &&
            monthNum !== undefined && dy !== ""
          ) {
            // The joint IEEE/CSA drafts glue their date into the
            // designator with the month numeric (pubid ruling
            // 2026-10-14: no comma dates on these rows).
            const glued = new IeeeDraft({
              version: `${draftVer}-${dy}-${monthNum.padStart(2, "0")}`,
            });
            attributes["draft"] = glued.render();
          } else {
            const draftObj = new IeeeDraft({
              version: draftVer,
              month: dm === "" ? undefined : dm,
              year: dy === "" ? undefined : dy,
              comma_before_month: true,
            });
            attributes["draft"] = draftObj.render();
          }
          if (parsed["year"] === undefined) delete attributes["year"];
          if (parsed["month"] === undefined) delete attributes["month"];
        } else if (parsed["draft_year"] !== undefined && parsed["iso_stage"] === undefined) {
          // The comma-year tail captures its separator (", 2013") —
          // strip it (the #471 separator-in-capture rule). The stored
          // form keeps the comma so it re-parses through the same tail.
          const draftYear = (extractValue(parsed["draft_year"]) ?? "").replace(/^[, ]+/, "");
          attributes["draft"] = `/D${draftVer}, ${draftYear}`;
          if (parsed["year"] === undefined) delete attributes["year"];
        } else if (
          JSON.stringify(attributes["publishers"]) === JSON.stringify(["IEEE", "CSA"]) &&
          parsed["iso_stage"] === undefined &&
          /^(19|20)\d\d$/.test(extractValue(parsed["year"]) ?? "") &&
          /^\d{1,2}$/.test(extractValue(parsed["month"]) ?? "")
        ) {
          // The glued face re-parses with the date in the identity
          // slots ("D2-2016-09" -> year/month + a bare D2): it
          // normalizes back onto the draft-embedded date so the
          // round trip closes on the CSA canonical.
          const glued = new IeeeDraft({
            version: `${draftVer}-${extractValue(parsed["year"])}-${extractValue(parsed["month"])}`,
          });
          attributes["draft"] = glued.render();
          delete attributes["year"];
          delete attributes["month"];
        } else {
          attributes["ieee_draft"] = `D${draftVer}`;
        }
      }
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

    // A joint ISO-print redline is a distinct document of the same standard
    // (pubid#215) - same flag semantics as the generic path.
    if (parsed["redline"] !== undefined) attributes["redline"] = true;

    // The joint stage-draft clause (docs/IEEE-DRAFT-STAGES.md §1.3):
    // variant 1's compound tail composes onto the IEEE ordinal
    // ("D5=DIS.3"); variant 1b is the ordinal-less stage draft whose
    // date rides inside the designator ("D=CDV:2020"). The doubled-D
    // alias spelling echoes as spelled.
    if (parsed["draft_iso_stage"] !== undefined) {
      // The doubled-D alias ("=DDIS") is notation: the designator carries
      // its own D-ordinal, the stage is the bare ISO/IEC token.
      const rawStage = `${extractValue(parsed["draft_stage_d"]) ?? ""}${extractValue(parsed["draft_iso_stage"]) ?? ""}`;
      const stageText = rawStage.startsWith("D") &&
        ["PWI", "NP", "WD", "CD", "CDV", "DIS", "FDIS"].includes(rawStage.slice(1))
        ? rawStage.slice(1)
        : rawStage;
      const jointVersion = extractValue(parsed["draft_version"]) ??
        (parsed["draft"] !== undefined
          ? extractValue(asHash(parsed["draft"] as Tree)["draft_version"] as Tree)
          : undefined);
      let jointDraft = jointVersion !== undefined
        ? `D${jointVersion.replace(/^D/, "")}=${stageText}`
        : `D=${stageText}`;
      if (parsed["draft_iso_iteration"] !== undefined) {
        jointDraft += `.${extractValue(parsed["draft_iso_iteration"])}`;
      }
      if (parsed["draft_stage_year"] !== undefined) {
        // The capture carries its separator verbatim (":2020" /
        // "-201112" - the #471 separator-in-capture rule): the ruby
        // builder appends it raw, so the face keeps the printed form.
        jointDraft += extractValue(parsed["draft_stage_year"]) ?? "";
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
      // The part capture carries its own separator (C1
      // separator-in-capture); join verbatim, synthesizing one only
      // for a bare capture — the reference's printed_joint rule.
      const partVal = extractValue(parsed["part"]);
      let printedCode = extractValue(parsed["number"]) ?? "";
      if (partVal !== undefined) {
        printedCode += /^[._-]/.test(partVal) ? partVal : `${sep}${partVal}`;
      }
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
      if ((parsed["draft_iso_stage"] !== undefined ||
           parsed["tail_iso_stage"] !== undefined) &&
          attributes["publisher"] === "ISO") {
        // The ISO-led D= designator (the issue #216 convergence) is
        // the stage-tracked draft of a published standard - the typed
        // stage reads Std/published.
        const stdRecord = locateStage("Std");
        if (stdRecord !== undefined) {
          attributes["typed_stage"] = new IeeeTypedStage(stdRecord);
        }
      } else {
        const record = locateStage("P");
        if (record !== undefined) attributes["typed_stage"] = new IeeeTypedStage(record);
      }
    }

    // A plain IEEE-designator draft on joint publishers ("/D8, June
    // 2010") carries no ISO stage machinery: it builds as the project
    // draft its bare-IEEE twin and the D= designator rows already pin
    // (pubid#430) rather than the joint-development model.
    if (
      attributes["draft"] !== undefined &&
      parsed["iso_stage"] === undefined &&
      parsed["iec_stage"] === undefined &&
      parsed["amd_number"] === undefined
    ) {
      const pubs = (attributes["publishers"] ?? []) as string[];
      const projectAttrs: Record<string, unknown> = {
        draft: attributes["draft"],
      };
      // The comma-year tail rides the draft verbatim ("D4, 2019" — the
      // reference keeps the comma face on the joint project drafts; the
      // year never promotes to the identity slots).
      // The code columns (number/parts/separator/prefix) are the
      // ProjectDraft render/hash face; the spelled P is the project
      // marker (identity), whatever the lead publisher.
      for (const k of ["number", "prefix", "parts", "separator"] as const) {
        // A "P" prefix is the project marker itself (the generic path
        // deletes it on the strip) - it must not ride the code columns.
        if (attributes[k] !== undefined && !(k === "prefix" && attributes[k] === "P")) {
          projectAttrs[k] = attributes[k];
        }
      }
      if (parsed["project_marker"] !== undefined) projectAttrs["project_marker"] = true;
      if (pubs.length > 0) {
        projectAttrs["publisher"] = pubs[0];
        if (pubs.length > 1) projectAttrs["copublisher"] = pubs.slice(1);
      }
      if (attributes["draft_status"] !== undefined) {
        projectAttrs["draft_status"] = attributes["draft_status"];
      }
      return new ProjectDraftIdentifierClass(projectAttrs as never) as unknown as Identifier;
    }

    // The iso_published joint rows normalize the publisher order to
    // ISO-first (the reference: "IEEE/ISO/IEC 8802-3:2021/Amd 4-2021"
    // builds the base [ISO, IEC, IEEE], lead ISO); the CD-stage rows and
    // the IEEE-led project rows preserve the printed order (P90003 stays
    // IEEE/ISO/IEC).
    if (parsed["iso_published"] !== undefined && parsed["iso_stage"] === undefined &&
        Array.isArray(attributes["publishers"])) {
      const pubs = attributes["publishers"] as string[];
      attributes["publishers"] = [...pubs.filter((p) => p !== "IEEE"), ...pubs.filter((p) => p === "IEEE")];
      attributes["publisher"] = (attributes["publishers"] as string[])[0];
      attributes["copublisher"] = (attributes["publishers"] as string[]).slice(1);
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
    const contentRaw = extractValue(parsed["content"]);
    let copublishedNumber: string | undefined;
    let draftInfo: string | undefined;
    let iecYear: string | undefined;
    let dateInfo: string | undefined;
    let relationships: IeeeRelationship[] | undefined;

    if (contentRaw !== undefined) {
      // A bare (unparenthesised) revision narrative printed after the code
      // is the same relationship prose as the parenthetical form (C3
      // ruling) — rewrite it into the parenthetical shape so both
      // spellings collapse onto one canonical.
      let content = contentRaw;
      const bare = content.match(/^(.+?) (Revis(?:ion|on) (?:of|to) IEEE Std .+)$/);
      if (bare !== null) content = `${bare[1]} (${bare[2]})`;

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

      // The parenthetical tail is classified, not swallowed (C3 ruling):
      // a "(Revision of IEEE Std ...)" narrative is a relationship, not
      // identity — it lands in `relationships` so the URN carries it as
      // the rel. segment and the canonical human drops it; an "(MM/DD)"
      // print date is non-identity and dropped; anything else keeps the
      // historical date_info rendering.
      if (content.includes(" (")) {
        const datePart = content.split(" (")[1];
        if (datePart !== undefined && datePart.includes(")")) {
          const tail = datePart.split(")")[0];
          const revision = tail !== undefined
            ? tail.match(/^Revis(?:ion|on) (?:of|to) IEEE Std (.+)$/)
            : null;
          if (tail !== undefined && revision !== null) {
            let related: { toHuman(): string };
            try {
              related = ieeeParseSingle(revision[1]!);
            } catch {
              related = { toHuman: () => revision[1]! };
            }
            relationships = [new IeeeRelationship("revision_of", [related], [])];
          } else if (tail !== undefined && /^\d{2}\/\d{2}$/.test(tail)) {
            // print date — non-identity, dropped
          } else if (tail !== undefined) {
            dateInfo = tail;
          }
        }
      }
    }

    const attrs: Record<string, unknown> = {};
    if (draftInfo !== undefined) attrs["draft_info"] = draftInfo;
    if (iecYear !== undefined) attrs["iec_year"] = iecYear;
    if (dateInfo !== undefined) attrs["date_info"] = dateInfo;
    if (relationships !== undefined) attrs["relationships"] = relationships;
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
    if (parsedHash["preprint"] !== undefined) {
      // Preprint is a draft STAGE of the C2 code — checked before the
      // Standard route: the c2-preprint tree carries :code "C2" too.
      klass = NescPreprintClass;
    } else if (parsedHash["draft"] !== undefined) {
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

// The grammar runtime is the baked PARG artifact (pubid-grammar
// artifacts/ieee.json via the parsanol engine) — the same artifact the
// gem runs, so grammar changes land once and this port cannot drift.
// Only the preprocessor, builder, model and the AIEE sub-grammar root
// (parseAieeDirect) remain hand-written.
let cachedArtifactRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

function parseSource(input: string): Tree {
  cachedArtifactRuntime ??= PubidRuntime.load("ieee");
  try {
    return artifactToBuilderTree(cachedArtifactRuntime.parseShape(input));
  } catch (e) {
    // The engine throws its own error class; the reference's fallback
    // logic keys on Parslet::ParseFailed, so normalize (the messageless
    // wasm throws included).
    throw new ParseFailed(e instanceof Error && e.message !== "" ? e.message : String(e), 0);
  }
}

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
  const tree = parseSource(cleaned);
  const builder = new IeeeBuilder();
  builder.originalInput = input;
  return builder.build(tree);
}

// The aiee_simple fallback parses WITHOUT the legacy update-codes table -
// the Ruby reference routes "AIEE …" to the AIEE sub-parser only, so an
// update-codes rewrite (e.g. "AIEE Nos 72 and 73 - 1932") must not make
// a line parse that the reference rejects.
function ieeeParseSingleNoCodes(input: string): Identifier {
  const tree = parseSource(preprocessIeee(input));
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
