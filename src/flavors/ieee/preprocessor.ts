// IEEE pre-parser: regex/scan dispatch logic (Ruby: lib/pubid/ieee/pre_parser.rb)
// and the Parser.parse string-cleaning stages (Ruby: lib/pubid/ieee/parser.rb
// self.parse + normalize_* helpers), ported in the same order.

export interface PreParseResult {
  dispatch:
    | "standard"
    | "aiee_simple"
    | "iec_ieee_copublished"
    | "dual_semicolon"
    | "dual_reaffirmed"
    | "dual_ire"
    | "dual_space_separated"
    | "dual_and"
    | "dual_ampersand"
    | "aiee_asa_adoption"
    | "adopted";
  input: string;
  parts: string[];
  metadata: Record<string, string>;
}

const PUBLISHERS = [
  "IEEE", "AIEE", "ANSI", "ASA", "IEC", "ISO", "ASTM", "NACE", "NSF",
  "ASHRAE", "NCTA", "AESC",
];

const ADOPTION_PREFIXES = [
  "ANSI", "ISO", "IEC", "IEEE", "AIEE", "IRE", "ASA", "ASTM", "CSA", "ASME",
  "NACE", "NSF", "ASHRAE", "NCTA", "AESC",
];

const NON_ADOPTION_KEYWORDS = [
  "Revision", "Revison", "Amendment", "Corrigendum", "Corrigenda",
  "incorporates", "Incorporating", "Includes", "Incorporates", "Adoption",
  "Supplement", "Draft Amendment", "DRAFT Amendment", "Draft Revision",
  "Reaffirmation", "Redesignation", "redesignated as", "Supersedes",
  "Supercedes", "Includes", "Previously designated as", "Notebooks",
  "Standard Newspaper",
];

function findTopLevelPosition(input: string, marker: string): number | undefined {
  let parenDepth = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (
      parenDepth === 0 &&
      input.slice(i, i + marker.length) === marker
    ) {
      return i;
    }
  }
  return undefined;
}

function findTopLevel(input: string, marker: string): boolean {
  return findTopLevelPosition(input, marker) !== undefined;
}

function publisherPositions(input: string): { pos: number; publisher: string }[] {
  const positions: { pos: number; publisher: string }[] = [];
  for (const pub of PUBLISHERS) {
    const regex = new RegExp(`(?:^|\\s)(${pub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?:\\s|/)`, "g");
    for (const m of input.matchAll(regex)) {
      const matchPos = m.index! + m[0].indexOf(m[1]!);
      const beforeMatch = input.slice(0, matchPos);
      const open = (beforeMatch.match(/\(/g) ?? []).length;
      const close = (beforeMatch.match(/\)/g) ?? []).length;
      if (open > close) continue;
      positions.push({ pos: matchPos, publisher: pub });
    }
  }
  return positions;
}

function nonAdoptionKeyword(adoptionPart: string): boolean {
  const alternation = NON_ADOPTION_KEYWORDS
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`^\\s*(${alternation})`, "i").test(adoptionPart);
}

function adoptionPattern(input: string): boolean {
  if (!input.includes("(") || !input.includes(")")) return false;
  if (input.startsWith("IEC/IEEE ")) return false;

  const mainPart = input.split("(")[0]?.trim();
  const adoptionMatch = /\(([^)]+)\)/.exec(input);
  const adoptionPart = adoptionMatch?.[1];
  if (mainPart === undefined || mainPart === "" || adoptionPart === undefined) return false;
  if (nonAdoptionKeyword(adoptionPart)) return false;

  const prefixes = ADOPTION_PREFIXES.join("|");
  return (
    new RegExp(`\\b(${prefixes})\\s`).test(adoptionPart) ||
    new RegExp(`^\\s*(${prefixes})\\b`).test(adoptionPart) ||
    /\bStd\s+\d+/.test(adoptionPart)
  );
}

function detectDispatch(input: string): PreParseResult["dispatch"] | undefined {
  if (input.startsWith("AIEE ") && !input.includes("(")) return "aiee_simple";
  if (input.startsWith("IEC/IEEE ")) return "iec_ieee_copublished";
  if (input.includes("; ")) return "dual_semicolon";
  if (/\(R(\d{4})\)\s*\(Revision of ([^)]+)\)/.test(input) ||
      /\(Reaffirmed\s+(\d{4})\)\s*\(Revision of ([^)]+)\)/.test(input)) {
    return "dual_reaffirmed";
  }
  if (/\(R\d{4}\)\s*\((\d+\s+IRE[^)]+)\)/.test(input)) return "dual_ire";
  {
    const positions = publisherPositions(input).sort((a, b) => a.pos - b.pos);
    if (positions.length >= 2) {
      const between = input.slice(positions[0]!.pos, positions[1]!.pos);
      if (!between.includes("/") && !between.includes(" and ") && !between.includes(" & ")) {
        return "dual_space_separated";
      }
    }
  }
  if (input.includes(" and ") && findTopLevel(input, " and ")) return "dual_and";
  if (input.includes(" & ") && findTopLevel(input, " & ")) return "dual_ampersand";
  if (/^AIEE\s+/.test(input) && input.includes("(") && input.includes("ASA")) {
    return "aiee_asa_adoption";
  }
  if (adoptionPattern(input)) return "adopted";
  return undefined;
}

function buildDualSemicolon(input: string): PreParseResult {
  const parts = input.split("; ");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) return { dispatch: "standard", input, parts: [], metadata: {} };
  return {
    dispatch: "dual_semicolon", input,
    parts: [parts[0]!.trim(), parts[1]!.trim()], metadata: {},
  };
}

function buildDualReaffirmed(input: string): PreParseResult {
  const m = /\((?:R|Reaffirmed\s+)(\d{4})\)\s*\(Revision of ([^)]+)\)/.exec(input);
  if (m === null) return { dispatch: "standard", input, parts: [], metadata: {} };
  const rewritten = input.replace(
    /\((?:R|Reaffirmed\s+)\d{4}\)\s*\(Revision of ([^)]+)\)/,
    "(Revision of $1)",
  );
  return { dispatch: "dual_reaffirmed", input: rewritten, parts: [], metadata: { reaffirmed: m[1]! } };
}

function buildDualIre(input: string): PreParseResult {
  const mainPart = input.split(" (R")[0]?.trim();
  const reaffirmedMatch = /\(R(\d{4})\)/.exec(input);
  const ireMatch = /\((\d+\s+IRE[^)]+)\)/.exec(input);
  if (!mainPart || reaffirmedMatch === null || ireMatch === null) {
    return { dispatch: "standard", input, parts: [], metadata: {} };
  }
  return {
    dispatch: "dual_ire", input,
    parts: [mainPart, ireMatch[1]!], metadata: { reaffirmed: reaffirmedMatch[1]! },
  };
}

function buildDualSpaceSeparated(input: string): PreParseResult {
  const positions = publisherPositions(input).sort((a, b) => a.pos - b.pos);
  if (positions.length < 2) return { dispatch: "standard", input, parts: [], metadata: {} };
  const between = input.slice(positions[0]!.pos, positions[1]!.pos);
  if (between.includes("/") || between.includes(" and ")) {
    return { dispatch: "standard", input, parts: [], metadata: {} };
  }
  let splitPos = positions[1]!.pos;
  while (splitPos > 0 && input[splitPos - 1] === " ") splitPos -= 1;
  return {
    dispatch: "dual_space_separated", input,
    parts: [input.slice(0, splitPos).trim(), input.slice(splitPos).trim()],
    metadata: {},
  };
}

function buildDualAnd(input: string): PreParseResult {
  const position = findTopLevelPosition(input, " and ");
  if (position === undefined) return { dispatch: "standard", input, parts: [], metadata: {} };
  return {
    dispatch: "dual_and", input,
    parts: [input.slice(0, position).trim(), input.slice(position + 5).trim()],
    metadata: {},
  };
}

function buildDualAmpersand(input: string): PreParseResult {
  const parts = input.split(" & ");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) return { dispatch: "standard", input, parts: [], metadata: {} };
  return {
    dispatch: "dual_ampersand", input,
    parts: [parts[0]!.trim(), parts[1]!.trim()], metadata: {},
  };
}

function buildAieeAsaAdoption(input: string): PreParseResult {
  const mainPart = input.split("(")[0]?.trim();
  const adoptionMatch = /\((ASA[^)]+)\)/.exec(input);
  if (!mainPart || adoptionMatch === null) {
    return { dispatch: "standard", input, parts: [], metadata: {} };
  }
  return { dispatch: "aiee_asa_adoption", input, parts: [mainPart, adoptionMatch[1]!], metadata: {} };
}

function buildAdopted(input: string): PreParseResult {
  const mainPart = input.split("(")[0]?.trim();
  const adoptionMatch = /\(([^)]+)\)/.exec(input);
  const adoptionPart = adoptionMatch?.[1];
  if (!mainPart || adoptionPart === undefined) {
    return { dispatch: "standard", input, parts: [], metadata: {} };
  }
  return { dispatch: "adopted", input, parts: [mainPart, adoptionPart], metadata: {} };
}

export function preParse(input: string): PreParseResult {
  const commaDual = input.replace(/(\d{4}),\s+Std\s/, "$1 and IEEE Std ");
  switch (detectDispatch(commaDual)) {
    case "aiee_simple": return { dispatch: "aiee_simple", input: commaDual, parts: [], metadata: {} };
    case "iec_ieee_copublished": return { dispatch: "iec_ieee_copublished", input: commaDual, parts: [], metadata: {} };
    case "dual_semicolon": return buildDualSemicolon(commaDual);
    case "dual_reaffirmed": return buildDualReaffirmed(commaDual);
    case "dual_ire": return buildDualIre(commaDual);
    case "dual_space_separated": return buildDualSpaceSeparated(commaDual);
    case "dual_and": return buildDualAnd(commaDual);
    case "dual_ampersand": return buildDualAmpersand(commaDual);
    case "aiee_asa_adoption": return buildAieeAsaAdoption(commaDual);
    case "adopted": return buildAdopted(commaDual);
    default: return { dispatch: "standard", input: commaDual, parts: [], metadata: {} };
  }
}

// --- suffix / revision / joint-stage normalization (parser.rb) -------------

function normalizeRelatonSuffixes(input: string): string {
  let cleaned = input;

  // Combined draft + corrigendum: "…/D-N/CorM-YYYY[-MM]" → "…/Cor M-YYYY/DN".
  // The month of the corrigendum is intentionally dropped (matches Ruby).
  {
    const re = /^(.*)\/D-([0-9A-Za-z][0-9A-Za-z.+]*?)\/Cor\.?[ ]?(\d+)(?:-((?:19|20)\d\d))?(?:-\d\d)?$/;
    const m = re.exec(cleaned);
    if (m !== null) {
      cleaned = `${m[1]}/Cor ${m[3]}${m[4] !== undefined ? `-${m[4]}` : ""}/D${m[2]}`;
    }
  }

  // Combined draft + revision and the empty-draft revision-only form.
  {
    const re = /^(.*?)\/D-([0-9A-Za-z.+]*)\/R-([0-9A-Za-z]+)(?:-((?:19|20)\d\d)(?:-(0[1-9]|1[0-2]))?)?$/;
    const m = re.exec(cleaned);
    if (m !== null) {
      const date = m[4] !== undefined ? `-${m[4]}${m[5] !== undefined ? `-${m[5]}` : ""}` : "";
      const draftPart = m[2] === "" ? "" : `/D${m[2]}`;
      cleaned = `${m[1]}${date}${draftPart}/R-${m[3]}`;
    }
  }

  // The "/D-N-YYYY" draft-dash-date spelling is NOT repositioned: the
  // artifact grammar reads it natively (draft + printed_dash_year) and
  // the joint route renders the reference's dash-year face. The former
  // reposition onto the number predated the artifact and broke the
  // joint classification (the year left the designator's slot).

  // /E-N editions: "/E-2-2023-02" → "Edition 2.0 2023-02".
  {
    const re = /^(.*?)\/E-(\d+)(?:-((?:19|20)\d\d)(?:-(0[1-9]|1[0-2]))?)?$/;
    const m = re.exec(cleaned);
    if (m !== null) {
      const date = m[3] !== undefined ? ` ${m[3]}${m[4] !== undefined ? `-${m[4]}` : ""}` : "";
      cleaned = `${m[1]} Edition ${m[2]}.0${date}`;
    }
  }

  // /R-N revisions: reposition a trailing year onto the number, keep "/R-x".
  {
    const re = /^(.*?)\/R-([0-9A-Za-z]+)(?:-((?:19|20)\d\d))?$/;
    const m = re.exec(cleaned);
    if (m !== null) {
      cleaned = `${m[3] !== undefined ? `${m[1]}-${m[3]}` : m[1]}/R-${m[2]}`;
    }
  }

  return cleaned;
}

function normalizeRevisionNotation(input: string): string {
  let cleaned = input;

  // The reference's two glue-normalizing gsubs (parser.rb): a "REV.x"/
  // "REV-x" after-word separator and a digit-glued "2rev1" normalize to
  // a spaced boundary; the render keeps the glued face. The former
  // /R-<n> reposition rules predate the artifact grammar and diverged
  // from the reference (they ate "-rev1" spellings the artifact
  // captures natively, which cost the glued-date rows their parse).
  cleaned = cleaned.replace(/(REV|Rev|rev)[.\-](?=[A-Za-z])/g, "$1");
  cleaned = cleaned.replace(/(\d)(REV|Rev|rev)/g, "$1 $2");

  // The joint IEEE/CSA catalogue spells the type word before the
  // project number ("IEEE/CSA Draft P844.1/D2, Sept, 2016"): the P
  // already carries the project semantics (docs/IEEE-DRAFT-STAGES.md
  // §1.1), so the redundant word drops and the joint route parses.
  cleaned = cleaned.replace(/IEEE\/CSA Draft (P[A-Z0-9])/g, "IEEE/CSA $1");
  // The same redundant word rides the wider joint lists
  // ("IEEE//ISO/IEC Draft P29119-2/D=DIS-201112"); the crawl also
  // doubles the publisher slash (the 2026-10-14 ruling: the list
  // normalizes to single slashes). Drop the word and collapse the
  // slash before the joint route sees either - scoped to the D=
  // stage-draft tail (the doubled-D and stage-month tails route
  // elsewhere until the grammar carries them).
  cleaned = cleaned.replace(
    /((?:IEEE|ISO|IEC)(?:\/(?:IEEE|ISO|IEC|CSA))+)\s+Draft\s+(P[A-Z0-9][A-Z0-9.-]*\/D=[A-Z])/g,
    "$1 $2",
  );
  cleaned = cleaned.replace(/(IEEE|ISO|IEC)\/\//g, "$1/");
  // The lettered REV spellings glue to the number ("P1310Rev3") or
  // carry an after-word separator ("REV.ma", "REV-ma"); the rev rules
  // read a space or a bare word, so the boundary normalizes (the
  // render keeps the glued face). The before-word separator the Rev
  // doctrine carries ("-REVmc") is untouched.
  cleaned = cleaned.replace(/(REV|Rev|rev)[.\-](?=[A-Za-z])/g, "$1");
  cleaned = cleaned.replace(/(\d)(REV|Rev|rev)/g, "$1 $2");
  // The corrigendum's own draft rides before the ordinal in the house
  // order ("PC37.101-2006/D2, 2007/Cor. 1"): the catalogue spellings
  // ".../Cor 1, D4, July 2015" and ".../Cor 1-201x/D5, April 2012"
  // re-order into it, with the draft's date glued -YYYY-MM (pubid
  // ruling 2026-10-14: no comma dates).
  const COR_MONTHS: Record<string, string> = {
    January: "01", February: "02", March: "03", April: "04", May: "05",
    June: "06", July: "07", August: "08", September: "09", Sept: "09",
    October: "10", November: "11", December: "12", Jan: "01", Feb: "02",
    Mar: "03", Apr: "04", Jun: "06", Jul: "07", Aug: "08", Sep: "09",
    Oct: "10", Nov: "11", Dec: "12",
  };
  cleaned = cleaned.replace(
    /\/Cor(?:rigendum)? (\d+(?:-[0-9xX]{4})?)\/(D[A-Z0-9][^,]*), ([A-Za-z]+) (\d{4})/g,
    (_m, cor: string, draft: string, mon: string, year: string) => {
      const month = COR_MONTHS[mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase()];
      return month === undefined ? _m : `/${draft}-${year}-${month}/Cor. ${cor}`;
    },
  );
  cleaned = cleaned.replace(
    /\/Cor(?:rigendum)? (\d+), (D[A-Z0-9][^,]*), ([A-Za-z]+) (\d{4})/g,
    (_m, cor: string, draft: string, mon: string, year: string) => {
      const month = COR_MONTHS[mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase()];
      return month === undefined ? _m : `/${draft}-${year}-${month}/Cor. ${cor}`;
    },
  );
  // Lettered inline revisions are IDENTITY (pubid ruling 2026-10-14):
  // the grammar captures them natively with their separator; the former
  // strip rewrite here dropped the letters and is gone.
  return cleaned;
}

const STAGE_MONTH_NUMBERS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04", May: "05",
  June: "06", July: "07", August: "08", September: "09", Sept: "09",
  October: "10", November: "11", December: "12", Jan: "01", Feb: "02",
  Mar: "03", Apr: "04", Jun: "06", Jul: "07", Aug: "08", Sep: "09",
  Oct: "10", Nov: "11", Dec: "12",
};

function normalizeJointStageSpellings(input: string): string {
  let cleaned = input;

  // The IEEE-led joint list's dash/underscore stage tail carries a
  // month-name date ("IEEE/ISO/IEC P29119-2-DIS, December 2011"): the
  // generic route answers with a slashed copublisher, so re-spell the
  // stage as the D= designator the joint route reads (Ruby:
  // Parser.normalize_input). Scoped to the IEEE-led list - the
  // ISO/IEC- and IEC/IEEE-led forms already render the face.
  cleaned = cleaned.replace(
    /^(IEEE(?:\/(?:IEEE|ISO|IEC)){2,})\s+(P[A-Z0-9][A-Z0-9.-]*?)[-_](FDIS|FCD|CDV|DIS|CD|WD|PWI|NP)(\d*),\s+([A-Za-z]+)\s+(\d{4})$/,
    (_m, pubs: string, num: string, stage: string, iter: string,
      mon: string, year: string) => {
      const month = STAGE_MONTH_NUMBERS[
        mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase()
      ];
      return month === undefined
        ? _m
        : `${pubs} ${num}/D=${stage}${iter}-${year}${month}`;
    },
  );

  const pubs = "((?:ISO/IEC/IEEE|IEEE/ISO/IEC|IEEE/IEC/ISO|ISO/IEEE|IEC/IEEE|IEEE/IEC|ISO/IEC)(?:/ ?| ))";
  const stage = "(FDIS|FCD|CDV|DIS\\d?|CD\\d?|WD|PWI|NP)";
  const num = "(P?\\d+(?:[.-]\\d+)?)";
  const tail = "(,? (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \\d{4}|$|-\\d{4}(?:-\\d\\d)?)";

  // The "(\d)_D(\d)" underscore rewrite is NOT here: the reference's
  // Fix 2G/2S are ANCHORED to their publisher shapes and cannot span a
  // slash ("PC37.60/DP62271-111_D6.1" keeps its underscore) — the
  // unscoped rule rewrote rows the reference leaves verbatim.

  cleaned = cleaned.replace(new RegExp(`^${pubs}${num}/(D[\\d.]+)/ ?${stage}\\b`), "$1$4 $2/$3");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num}/ ${stage}${tail}`), "$1$3 $2$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num}/${stage} (\\d{4})\\b`), "$1$3 $2-$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num} ${stage}${tail}`), "$1$3 $2$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num} ${stage} (D\\d+)\\b`), "$1$3 $2/$4");
  // The dash-date must be a plausible year - a 4-digit monthcode (YYMM,
  // e.g. "…/CD2-1410" = October 2014) is a DRAFT designator, not a
  // dash-date, and rewriting it onto the number breaks the parse.
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num}/ ?${stage}(-(?:19|20)\\d\\d(?:-\\d\\d)?)`), "$1$3 $2$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${stage} ${num}/? ?(D\\d+)\\b`), "$1$2 $3/$4");
  // The dash-stage-with-part spelling ("ISO/IEC/IEEE P15288-DIS-1403",
  // "… P12207-FDIS-1707, June 2017"): the stage glues between the number
  // and the part. The reference renders the stage-first dot face
  // ("DIS P15288.1403") — re-spell so the stage-first route parses it
  // (a stage WITHOUT a trailing part, "P29119-2-DIS", routes elsewhere).
  cleaned = cleaned.replace(
    new RegExp(`^${pubs}P?(\\d+)-(FDIS|DIS|CDV|CD|WD)(\\d*)-(\\d+(?:\\.\\d+)*)((?:, [A-Za-z]+ \\d{4})?)$`),
    "$1$3$4 P$2.$5$6",
  );
  return cleaned;
}

// The Parser.parse cleaning pipeline, in Ruby order.
export function preprocessIeee(input: string): string {
  let cleaned = input.replace(/\.pdf$/i, "");

  cleaned = cleaned.replace(/\s+/g, " ");

  cleaned = cleaned.replace(
    /\b(ISO\/IEC\/IEEE|IEEE\/ISO\/IEC|IEEE\/IEC\/ISO|ISO\/IEEE|IEC\/IEEE|IEEE\/IEC|ISO\/IEC)\/ ?(FDIS|FCD|CDV|DIS\d?|CD\d?|WD|PWI|NP)\b/g,
    "$1 $2",
  );

  cleaned = normalizeRevisionNotation(cleaned);
  cleaned = normalizeRelatonSuffixes(cleaned);

  cleaned = cleaned.replace(/(\d)\s+-(\d{4})\b/g, "$1-$2");
  cleaned = cleaned.replace(/(\d)-\s+(\d{4})\b/g, "$1-$2");

  cleaned = cleaned.replace(/&#x2013;(?!-)/g, "-");
  cleaned = cleaned.replaceAll("&#x2013;-", "-");

  cleaned = cleaned.replace(/^!IEEE /, "IEEE ");
  cleaned = cleaned.replaceAll("IEEE/ ASTM", "IEEE/ASTM");

  cleaned = cleaned.replaceAll("&#x2122;", "™");
  cleaned = cleaned.replaceAll("&#x2019;", "'");
  cleaned = cleaned.replaceAll("&amp;amp;", "&");
  cleaned = cleaned.replaceAll("&amp;", "&");

  // The "P&V" print tail is NOT parenthesized: the artifact captures it
  // and the builder discards it (the reference renders "ANSI/IEEE
  // 500-1984" bare) — the former wrap made the parenthetical print.
  cleaned = cleaned.replace(/(\d+\.\d+)\s+(\d+\.)/g, "$1$2");
  cleaned = cleaned.replace(/\b(1|2)\s+(\d{3})\b/g, "$1$2");

  // The month-year glue split ("June2010" -> "June 2010") is NOT the
  // reference's behavior — the reference keeps the glue (the FCD ruling:
  // "FCD-June2010" is the stage + the glued month-name date), and the
  // split cost the FCD rows their classification.

  // The 8802-family IEEE-led joint prefix reorders to the ISO/IEC/IEEE
  // label (the reference's Fix 2AA): "IEEE/ISO/IEC 8802-1Q-2020" parses
  // under the ISO/IEC label and the amendment route renders ISO-first.
  cleaned = cleaned.replace(/^IEEE\/ISO\/IEC\s+(8802[\w.-]+)/, "ISO/IEC/IEEE $1");

  cleaned = normalizeJointStageSpellings(cleaned);

  cleaned = cleaned.replace(
    /(IEC\s+\d+(?:-\d+)?(?::\d{4})?(?:\s+(?:First\s+)?[Ee]dition\s+\d+(?:\.\d+)?\s+\d{4}-\d{2})?)\s+(IEEE\s+Std\s+\S+|IEEE\s+\S+)/g,
    "$1; $2",
  );
  cleaned = cleaned.replace(
    /^(IEC\s+\d+(?:-\d+)?):\d{4}(\s+(?:First\s+)?[Ee]dition\s+\d+(?:\.\d+)?\s+\d{4}-\d{2})/,
    "$1$2",
  );

  cleaned = cleaned.replaceAll("™", "");
  cleaned = cleaned.replace(/\b19969\b/g, "1969");
  cleaned = cleaned.replace(/(\d{4}),(\d{3})/g, "$1, $2");
  cleaned = cleaned.replaceAll("/lNT", "/INT");
  cleaned = cleaned.replaceAll(".l/", ".1/");
  cleaned = cleaned.replace(/\bI99O\b/g, "1990");

  cleaned = cleaned.replace(/^EEE /, "IEEE ");
  cleaned = cleaned.replace(/^I EEE /, "IEEE ");
  cleaned = cleaned.replace(/^lEEE /, "IEEE ");

  {
    const openCount = (cleaned.match(/\(/g) ?? []).length;
    const closeCount = (cleaned.match(/\)/g) ?? []).length;
    if (openCount === closeCount + 1 && !cleaned.endsWith(")")) {
      cleaned = `${cleaned})`;
    }
  }

  cleaned = cleaned.replace(/,\s*Standard\s*$/, "");
  cleaned = cleaned.replace(/[,:]\s*$/, "");
  cleaned = cleaned.replace(/,\s+and\s+IEEE\s+Std\s/, " and ");

  {
    const openCount = (cleaned.match(/\(/g) ?? []).length;
    const closeCount = (cleaned.match(/\)/g) ?? []).length;
    if (openCount > closeCount) {
      cleaned = cleaned + ")".repeat(openCount - closeCount);
    } else if (closeCount > openCount) {
      const extra = closeCount - openCount;
      cleaned = cleaned.replace(new RegExp(`\\){${extra}}$`), "");
    }
  }

  cleaned = cleaned.replace(/(\d)\s+(\d{4})(?=\s*\(|\s*$)/g, "$1-$2");
  cleaned = cleaned.replace(/\s+-\s+(\d{4})\b/g, "-$1");

  cleaned = cleaned.replace(/^IEEE\s+(?!Std\b)(\d)/, "IEEE Std $1");
  cleaned = cleaned.replace(/^IEEE\s+No\.\s*/, "IEEE Std ");
  cleaned = cleaned.replace(/^IEEE\s+No\s/, "IEEE Std ");

  cleaned = cleaned.replace(/\s+\//g, "/");
  cleaned = cleaned.replace(/,\s+(\d{4})\s+Edition/, "-$1");
  cleaned = cleaned.replace(/(ISO\/IEC)(\d)/g, "$1 $2");

  cleaned = cleaned.replace(/^IEEE\s+Std\s+(ANSI\/IEEE)/, "$1 Std");

  if (/;\s+[A-Z]{2,}/.test(cleaned)) {
    cleaned = cleaned.replace(/;\s+([A-Z][^;]+)$/, " ($1)");
  }

  cleaned = cleaned.replace(
    /,\s+(\d{4})\s+Edn\.\s+\(Reaff\s+(\d{4})\)/g,
    "-$1 (R$2)",
  );
  cleaned = cleaned.replace(
    /(\d{4})\s+Edn\.\s+\(Reaff\s+(\d{4})\)/g,
    "$1 (R$2)",
  );
  cleaned = cleaned.replace(
    /\(Reaffirmed\s+(\d{4}),\s+(\d+\s+IRE[^)]+)\)/g,
    "(R$1) ($2)",
  );
  cleaned = cleaned.replace(
    /(\d{4})\/ANSI\s+([^(]+)(?=\s*\(|$)/g,
    "$1 (ANSI $2)",
  );
  cleaned = cleaned.replace(/(ISO\/IEC\s+TR)(\d)/g, "$1 $2");

  cleaned = cleaned.replace(/\bStad\b/g, "Std");
  cleaned = cleaned.replace(/\b(IEEE|ANSI|AIEE)\s+std\b/g, "$1 Std");
  cleaned = cleaned.replaceAll("(TM)", "");

  if (/^(\d+[-.]\d+)\/D\d+/.test(cleaned)) {
    cleaned = `IEEE P${cleaned}`;
  }

  cleaned = cleaned.replaceAll("Proposed Revision of", "Revision of");
  cleaned = cleaned.replace(/\bammended\b/gi, "amended");
  cleaned = cleaned.replace(/(\/INT|\/Cor\s+\d+-\d{4})\./g, "$1");
  cleaned = cleaned.replace(
    /(\/INT),\s+([A-Z][a-z]+)\s+(\d{4})\s+Edition/,
    "$1, $2 $3",
  );
  cleaned = cleaned.replace(/\s+Ed\.\s*$/, "");

  cleaned = cleaned.replace(/\bStd\.\s+/g, "Std ");
  cleaned = cleaned.replace(
    /(\d{4})(\s+\([^)]+\))?\s+-\s+IEEE\s+Standard\s+for.*$/,
    "$1$2",
  );

  cleaned = cleaned.replace(/^IEEE\s+PC(\d)/, "IEEE Std PC$1");
  cleaned = cleaned.replace(
    /^IEEE\s+Unapproved\s+Draft\s+Std\s+PC(\d)/,
    "IEEE Unapproved Draft Std PC$1",
  );
  cleaned = cleaned.replace(
    /^IEEE\s+P(\d+)\s+and\s+ASHRAE/,
    "IEEE Std P$1 and ASHRAE",
  );

  cleaned = cleaned.replace(/^(ISO\/IEC \d+[-.]\d+-\d{4}):.*$/, "$1");
  cleaned = cleaned.replace(/^(ISO\/IEC \d+-\d{4}):.*$/, "$1");
  cleaned = cleaned.replace(/^(ISO\/IEC \d+[-.]\d*)\s*:\s*(\d{4})/, "$1:$2");
  cleaned = cleaned.replace(/^(ISO\/IEC \d+)\s*:\s*(\d{4})/, "$1:$2");

  cleaned = cleaned.replace(/^(IEC\/IEEE P[\w.-]+)_D/, "$1/D");

  // The printed publisher order is identity (pubid#469, the
  // dual-perspective ruling): no IEEE/ISO/IEC or IEEE/IEC/ISO rewrites —
  // the reference parses as printed and renders the printed order back.
  cleaned = cleaned.replace(/^(IEEE\/IEC P[\w.-]+)\s+D(\d)/, "$1/D$2");
  cleaned = cleaned.replace(
    /^(IEEE\/IEC P[\w.-]+)\s+(CDV|FDIS|CD|DIS|ED\d)/,
    "$1/$2",
  );

  cleaned = cleaned.replace(/^ISO\s+\/IEC\/IEEE/, "ISO/IEC/IEEE");
  cleaned = cleaned.replace(/^ISO\s+\/IEC/, "ISO/IEC");
  cleaned = cleaned.replace(/^IS0\//, "ISO/");

  cleaned = cleaned.replace(
    /^IEEE-P(\d+)-(\d+)-DIS-(.*)/,
    "ISO/IEC/IEEE P$1-$2/DIS, $3",
  );
  cleaned = cleaned.replace(
    /^IEEE\/CSA\s+(P[\d.]+)\/([\d.]+)\/D(\d+)/,
    "IEEE/CSA $1/D$3",
  );

  cleaned = cleaned.replace(
    /^IEEE\s+Approved\s+Draft\s+Std\s+(P\d)/,
    "IEEE Approved Draft Std $1",
  );
  cleaned = cleaned.replace(
    /^(IEEE Approved Draft Std P[\w.-]+)\s+\/\s*D/,
    "$1/D",
  );

  cleaned = cleaned.replace(/^AIEE\s+No\.\s*(\d)/, "AIEE No. $1");
  cleaned = cleaned.replace(/^AIEE\s+no\s/, "AIEE No ");
  cleaned = cleaned.replace(/^AIEE\s+Std\s+No\.\s*/, "AIEE Standard No ");

  cleaned = cleaned.replace(/^IEEE\s+PSI\s+(\d)/, "IEEE/ASTM PSI $1");

  cleaned = cleaned.replace(/^(IEEE\/IEC P[\d.-]+\/PC[\d.]+)_D/, "$1/D");
  cleaned = cleaned.replace(
    /^IEC\s+(P[\d.-]+)\/IEEE\s+(PC[\d.]+)_D/,
    "IEC/IEEE $2/D",
  );
  cleaned = cleaned.replace(/^IEC\/IEC\s+(P\d)/, "IEC/IEEE $1");

  cleaned = cleaned.replace(
    /^(NACE\s+SP\d+-\d+)\/(IEEE\s+Std\s+\d+-\d+)$/,
    "$1 ($2)",
  );

  cleaned = cleaned.replaceAll("Edn.", "Edition");
  cleaned = cleaned.replaceAll("ASHARE", "ASHRAE");
  cleaned = cleaned.replace(/^PC(\d)/, "P$1");
  cleaned = cleaned.replace(
    /^(IEEE\s+C?\d[\d.]*\/D\d+)([A-Z][a-z]+\s+\d{4})/,
    "$1, $2",
  );
  cleaned = cleaned.replace(/^(ANSI\/IEEE Std):\s+.*$/, "$1");
  cleaned = cleaned.replace(
    /^(IEEE\s+[\d.]+)\s+(IEC\s+\d+[-\d]*\s+.*edition\s+\d{4}-\d{2})$/i,
    "$1; $2",
  );
  cleaned = cleaned.replace(
    /^IEEE\s+No\s+(\d+-\d+)\s+\/\s+ASA\s+(.*)/,
    "IEEE Std $1 (ASA $2)",
  );

  return cleaned;
}
