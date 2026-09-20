import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier } from "../../model/identifier.js";
import { nistGrammar } from "./grammar.js";
import { preprocessNist } from "./preprocessor.js";
import {
  NIST_CLASSES,
  NistCode,
  NistEdition,
  NistIdentifier,
  NistPart,
  NistStage,
  NistSupplement,
  NistTranslation,
  NistUpdate,
  NistVersion,
  NistVolume,
  SP_SUBSERIES,
  seriesPolicy,
  type SeriesPolicy,
} from "./model.js";

/**
 * Port of lib/pubid/nist/{builder,caster,router,parser_output_normalizer,
 * circular_supplement_builder}.rb — the parse-tree → identifier pipeline.
 */

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const s = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const str = Array.isArray(v) ? v.join("") : String(v);
  return str.length > 0 ? str : undefined;
};

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

const TRANSLATION_MAP: Record<string, string> = {
  es: "spa", sp: "spa", pt: "por", id: "ind",
  chi: "zho", viet: "vie", port: "por", esp: "spa",
};

const MONTH_NUMBERS: Record<string, number> = {
  Jan: 1, January: 1, Feb: 2, February: 2, Mar: 3, March: 3,
  Apr: 4, April: 4, May: 5, Jun: 6, June: 6, Jul: 7, July: 7,
  Aug: 8, August: 8, Sep: 9, Sept: 9, September: 9, Oct: 10, October: 10,
  Nov: 11, November: 11, Dec: 12, December: 12,
};

const VALID_YEAR_RANGE_MIN = 1901;
const VALID_YEAR_RANGE_MAX = 2026;
const DASH_YEAR_AS_EDITION_SERIES = new Set(["HB", "CS", "FIPS"]);

// --- Parser output normalizer ---------------------------------------------------

function normalizeParsedHash(h: Record<string, unknown>): void {
  mergeEditionEIntoUpdate(h);
  extractEmbeddedEditionWithYear(h);
  extractEmbeddedEditionWithoutDashYear(h);
  splitSecondNumberEditionYear(h);
  splitFipsMonthYearAfterPart(h);
  disambiguateIrCompoundVsEdition(h);
  disambiguateDashYear(h);
}

function mergeEditionEIntoUpdate(h: Record<string, unknown>): void {
  const updatePrefix = h["update_prefix"];
  const update = h["update"];
  const editionE = h["edition_e"];
  if (updatePrefix === undefined || update === undefined || !isObj(editionE)) return;
  const editionId = editionE["edition_id"];
  h["update"] = { ...(isObj(update) ? update : {}), update_year: editionId };
  delete h["edition_e"];
}

function editionFromParts(type: string, id: string | undefined, additionalText?: string): Record<string, unknown> {
  return { __edition: true, type, id, ...(additionalText !== undefined ? { additional_text: additionalText } : {}) };
}

function extractEmbeddedEditionWithYear(h: Record<string, unknown>): void {
  const first = s(h["first_number"]);
  if (first !== undefined && /^[0-9]+[a-zA-Z]\d+$/.test(first) && h["edition_dash_year"] !== undefined) {
    const m = /^(\d+)([a-zA-Z])(\d+)$/.exec(first);
    if (m !== null) {
      h["first_number"] = m[1]!;
      h["edition_with_year"] = editionFromParts(
        m[2]!.toLowerCase(),
        m[3],
        s(isObj(h["edition_dash_year"]) ? h["edition_dash_year"]["dash_year"] : undefined),
      );
      delete h["edition_dash_year"];
      return;
    }
  }
  // Same shape embedded in the SECOND number ("53e1988" of "260-53e1988").
  const second = s(h["second_number"]);
  if (second !== undefined && /^[0-9]+[a-zA-Z]\d+$/.test(second)) {
    const m = /^(\d+)([a-zA-Z])(\d+)$/.exec(second);
    if (m !== null) {
      h["second_number"] = m[1]!;
      h["edition_with_year"] = editionFromParts(m[2]!.toLowerCase(), m[3]);
    }
  }
}

function extractEmbeddedEditionWithoutDashYear(h: Record<string, unknown>): void {
  if (h["second_number"] !== undefined) return;
  const first = s(h["first_number"]);
  if (first === undefined || !/^[0-9]+[a-zA-Z]\d+$/.test(first)) return;
  if (h["edition_dash_year"] !== undefined) return;
  const m = /^(\d+)([a-zA-Z])(\d+)$/.exec(first);
  if (m === null) return;
  h["first_number"] = m[1]!;
  h["edition_with_year"] = editionFromParts(m[2]!.toLowerCase(), m[3]);
}

function splitSecondNumberEditionYear(h: Record<string, unknown>): void {
  const combined = h["second_number_edition_year"];
  if (!isObj(combined)) return;
  h["second_number"] = combined["second_number"];
  const dashYear = s(combined["dash_year"]);
  const isHandbook = s(h["series"]) === "HB";
  if (isHandbook && dashYear !== undefined && /^\d{4}$/.test(dashYear)) {
    h["edition_from_year"] = editionFromParts("e", dashYear);
  } else {
    h["edition_dash_year"] = { dash_year: dashYear };
  }
  delete h["second_number_edition_year"];
}

function splitFipsMonthYearAfterPart(h: Record<string, unknown>): void {
  const combined = h["fips_month_year_after_part"];
  if (!isObj(combined)) return;
  h["second_number"] = combined["second_number"];
  const monthStr = s(combined["edition_month"]) ?? "";
  const yearStr = s(combined["edition_year"]) ?? "";
  const monthNum = MONTH_NUMBERS[monthStr];
  const editionId = monthNum !== undefined ? `${yearStr}${String(monthNum).padStart(2, "0")}` : yearStr;
  h["edition_from_year"] = editionFromParts("e", editionId);
  delete h["fips_month_year_after_part"];
}

function disambiguateIrCompoundVsEdition(h: Record<string, unknown>): void {
  if (s(h["series"]) !== "IR") return;
  if (h["first_number"] === undefined || h["edition_dash_year"] === undefined) return;
  const firstNum = s(h["first_number"]) ?? "";
  const dashYear = s(isObj(h["edition_dash_year"]) ? h["edition_dash_year"]["dash_year"] : undefined) ?? "";
  if (!/^\d{2}$/.test(firstNum) || !/^\d{4}$/.test(dashYear)) return;
  const isValidYear = Number(dashYear) >= VALID_YEAR_RANGE_MIN && Number(dashYear) <= VALID_YEAR_RANGE_MAX;
  const hasEmbeddedEdition = h["edition_e"] !== undefined;
  if (isValidYear && !hasEmbeddedEdition) {
    h["edition"] = editionFromParts("e", dashYear);
  } else {
    h["first_number"] = `${firstNum}-${dashYear}`;
  }
  delete h["edition_dash_year"];
}

function disambiguateDashYear(h: Record<string, unknown>): void {
  if (h["first_number"] === undefined || h["edition_dash_year"] === undefined) return;
  const first = s(h["first_number"]) ?? "";
  if (/^[0-9]+[a-zA-Z]\d+$/.test(first)) return;
  const dashYear = s(isObj(h["edition_dash_year"]) ? h["edition_dash_year"]["dash_year"] : undefined) ?? "";
  const series = s(h["series"]) ?? "";
  const dashYearNum = Number(dashYear);
  const isValidYear = dashYearNum >= VALID_YEAR_RANGE_MIN && dashYearNum <= VALID_YEAR_RANGE_MAX;

  if (series === "RPT") {
    h["first_number"] = `${first}-${dashYear}`;
    delete h["edition_dash_year"];
  } else if (series === "GCR") {
    h["edition_from_year"] = editionFromParts("e", dashYear);
    delete h["edition_dash_year"];
  } else if (series === "IR" && isValidYear) {
    h["edition_from_year"] = editionFromParts("e", dashYear);
    delete h["edition_dash_year"];
  } else if (DASH_YEAR_AS_EDITION_SERIES.has(series) && isValidYear) {
    h["edition_from_year"] = editionFromParts("e", dashYear);
    delete h["edition_dash_year"];
  } else if (dashYearNum < 1900) {
    h["second_number"] = dashYear;
    delete h["edition_dash_year"];
  }
}

// --- Router -------------------------------------------------------------------------

type NistCtor = new (attrs?: Record<string, unknown>) => NistIdentifier;

function classForKind(kind: string): NistCtor {
  return NIST_CLASSES.get(kind) as unknown as NistCtor;
}

function locateIdentifierKlass(h: Record<string, unknown>): NistCtor {
  if (h["dated_date"] !== undefined && h["dated_seq"] !== undefined) {
    return classForKind("dated-document");
  }
  let series = s(h["series"]);

  if (series?.startsWith("NBS ") === true || series?.startsWith("NBS.") === true || series?.startsWith("NIST.") === true) {
    const separator = series.startsWith("NBS ") ? "NBS " : series.startsWith("NBS.") ? "NBS." : "NIST.";
    let simple = series.slice(separator.length);
    if (simple === "LCIRC" || simple === "CIRC") {
      return hasSupplement(h) ? classForKind("circular-supplement") : simple === "CIRC" ? classForKind("circular") : classForKind("letter-circular");
    }
    series = simple;
  }

  if (series === "CS") {
    const firstNum = h["first_number"];
    if (isObj(firstNum) && firstNum["volume_number"] !== undefined && firstNum["issue_number"] !== undefined) {
      return classForKind("commercial-standards-monthly");
    }
    const firstNumStr = s(firstNum) ?? "";
    if (/^e\d{3,}/.test(firstNumStr)) {
      return classForKind("commercial-standard-emergency");
    }
  }

  // Series token → type via the typed-stage abbreviation table.
  const kind = SERIES_TO_KIND[series ?? ""];
  return kind !== undefined ? classForKind(kind) : classForKind("identifier");
}

const SERIES_TO_KIND: Record<string, string> = {
  SP: "special-publication",
  "NIST SP": "special-publication",
  "NBS SP": "special-publication",
  FIPS: "federal-information-processing-standards",
  "NIST FIPS": "federal-information-processing-standards",
  IR: "interagency-report",
  "NIST IR": "interagency-report",
  "NBS IR": "interagency-report",
  HB: "handbook",
  "NIST HB": "handbook",
  "NBS HB": "handbook",
  TN: "technical-note",
  "NIST TN": "technical-note",
  "NBS TN": "technical-note",
  CIRC: "circular",
  "NBS CIRC": "circular",
  CRPL: "crpl-report",
  "NBS CRPL": "crpl-report",
  "CRPL-F-B": "crpl-report",
  "CRPL-F-A": "crpl-report",
  "NBS CRPL-F-B": "crpl-report",
  "NBS CRPL-F-A": "crpl-report",
  "NBS BRPD-CRPL-D": "crpl-report",
  RPT: "report",
  "NBS RPT": "report",
  MONO: "monograph",
  "NBS MONO": "monograph",
  "NIST MONO": "monograph",
  MP: "miscellaneous-publication",
  "NBS MP": "miscellaneous-publication",
  GCR: "grant-contractor-report",
  "NIST GCR": "grant-contractor-report",
  NCSTAR: "ncstar",
  "NIST NCSTAR": "ncstar",
  OWMWP: "owmwp",
  "NIST OWMWP": "owmwp",
  NSRDS: "nsrds",
  "NBS NSRDS": "nsrds",
  "NSRDS-NBS": "nsrds",
  LCIRC: "letter-circular",
  CS: "commercial-standard",
  "NBS CS": "commercial-standard",
  "NBS CS-E": "commercial-standard-emergency",
  "CS-E": "commercial-standard-emergency",
  CSM: "commercial-standards-monthly",
  "NBS CSM": "commercial-standards-monthly",
  "NIST PS": "identifier",
  "NIST DCI": "identifier",
  "NIST Other": "identifier",
  "ITL Bulletin": "identifier",
  "CSRC Building Block": "identifier",
  "CSRC Use Case": "identifier",
  "CSRC Book": "identifier",
};

function hasSupplement(h: Record<string, unknown>): boolean {
  return (
    h["supplement"] !== undefined ||
    h["supplement_date_range"] !== undefined ||
    h["supplement_date"] !== undefined ||
    h["supplement_slash_year"] !== undefined ||
    h["supplement_with_rev"] !== undefined
  );
}

// --- Caster ----------------------------------------------------------------------------

type Cast = unknown;

function editionCast(type: string, id: string | undefined, additionalText?: string, originalPrefix?: string): Cast {
  const edition = new NistEdition({ type, id, ...(additionalText !== undefined ? { additional_text: additionalText } : {}), ...(originalPrefix !== undefined ? { original_prefix: originalPrefix } : {}) });
  return { edition };
}

function cast(type: string, value: unknown, h: Record<string, unknown>, policy: SeriesPolicy, series = ""): Cast {
  switch (type) {
    case "publisher":
      return s(value);

    case "dated_date": {
      if (!isObj(value)) return undefined;
      return { date_year: s(value["date_year"]), date_month: s(value["date_month"]), date_day: s(value["date_day"]) };
    }
    case "dated_seq":
      return s(value) === undefined ? undefined : { dated_seq: s(value) };

    case "year":
      return s(value) === undefined ? undefined : Number(s(value));

    case "series": {
      const strValue = s(value);
      if (strValue === undefined) return undefined;
      const m = /^(NBS|NIST) (.+)$/.exec(strValue);
      if (m !== null) {
        return { publisher: m[1], series: new NistCode({ value: m[2]! }) };
      }
      return { series: new NistCode({ value: strValue }) };
    }

    case "volume_number": {
      const v = s(value);
      return v === undefined ? undefined : { volume: new NistVolume({ value: v }) };
    }
    case "issue_number": {
      const v = s(value);
      return v === undefined ? undefined : { part: new NistPart({ type: "n", value: v }) };
    }
    case "part_number":
      return s(value);

    case "letter_number": {
      if (!isObj(value)) return undefined;
      const suffix = s(value["letter_suffix"]) ?? "";
      const extra = s(value["letter_suffix_extra"]) ?? "";
      const full = extra === "" ? suffix : `${suffix}${extra}`;
      if (full === "") return undefined;
      // IR keeps R/Ur for the compound handler; NCSTAR/MONO keep any
      // letter in the number (Ruby Series class dispatch).
      if (series === "IR" && (full === "R" || full === "Ur")) return { letter_number: { ...value, letter_suffix: full } };
      if (series === "NCSTAR" || series === "MONO") {
        return { letter_number: { ...value, letter_suffix: full } };
      }
      return { part: new NistPart({ type: "", value: full.toUpperCase() }) };
    }

    case "fips_part": {
      const v = s(value);
      return v === undefined ? undefined : { part: new NistPart({ type: "pt", value: v }) };
    }

    case "owmwp_date_number": {
      if (value === undefined) return undefined;
      const v = isObj(value) ? value : {};
      const owmwp = isObj(v["owmwp_date_number"]) ? v["owmwp_date_number"] : v;
      const numberPart = `${s(owmwp["owmwp_month"])}-${s(owmwp["owmwp_day"])}`;
      return { first_number: numberPart, edition: new NistEdition({ type: "e", id: s(owmwp["owmwp_year"]) }) };
    }

    case "first_number":
    case "second_number":
      return castNumber(type, value, h, policy);

    case "crpl_range": {
      const strValue = s(value);
      if (strValue === undefined) return undefined;
      let m = /^(\d+)_(\d+-\d+)([A-Z])$/.exec(strValue);
      if (m !== null) {
        return {
          second_number: m[1]!,
          part: new NistPart({ type: "pt", value: m[2]! }),
          supplement: m[3]!,
        };
      }
      m = /^(\d+)_(\d+-\d+)$/.exec(strValue);
      if (m !== null) {
        return { second_number: m[1]!, part: new NistPart({ type: "pt", value: m[2]! }) };
      }
      return { second_number: strValue };
    }

    case "stage": {
      if (!isObj(value)) return undefined;
      const stageId = (s(value["stage_id"]) ?? "").toLowerCase();
      const stageType = (s(value["stage_type"]) ?? "").toLowerCase();
      if (stageId === "" || stageType === "") return undefined;
      return { stage: new NistStage({ id: stageId, type: stageType }) };
    }
    case "stage_id":
    case "stage_type":
      return undefined;

    case "parsed_format": {
      const v = s(value);
      return v === "short" || v === undefined ? undefined : v;
    }

    case "translation": {
      const v = s(value);
      if (v === undefined) return undefined;
      const stripped = v.trim();
      const code = TRANSLATION_MAP[stripped.toLowerCase()] ?? stripped.toLowerCase();
      // The gem's translation attr is the component; its to_s prefixes
      // the space (" .uppl"), and the wire serializes that form.
      return { translation_component: new NistTranslation({ code }), translation: ` ${code}` };
    }

    case "version": {
      const v = s(value);
      return v === undefined ? undefined : { version_component: new NistVersion({ value: v }) };
    }

    case "update": {
      if (isObj(value)) {
        // Ruby's prefix lookup reads the INNER hash where update_prefix
        // never lands — the prefix is always the slash form.
        const update = new NistUpdate({
          number: s(value["update_number"]),
          year: s(value["update_year"]),
          month: s(value["update_month"]),
          prefix: "slash",
        });
        return { update, update_component: update };
      }
      // Bare "-upd"/"/upd" with no details: Ruby's empty-string branch reads
      // the OUTER hash prefix, so the dash/slash distinction survives here.
      const barePrefix = (s(h["update_prefix"]) ?? "").includes("-") ? "dash" : "slash";
      const update = new NistUpdate({ number: "1", prefix: barePrefix });
      return { update, update_component: update };
    }
    case "update_prefix":
    case "update_number":
    case "update_year":
    case "update_month":
      return undefined;

    case "volume": {
      const v = s(value);
      return v === undefined ? undefined : { volume: new NistVolume({ value: v }) };
    }
    case "section":
    case "appendix":
    case "errata":
    case "index":
    case "insert":
      return s(value);

    case "revision": {
      if (isObj(value) && value["revision_prefix"] !== undefined) {
        const prefix = s(value["revision_prefix"]) ?? "";
        let id = (s(value["revision_id"]) ?? "").trim();
        if (id === "" || id === "r" || id === "R") id = "1";
        else {
          const m = /^(\d+[a-z]?)$/.exec(id);
          if (m !== null) id = m[1]!;
        }
        return editionCast("r", id, undefined, prefix);
      }
      const strValue = (s(value) ?? "").trim();
      let revisionId: string;
      if (strValue === "" || strValue === "r" || strValue === "R") revisionId = "1";
      else {
        const m = /^[rR]?(\d+[a-z]?)$/.exec(strValue);
        revisionId = m !== null ? m[1]! : strValue;
      }
      return editionCast("r", revisionId);
    }

    case "revision_year": {
      const yearValue = (s(value) ?? "").trim();
      if (h["revision_month"] !== undefined) return yearValue;
      return editionCast("r", yearValue);
    }
    case "revision_month":
      return s(value);

    case "supplement_year":
      return s(value) === undefined ? undefined : { supplement: s(value) };

    case "supplement": {
      if (value === undefined) return undefined;
      if (Array.isArray(value) && value.length === 0) return { supplement: "" };
      const strValue = (s(value) ?? "").trim();
      return strValue === "" ? undefined : { supplement: strValue };
    }

    case "supplement_date_range": {
      if (!isObj(value)) return undefined;
      const ms = s(value["supp_month_start"]);
      const ys = s(value["supp_year_start"]);
      const me = s(value["supp_month_end"]);
      const ye = s(value["supp_year_end"]);
      return {
        supplement_date_range_start: ms !== undefined && ys !== undefined ? `${ms}${ys}` : undefined,
        supplement_date_range_end: me !== undefined && ye !== undefined ? `${me}${ye}` : undefined,
      };
    }

    case "supplement_date": {
      if (!isObj(value)) return undefined;
      const month = s(value["supp_month"]);
      const year = s(value["supp_year"]);
      return month !== undefined && year !== undefined ? { supplement: `${month}${year}` } : undefined;
    }

    case "supplement_slash_year": {
      if (!isObj(value)) return undefined;
      const number = s(value["supp_number"]);
      const year = s(value["supp_year"]);
      return number !== undefined && year !== undefined ? { supplement: `${number}/${year}` } : undefined;
    }

    case "supplement_with_rev":
      return { supplement: "", supplement_has_revision: true };

    case "supp_year":
      return { supplement: s(value) ?? "" };

    case "edition_e":
      return isObj(value) ? editionCast("e", s(value["edition_id"])) : undefined;

    case "edition_r":
    case "edition_r_no_space":
    case "edition_rev":
      return isObj(value) ? editionCast("r", s(value["edition_id"])) : undefined;

    case "edition_r_letter":
      if (!isObj(value)) return undefined;
      return editionCast("r", s(value["edition_id"]), (s(value["edition_letter"]) ?? "").toLowerCase());

    case "edition_r_letter_only":
      if (!isObj(value)) return undefined;
      return editionCast("r", (s(value["edition_letter"]) ?? "").toLowerCase());

    case "edition_historical":
      return isObj(value) ? editionCast("-", s(value["edition_id"])) : undefined;

    case "edition_r_with_space_letter":
    case "edition_r_no_space_letter": {
      if (!isObj(value)) return undefined;
      const id = s(value["edition_id"]);
      const editionLetter = (s(value["edition_letter"]) ?? "").toUpperCase();
      const hasUpdate = h["update_prefix"] !== undefined || h["update"] !== undefined;
      if (hasUpdate) return editionCast("r", id, editionLetter);
      return editionCast("r", id, editionLetter, " r");
    }

    case "edition_r_with_space": {
      if (!isObj(value)) return undefined;
      const id = s(value["edition_id"]);
      const hasUpdate = h["update_prefix"] !== undefined || h["update"] !== undefined;
      if (hasUpdate) return editionCast("r", id);
      return editionCast("r", id, undefined, " r");
    }

    case "edition_id":
    case "edition_date":
    case "legacy_edition":
    case "edition_month":
      return undefined;

    case "edition_day":
      return s(value);

    case "edition_dash_year":
      return undefined;

    case "edition_year": {
      const yearValue = s(value);
      if (yearValue === undefined) return undefined;
      const monthStr = s(h["edition_month"]);
      const policyHere = seriesPolicy(s(h["series"]));
      if (monthStr !== undefined) {
        const monthNum = MONTH_NUMBERS[monthStr];
        if (monthNum !== undefined) {
          if (
            !policyHere.modernEditionDate &&
            /^[A-Z][a-z]+/.test(monthStr) &&
            /^\d{4}$/.test(yearValue)
          ) {
            return {
              edition: new NistEdition({ type: "-", id: "", additional_text: `${monthStr}${yearValue}` }),
              edition_year: yearValue,
            };
          }
          let editionId = `${yearValue}${String(monthNum).padStart(2, "0")}`;
          if (policyHere.modernEditionDate && h["edition_day"] !== undefined) {
            const dayNum = Number(s(h["edition_day"]));
            if (dayNum > 0 && dayNum <= 31) editionId += `${String(dayNum).padStart(2, "0")}`;
          }
          return { edition: new NistEdition({ type: "e", id: editionId }), edition_year: yearValue };
        }
      }
      return { edition: new NistEdition({ type: "e", id: yearValue }), edition_year: yearValue };
    }

    case "edition_e_date":
      return isObj(value) ? editionCast("e", s(value["edition_date"])) : undefined;

    case "part": {
      const strValue = (s(value) ?? "").trim();
      if (strValue === "") return undefined;
      let m = /^(\d+)add(e\d+)$/.exec(strValue);
      if (m !== null) return { part: new NistPart({ type: "pt", value: m[1]! }), addendum: "true" };
      m = /^(\d+)add/.exec(strValue);
      if (m !== null) return { part: new NistPart({ type: "pt", value: m[1]! }), addendum: "true" };
      return { part: new NistPart({ type: "pt", value: strValue }) };
    }

    case "edition_letter":
      return s(value);

    case "public_draft":
      return s(value);

    case "draft": {
      const strValue = (s(value) ?? "").trim();
      if (strValue === "") return undefined;
      let m = /^\s*-draft\s+(\d+)$/.exec(strValue);
      if (m !== null) return { draft_number: m[1] };
      m = /^\s*(\d+)pd$/.exec(strValue);
      if (m !== null) return { public_draft: m[1] };
      return strValue;
    }

    case "addendum": {
      if (isObj(value)) {
        const addendumNum = (s(value["addendum_number"]) ?? "").trim();
        return addendumNum !== "" ? { addendum_number: addendumNum } : { addendum: "true" };
      }
      const strValue = (s(value) ?? "").trim();
      return strValue === "" ? { addendum: "true" } : { addendum_number: strValue };
    }

    case "addendum_number":
      return s(value);

    case "supplement_suffix":
      return { supplement: s(value) ?? "" };

    case "date": {
      if (!isObj(value)) return undefined;
      const month = s(value["date_month"]);
      const year = s(value["date_year"]);
      if (month !== undefined && year !== undefined && value["date_day"] === undefined && /^[A-Za-z]+$/.test(month)) {
        return editionCast("-", undefined, `${month}${year}`);
      }
      return undefined;
    }

    default:
      return isObj(value) ? (value as Record<string, unknown>) : undefined;
  }
}

function castNumber(type: string, value: unknown, h: Record<string, unknown>, policy: SeriesPolicy): Cast {
  if (value === undefined || (s(value) === undefined && !isObj(value))) return undefined;

  if (isObj(value)) {
    if (value["owmwp_date_number"] !== undefined) {
      const owmwp = value["owmwp_date_number"] as TreeObject;
      const numberPart = `${s(owmwp["owmwp_month"])}-${s(owmwp["owmwp_day"])}`;
      return { [type]: numberPart, edition: new NistEdition({ type: "e", id: s(owmwp["owmwp_year"]) }) };
    }
    if (type === "second_number" && value["number_only"] !== undefined && value["edition_id"] !== undefined) {
      return { second_number: value };
    }
    if (type === "second_number" && value["revision_letter"] !== undefined) {
      const revisionData = value["revision_letter"] as TreeObject;
      const numberOnly = s(revisionData["number_only"]) ?? "";
      const letter = (s(revisionData["letter"]) ?? "").toUpperCase();
      return { second_number: `${numberOnly}r${letter}` };
    }
    if (value["volume_number"] !== undefined && value["issue_number"] !== undefined) {
      return {
        volume: new NistVolume({ value: s(value["volume_number"])! }),
        part: new NistPart({ type: "n", value: s(value["issue_number"])! }),
      };
    }
    if (type === "first_number" && value["number_with_rev_year"] !== undefined) {
      const data = value["number_with_rev_year"] as TreeObject;
      return {
        first_number: s(data["number"]),
        edition: new NistEdition({ type: "rv", id: s(data["revision_year"]) }),
      };
    }
    if (type === "first_number" && value["number_with_letter_revision"] !== undefined) {
      const data = value["number_with_letter_revision"] as TreeObject;
      return {
        first_number: s(data["number"]),
        part: new NistPart({ type: "", value: (s(data["letter_suffix"]) ?? "").toUpperCase() }),
        edition: new NistEdition({ type: "r", id: s(data["revision_id"]) }),
      };
    }
    if (type === "first_number" && value["number"] !== undefined && value["language_code"] !== undefined) {
      const languageCode = (s(value["language_code"]) ?? "").toLowerCase();
      return {
        first_number: s(value["number"]),
        translation_component: new NistTranslation({ code: TRANSLATION_MAP[languageCode] ?? languageCode }),
      };
    }
    if (type === "first_number" && value["number"] !== undefined && value["part_number"] !== undefined && value["edition_year"] !== undefined) {
      return {
        first_number: s(value["number"]),
        part: new NistPart({ type: "pt", value: s(value["part_number"])! }),
        edition: new NistEdition({ type: "e", id: s(value["edition_year"]) }),
      };
    }
    if (type === "first_number" && value["number_with_volume"] !== undefined) {
      const data = value["number_with_volume"] as TreeObject;
      if (data["volume_suffix"] !== undefined) {
        return {
          first_number: s(data["number"]),
          volume: new NistVolume({ value: s(data["volume_suffix"])! }),
        };
      }
    }
  }

  const strValue = s(value) ?? "";

  if (type === "first_number") {
    let m: RegExpExecArray | null;

    if (h["edition_year_separate"] !== undefined && /^(\d+)e(\d+)$/.test(strValue)) {
      m = /^(\d+)e(\d+)$/.exec(strValue)!;
      return {
        first_number: m[1]!,
        edition: new NistEdition({ type: "e", id: m[2]!, additional_text: s(h["edition_year_separate"]) }),
      };
    }

    if (h["historical_month"] !== undefined && h["historical_year"] !== undefined) {
      const monthPart = s(h["historical_month"])!;
      const yearPart = s(h["historical_year"])!;
      if (/^\d+$/.test(strValue)) {
        return { first_number: strValue, edition: new NistEdition({ type: "-", additional_text: `${monthPart}${yearPart}` }) };
      }
      return { edition: new NistEdition({ type: "-", additional_text: `${monthPart}${yearPart}` }) };
    }

    if ((m = /^(\d+)supp?$/.exec(strValue)) !== null) {
      if (h["supplement_year"] !== undefined) {
        return { first_number: m[1]!, supplement: s(h["supplement_year"]) };
      }
      return { first_number: m[1]!, supplement: "" };
    }
    if ((m = /^(\d+)supprev$/.exec(strValue)) !== null) {
      return { first_number: m[1]!, supplement: "", supplement_has_revision: true };
    }
    if ((m = /^(\d+)e(\d+)-(\d{4})$/.exec(strValue)) !== null) {
      return { first_number: m[1]!, edition: new NistEdition({ type: "e", id: m[2]!, additional_text: m[3] }) };
    }
    if ((m = /^-([A-Za-z]{3,9})(\d{4})$/.exec(strValue)) !== null) {
      return { edition: new NistEdition({ type: "-", additional_text: `${m[1]!}${m[2]!}` }) };
    }
    if (/^e(\d{3,})$/.test(strValue)) {
      return { first_number: h["second_number"] !== undefined ? strValue : strValue.slice(1) };
    }
    if ((m = /^(\d+)e(\d+)$/.exec(strValue)) !== null && h["second_number"] === undefined && h["edition_dash_year"] === undefined) {
      return { first_number: m[1]!, edition: new NistEdition({ type: "e", id: m[2]! }) };
    }
    // "150-1Ae2009" / "53ar1": letter between the compound number and an
    // edition/revision splits off as a Part component.
    if ((m = /^(\d+-\d+)([A-Z])e(\d{4})$/.exec(strValue)) !== null) {
      return {
        first_number: m[1]!,
        part: new NistPart({ type: "", value: m[2]! }),
        edition: new NistEdition({ type: "e", id: m[3]! }),
      };
    }
    if ((m = /^e(\d{1,2})$/.exec(strValue)) !== null) {
      return { edition: new NistEdition({ type: "e", id: m[1]! }) };
    }
    if ((m = /^(\d+)e(\d+)rev(\d{4})$/.exec(strValue)) !== null) {
      return { first_number: m[1]!, edition: new NistEdition({ type: "e", id: m[2]!, additional_text: m[3] }) };
    }
    if ((m = /^(\d+)e(\d+)(rev.+)$/.exec(strValue)) !== null) {
      return { first_number: m[1]!, edition: new NistEdition({ type: "e", id: m[2]!, additional_text: m[3]!.replace(/^rev/, "") }) };
    }
    if ((m = /^(\d+)supp([A-Za-z]{3,9})(\d{4})$/.exec(strValue)) !== null) {
      return { first_number: m[1]!, supplement: `${m[2]!}${m[3]!}` };
    }
    if ((m = /^(\d+)supp(\d{4})$/.exec(strValue)) !== null) {
      return { first_number: m[1]!, supplement: m[2]! };
    }
    if ((m = /^(\d+)supp-(\d{4})$/.exec(strValue)) !== null) {
      return { first_number: m[1]!, supplement: m[2]! };
    }
    if ((m = /^(\d+)e(\d+)supp$/.exec(strValue)) !== null) {
      return { first_number: m[1]!, edition: new NistEdition({ type: "e", id: m[2]! }), supplement: "" };
    }
  } else if (type === "second_number" && isObj(value) && (value as TreeObject)["first_number"] !== undefined) {
    const v = value as TreeObject;
    return {
      first_number: s(v["first_number"]),
      part: new NistPart({ value: s(v["part_value"]) ?? "" }),
      edition: new NistEdition({ type: "r", id: s(v["revision_value"]) }),
    };
  }

  let m: RegExpExecArray | null;

  if ((m = /^(.+?)pt(\d+)r(\d+[a-z]?)$/.exec(strValue)) !== null) {
    return { [type]: m[1]!, part: new NistPart({ type: "pt", value: m[2]! }), edition: new NistEdition({ type: "r", id: m[3]! }) };
  }
  if ((m = /^(.+?)pt(\d+)$/.exec(strValue)) !== null) {
    return { [type]: m[1]!, part: new NistPart({ type: "pt", value: m[2]! }) };
  }
  if ((m = /^(\d+)v(\d+)$/.exec(strValue)) !== null) {
    return { [type]: m[1]!, volume: m[2]! };
  }
  if ((m = /^(.+?)(r\d+\/\d{4})$/i.exec(strValue)) !== null) {
    const rm = /^r(\d+)\/(\d{4})$/.exec(m[2]!);
    if (rm !== null) {
      return { [type]: m[1]!, edition: new NistEdition({ type: "r", id: rm[1]!, additional_text: rm[2]! }) };
    }
  }
  if ((m = /^(.*\d)(r\d{4})$/i.exec(strValue)) !== null) {
    return { [type]: m[1]!, edition: new NistEdition({ type: "r", id: m[2]!.slice(1) }) };
  }
  if ((m = /^(.+?)(r[A-Za-z]{3,9}\d{4})$/i.exec(strValue)) !== null) {
    const rm = /^r([A-Za-z]{3,9})(\d{4})$/.exec(m[2]!);
    if (rm !== null) {
      return { [type]: m[1]!, edition: new NistEdition({ type: "r", id: `${rm[1]!}${rm[2]!}` }) };
    }
  }
  if ((m = /^(.*\d)(r\d+[a-z]?)$/i.exec(strValue)) !== null) {
    return { [type]: m[1]!, edition: new NistEdition({ type: "r", id: m[2]!.slice(1) }) };
  }
  if ((m = /^(.+?)(?<![a-zA-Z])(r)$/i.exec(strValue)) !== null) {
    return { [type]: m[1]!, edition: new NistEdition({ type: "r", id: "1" }) };
  }
  if ((m = /^(.+?)([A-Z])(r\d+[a-z]?)$/.exec(strValue)) !== null) {
    return {
      [type]: m[1]!,
      part: new NistPart({ type: "", value: m[2]! }),
      edition: new NistEdition({ type: "r", id: m[3]!.slice(1) }),
    };
  }
  if ((m = /^(.+?)([A-Z])$/.exec(strValue)) !== null) {
    if (policy.preserveLetterSuffix) {
      return { [type]: strValue };
    }
    return { [type]: m[1]!, part: new NistPart({ type: "", value: m[2]! }) };
  }

  return { [type]: strValue };
}

// --- Builder -----------------------------------------------------------------------------

interface SupplementSignals {
  value: string | undefined;
  hasRevision: boolean;
  rangeStart: string | undefined;
  rangeEnd: string | undefined;
  present: boolean;
}

class NistBuilder {
  build(data: unknown, parsedFormat: "mr" | "short"): BaseIdentifier {
    const h: Record<string, unknown> = { ...flatten(data as Tree) };
    h["parsed_format"] = parsedFormat;
    normalizeParsedHash(h);

    if (
      h["supplement_date_range"] !== undefined ||
      h["supplement_slash_year"] !== undefined ||
      h["supplement_month_year"] !== undefined ||
      h["supplement_year"] !== undefined ||
      h["supplement"] !== undefined ||
      h["base_portion"] !== undefined
    ) {
      return this.buildCircularSupplement(h);
    }

    const klass = locateIdentifierKlass(h);
    const policy = seriesPolicy(s(h["series"]));
    const identifier = new klass();

    const attrs: Record<string, unknown> = {};
    const toEdition = (v: unknown): NistEdition | undefined => {
      if (isObj(v)) {
        return new NistEdition({
          type: s(v["type"]),
          id: s(v["id"]),
          additional_text: s(v["additional_text"]),
        });
      }
      return undefined;
    };
    for (const editionKey of ["edition_with_year", "edition_from_year", "edition"]) {
      if (h[editionKey] !== undefined) {
        const edition = toEdition(h[editionKey]);
        if (edition !== undefined) attrs["edition"] = edition;
        delete h[editionKey];
      }
    }
    const supp: SupplementSignals = { value: undefined, hasRevision: false, rangeStart: undefined, rangeEnd: undefined, present: false };
    const captureSupplement = (key: string, value: unknown): boolean => {
      if (key === "supplement") {
        supp.value = value === undefined || value === null ? undefined : String(value);
      } else if (key === "supplement_has_revision") {
        supp.hasRevision = value === true;
      } else if (key === "supplement_date_range_start") {
        supp.rangeStart = s(value);
      } else if (key === "supplement_date_range_end") {
        supp.rangeEnd = s(value);
      } else {
        return false;
      }
      supp.present = true;
      return true;
    };

    let firstNum: string | undefined;
    let secondNum: string | undefined;
    let secondNumRaw: TreeObject | undefined;
    let decimalNum: TreeObject | undefined;
    let letterNum: TreeObject | undefined;
    let partNum: string | undefined;
    let extractedRevision: string | undefined;

    const seriesToken = s(h["series"]);
    for (const [key, rawValue] of Object.entries(h)) {
      const realized = cast(key, rawValue, h, policy, seriesToken);
      if (realized === undefined) continue;

      if (typeof realized !== "object" || realized === null) {
        if (captureSupplement(key, realized)) continue;
      }

      if (key === "first_number" && typeof realized === "string") {
        firstNum = realized;
        continue;
      }
      if (key === "second_number" && typeof realized === "string") {
        secondNum = realized;
        continue;
      }
      if (key === "second_number" && isObj(realized) && isObj((realized as Record<string, unknown>)["second_number"])) {
        secondNumRaw = (realized as Record<string, unknown>)["second_number"] as TreeObject;
        continue;
      }
      if (key === "crpl_range" && typeof realized === "object" && realized !== null && !Array.isArray(realized)) {
        const rec = realized as Record<string, unknown>;
        const sn = rec["second_number"];
        if (typeof sn === "string") secondNum = sn;
        if (rec["part"] !== undefined) attrs["part"] = rec["part"];
        if (rec["supplement"] !== undefined) captureSupplement("supplement", rec["supplement"]);
        continue;
      }
      if (key === "part_number") {
        partNum = s(rawValue);
        continue;
      }
      if (key === "decimal_number" && isObj(rawValue)) {
        decimalNum = rawValue;
        continue;
      }
      if (key === "letter_number" && isObj(rawValue)) {
        letterNum = rawValue;
        if (isObj(realized) && "part" in realized) attrs["part"] = realized["part"];
        continue;
      }

      if (isObj(realized)) {
        for (const [subKey, subValue] of Object.entries(realized)) {
          if (subKey === "first_number" && typeof subValue === "string") {
            firstNum = subValue;
            continue;
          }
          if (subKey === "second_number" && typeof subValue === "string") {
            secondNum = subValue;
            continue;
          }
          if (subKey === "second_number" && isObj(subValue)) {
            secondNumRaw = subValue;
            extractedRevision = "r";
            continue;
          }
          if (subKey === "revision") {
            extractedRevision = s(subValue);
            continue;
          }
          if (captureSupplement(subKey, subValue)) continue;
          attrs[subKey] = subValue;
        }
      } else {
        attrs[key] = realized;
      }
    }

    Object.assign(identifier as unknown as Record<string, unknown>, attrs);

    // Compound number construction.
    const self = identifier as unknown as Record<string, unknown>;
    if (firstNum !== undefined && self["number"] === undefined) {
      if (self["volume"] !== undefined && self["issue_number"] !== undefined) {
        // v#n# handled as Part during cast.
      } else if (decimalNum !== undefined) {
        self["number"] = `${firstNum}-${s(decimalNum["decimal_base"])}.${s(decimalNum["decimal_suffix"])}`;
      } else if (letterNum !== undefined) {
        const letterBase = s(letterNum["letter_base"]) ?? "";
        const letterSuffix = s(letterNum["letter_suffix"]) ?? "";
        const extra = s(letterNum["letter_suffix_extra"]) ?? "";
        const full = extra === "" ? letterSuffix : `${letterSuffix}${extra}`;
        if (policy === seriesPolicy("IR") && full === "R") {
          self["number"] = `${firstNum}-${letterBase}`;
          self["edition"] = new NistEdition({ type: "r", id: "1" });
        } else if (self["part"] !== undefined) {
          self["number"] = `${firstNum}-${letterBase}`;
        } else {
          self["number"] = `${firstNum}-${letterBase}${full}`;
        }
      } else if (secondNumRaw !== undefined && secondNumRaw["number_only"] !== undefined && secondNumRaw["edition_id"] !== undefined) {
        self["number"] = `${firstNum}-${s(secondNumRaw["number_only"])}`;
        self["edition"] = new NistEdition({ type: "r", id: s(secondNumRaw["edition_id"]) });
      } else if (secondNum !== undefined) {
        let m = /^e(\d{3})$/.exec(firstNum);
        if (m !== null && /^\d{2}$/.test(secondNum)) {
          self["number"] = m[1]!;
          self["edition"] = new NistEdition({ type: "e", id: `19${secondNum}` });
        } else if ((m = /^(\d+)e(\d+)$/.exec(firstNum)) !== null && /^\d{2,4}$/.test(secondNum)) {
          let yearPart = secondNum;
          if (yearPart.length === 2) yearPart = `19${yearPart}`;
          self["number"] = m[1]!;
          self["edition"] = new NistEdition({ type: "e", id: m[2]!, additional_text: yearPart });
        } else if ((m = /^(\d+)supp?$/.exec(firstNum)) !== null && /^\d{4}$/.test(secondNum)) {
          self["number"] = m[1]!;
          supp.value = secondNum;
          supp.present = true;
        } else if ((m = /^(\d+)supp?$/.exec(secondNum)) !== null) {
          self["number"] = `${firstNum}-${m[1]!}`;
          supp.value = "";
          supp.present = true;
        } else if (klass === classForKind("technical-note") && /^(19|20)\d{2}$/.test(secondNum)) {
          self["number"] = firstNum;
          self["edition"] = new NistEdition({ type: "e", id: secondNum });
          self["edition_year"] = secondNum;
        } else if (partNum !== undefined && policy.partNumAsComponent) {
          self["part"] = new NistPart({ type: "pt", value: partNum });
          self["number"] = `${firstNum}-${secondNum}`;
        } else {
          let compound = `${firstNum}-${secondNum}`;
          if (partNum !== undefined) compound += `-${partNum}`;
          self["number"] = compound;
        }
      } else {
        self["number"] = firstNum;
      }
    }

    if (extractedRevision !== undefined && extractedRevision !== "r" && self["edition"] === undefined) {
      self["edition"] = new NistEdition({ type: "r", id: extractedRevision });
    }

    // SP subseries metadata.
    if (klass === classForKind("special-publication") && firstNum !== undefined) {
      if (SP_SUBSERIES.includes(firstNum)) {
        self["subseries"] = new NistCode({ value: firstNum });
      } else {
        const m = /^(\d+GB)\b/.exec(firstNum);
        if (m !== null && SP_SUBSERIES.includes(m[1]!)) {
          self["subseries"] = new NistCode({ value: m[1]! });
        }
      }
    }

    // IR reverses the "84e2946" form back to "84-2946".
    if (policy === seriesPolicy("IR") && typeof self["number"] === "string") {
      const m = /^(\d+)e(\d{4})$/.exec(self["number"]);
      if (m !== null) {
        self["number"] = `${m[1]!}-${m[2]!}`;
        self["edition"] = undefined;
      }
    }

    if (self["publisher"] === undefined) {
      self["publisher_was_parsed"] = false;
    }

    // TN bare "-upd": Ruby's TechnicalNote#update_component= replaces a
    // dash-prefix update that has no year with the default Feb-2021 update.
    const tnSeriesCode = (identifier as unknown as { seriesCode?: () => string | undefined }).seriesCode?.();
    const bareUpdate = self["update_component"] instanceof NistUpdate ? (self["update_component"] as NistUpdate) : undefined;
    if (tnSeriesCode === "TN" && bareUpdate !== undefined && bareUpdate.prefix === "dash" && bareUpdate.year === undefined) {
      const defaulted = new NistUpdate({
        number: bareUpdate.number ?? "1",
        year: "2021",
        month: "02",
        prefix: "slash",
      });
      self["update_component"] = defaulted;
      self["update"] = defaulted;
    }

    // Revision with month+year → update component (V1 compatibility).
    if (h["revision_month"] !== undefined && h["revision_year"] !== undefined) {
      const monthNum = MONTH_NUMBERS[s(h["revision_month"]) ?? ""] ?? 1;
      const update = new NistUpdate({
        number: "1",
        year: s(h["revision_year"]),
        month: String(monthNum).padStart(2, "0"),
        prefix: "slash",
      });
      self["update_component"] = update;
      self["update"] = update;
      self["revision_year"] = undefined;
      self["revision_month"] = undefined;
    }

    if ((supp.present || supp.hasRevision) && "supplement" in identifier.constructor.attributes) {
      if (supp.rangeStart !== undefined || supp.rangeEnd !== undefined) {
        const component: Record<string, unknown> = {};
        const sm = /^([A-Za-z]{3,9})?(\d{4})$/.exec(supp.rangeStart ?? "");
        if (supp.rangeStart !== undefined && sm !== null) {
          component["month"] = sm[1];
          component["year"] = sm[2];
        }
        const em = /^([A-Za-z]{3,9})?(\d{4})$/.exec(supp.rangeEnd ?? "");
        if (supp.rangeEnd !== undefined && em !== null) {
          component["month_end"] = em[1];
          component["year_end"] = em[2];
        }
        self["supplement"] = new NistSupplement(component);
      } else {
        self["supplement"] = NistSupplement.fromRaw(supp.value, supp.hasRevision);
      }
    }

    // Default publisher for series-less renders.
    if (self["publisher"] === undefined) {
      const defaultPublisher = (identifier.constructor as unknown as { nistDefaultPublisher?: string }).nistDefaultPublisher;
      if (defaultPublisher !== undefined && defaultPublisher !== "") {
        self["publisher"] = defaultPublisher;
        if (self["publisher_was_parsed"] === false) {
          // Circular/RPT/MP render "NBS <series>" through the default even
          // when not parsed — keep the flag false (Ruby publisher_was_parsed
          // stays false but to_short_style uses default only via series).
        }
      }
    }

    return identifier;
  }

  private buildCircularSupplement(h: Record<string, unknown>): BaseIdentifier {
    if (isObj(h["supplement_slash_year"]) || isObj(h["implicit_supplement"])) {
      return this.buildCircularSupplementWrapper(h);
    }
    const seriesValue = isObj(h["circ_series"]) ? s((h["circ_series"] as TreeObject)["series"]) : s(h["series"]);

    if (isObj(h["supplement_date_range"])) {
      const range = h["supplement_date_range"] as TreeObject;
      const identifier = this.build({ series: seriesValue }, "short") as unknown as Record<string, unknown>;
      const ms = s(range["supp_month_start"]);
      const ys = s(range["supp_year_start"]);
      const me = s(range["supp_month_end"]);
      const ye = s(range["supp_year_end"]);
      identifier["supplement"] = new NistSupplement({
        month: ms,
        year: ys,
        month_end: me,
        year_end: ye,
      });
      return identifier as unknown as BaseIdentifier;
    }

    const base = this.buildCircularSupplementBase(h, seriesValue);
    const self = base as unknown as Record<string, unknown>;
    const raw =
      h["supplement_month_year"] !== undefined
        ? s(h["supplement_month_year"])
        : h["supplement_year"] !== undefined
          ? s(h["supplement_year"])
          : "";
    self["supplement"] = NistSupplement.fromRaw(raw);
    return base;
  }

  private buildCircularSupplementBase(h: Record<string, unknown>, seriesValue: string | undefined): BaseIdentifier {
    const basePortion = h["base_portion"];
    if (!isObj(basePortion)) {
      return this.build(
        {
          publisher: s(h["publisher"]),
          series: seriesValue ?? s(h["series"]),
          first_number: s(h["first_number"]),
        },
        (s(h["parsed_format"]) as "mr" | "short") ?? "short",
      );
    }
    const baseNumber = s(basePortion["simple_number"]) ?? s(basePortion["base_number"]);
    let letterSuffix: string | undefined;
    if (basePortion["letter_suffix"] !== undefined) {
      letterSuffix = (s(basePortion["letter_suffix"]) ?? "").toUpperCase();
    }
    let publisherValue: string | undefined;
    if (isObj(h["circ_series"]) && (h["circ_series"] as TreeObject)["series"] !== undefined) {
      const seriesStr = s((h["circ_series"] as TreeObject)["series"]) ?? "";
      if (seriesStr.includes(" ")) publisherValue = seriesStr.split(" ")[0];
    }
    const hasEdition = basePortion["edition_number"] !== undefined;
    let baseNumberWithSuffix = baseNumber ?? "";
    if (letterSuffix !== undefined) baseNumberWithSuffix += letterSuffix;
    if (hasEdition) baseNumberWithSuffix += `e${s(basePortion["edition_number"])}`;

    const baseHash: Record<string, unknown> = {
      series: seriesValue,
      first_number: baseNumberWithSuffix,
    };
    if (publisherValue !== undefined) baseHash["publisher"] = publisherValue;
    if (hasEdition) baseHash["edition_e"] = { edition_id: s(basePortion["edition_number"]) };
    return this.build(baseHash as TreeObject as Tree, (s(h["parsed_format"]) as "mr" | "short") ?? "short");
  }

  private buildCircularSupplementWrapper(h: Record<string, unknown>): BaseIdentifier {
    const klass = classForKind("circular-supplement");
    const supplement = new klass();
    const self = supplement as unknown as Record<string, unknown>;

    const seriesValue = isObj(h["circ_series"])
      ? s((h["circ_series"] as TreeObject)["series"])
      : s(h["series"]);

    if (isObj(h["supplement_date_range"])) {
      const range = h["supplement_date_range"] as TreeObject;
      const ms = s(range["supp_month_start"]);
      const ys = s(range["supp_year_start"]);
      const me = s(range["supp_month_end"]);
      const ye = s(range["supp_year_end"]);
      if (ms !== undefined && ys !== undefined) self["supplement_date_range_start"] = `${ms}${ys}`;
      if (me !== undefined && ye !== undefined) self["supplement_date_range_end"] = `${me}${ye}`;
      return supplement;
    }

    if (isObj(h["base_portion"])) {
      const basePortion = h["base_portion"] as TreeObject;
      const baseNumber = s(basePortion["simple_number"]) ?? s(basePortion["base_number"]);
      let letterSuffix: string | undefined;
      if (basePortion["letter_suffix"] !== undefined) {
        letterSuffix = (s(basePortion["letter_suffix"]) ?? "").toUpperCase();
      }
      let publisherValue: string | undefined;
      if (isObj(h["circ_series"]) && (h["circ_series"] as TreeObject)["series"] !== undefined) {
        const seriesStr = s((h["circ_series"] as TreeObject)["series"]) ?? "";
        if (seriesStr.includes(" ")) publisherValue = seriesStr.split(" ")[0];
      }
      const hasRevision =
        basePortion["revision_letter"] !== undefined && basePortion["revision_number"] !== undefined;
      const hasEdition = basePortion["edition_number"] !== undefined;
      let baseNumberWithSuffix = baseNumber ?? "";
      if (letterSuffix !== undefined) baseNumberWithSuffix += letterSuffix;
      if (hasEdition) baseNumberWithSuffix += `e${s(basePortion["edition_number"])}`;

      const baseHash: Record<string, unknown> = { series: seriesValue, first_number: baseNumberWithSuffix };
      if (publisherValue !== undefined) baseHash["publisher"] = publisherValue;
      if (hasEdition) baseHash["edition_e"] = { edition_id: s(basePortion["edition_number"]) };
      self["base"] = this.build(baseHash as TreeObject as Tree, (s(h["parsed_format"]) as "mr" | "short") ?? "short");
      if (hasRevision && isObj(h["implicit_supplement"])) {
        const revisionNumber = s(basePortion["revision_number"]) ?? "";
        const supplementYear = s((h["implicit_supplement"] as TreeObject)["implicit_supplement_year"]) ?? "";
        self["update"] = new NistUpdate({ number: "1", year: `${supplementYear}${revisionNumber}`, prefix: "slash" });
        self["implicit_supplement"] = true;
      }
    } else if (h["first_number"] !== undefined) {
      self["base"] = this.build(
        {
          publisher: s(h["publisher"]),
          series: seriesValue ?? s(h["series"]),
          first_number: s(h["first_number"]),
        },
        (s(h["parsed_format"]) as "mr" | "short") ?? "short",
      );
    }

    if (h["supplement_month_year"] !== undefined) {
      self["edition"] = new NistEdition({ type: "s", id: s(h["supplement_month_year"]) });
    } else if (h["supplement_year"] !== undefined) {
      self["edition"] = new NistEdition({ type: "s", id: s(h["supplement_year"]) });
    } else if (isObj(h["supplement_slash_year"])) {
      const suppHash = h["supplement_slash_year"] as TreeObject;
      const suppNumber = s(suppHash["supp_number"]) ?? "";
      const suppYear = s(suppHash["supp_year"]) ?? "";
      self["update"] = new NistUpdate({ number: "1", year: `${suppYear}${suppNumber.padStart(2, "0")}`, prefix: "slash" });
    }

    return supplement;
  }
}

export function nistGrammarImplementation(): FlavorImplementation {
  const builder = new NistBuilder();
  return {
    parse(input: string): Identifier {
      const { cleaned, format } = preprocessNist(input);
      const tree = parseGrammar(nistGrammar, cleaned);
      if (typeof tree !== "object" || tree === null) {
        throw new ParseFailed("NIST: unexpected parse tree", 0);
      }
      return builder.build(tree, format) as unknown as Identifier;
    },
  };
}
