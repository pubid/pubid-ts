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

  // /D-N drafts with a trailing numeric date: reposition onto the number.
  {
    const re = /^(.*)\/D-([0-9A-Za-z][0-9A-Za-z.+]*?)-((?:19|20)\d\d)(?:-(0[1-9]|1[0-2]))?$/;
    const m = re.exec(cleaned);
    if (m !== null) {
      cleaned = `${m[1]}-${m[3]}${m[4] !== undefined ? `-${m[4]}` : ""}/D${m[2]}`;
    }
  }

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

  // Numbered revisions preserved, repositioned to "/R-<n>".
  cleaned = cleaned.replace(/(\/D-?[0-9A-Za-z.]+)\s+[Rr][Ee][Vv]\s*(\d+)/, "$1/R-$2");
  cleaned = cleaned.replace(/[-/_.]?\s?[Rr][Ee][Vv][-\s]?(\d+)(\/D-?[0-9A-Za-z.]+)/, "$2/R-$1");
  cleaned = cleaned.replace(/(\d)[-._]?\s?[Rr][Ee][Vv]\s*(\d+)\s*$/, "$1/R-$2");

  // Lettered inline revisions stripped.
  cleaned = cleaned.replace(
    /[-/_.]?\s?[Rr][Ee][Vv][-\s]?[A-Za-z0-9]+(?=\/D-?[0-9A-Za-z])/,
    "",
  );
  cleaned = cleaned.replace(/(\d)[Rr][Ee][Vv][A-Za-z0-9]+\s*$/, "$1");
  return cleaned;
}

function normalizeJointStageSpellings(input: string): string {
  let cleaned = input;

  const pubs = "((?:ISO/IEC/IEEE|IEEE/ISO/IEC|IEEE/IEC/ISO|ISO/IEEE|IEC/IEEE|IEEE/IEC|ISO/IEC)(?:/ ?| ))";
  const stage = "(FDIS|FCD|CDV|DIS\\d?|CD\\d?|WD|PWI|NP)";
  const num = "(P?\\d+(?:[.-]\\d+)?)";
  const tail = "(,? (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \\d{4}|$|-\\d{4}(?:-\\d\\d)?)";

  cleaned = cleaned.replace(/(\d)_D(\d)/g, "$1/D$2");
  cleaned = cleaned.replace(/,(?=[A-Za-z])/, ", ");

  cleaned = cleaned.replace(new RegExp(`^${pubs}${num}/(D[\\d.]+)/ ?${stage}\\b`), "$1$4 $2/$3");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num}/ ${stage}${tail}`), "$1$3 $2$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num}/${stage} (\\d{4})\\b`), "$1$3 $2-$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num} ${stage}${tail}`), "$1$3 $2$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num} ${stage} (D\\d+)\\b`), "$1$3 $2/$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${num}/ ?${stage}(-\\d{4}(?:-\\d\\d)?)`), "$1$3 $2$4");
  cleaned = cleaned.replace(new RegExp(`^${pubs}${stage} ${num}/? ?(D\\d+)\\b`), "$1$2 $3/$4");
  return cleaned;
}

// The Parser.parse cleaning pipeline, in Ruby order.
export function preprocessIeee(input: string): string {
  let cleaned = input.replace(/\.pdf$/i, "");

  cleaned = cleaned.replace(/_(FDIS|CDV|CD|DIS|WD|PWI|NP)/g, "/$1");
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

  cleaned = cleaned.replace(/\s+(P&V)\s*$/, " ($1)");
  cleaned = cleaned.replace(/(\d+\.\d+)\s+(\d+\.)/g, "$1$2");
  cleaned = cleaned.replace(/\b(1|2)\s+(\d{3})\b/g, "$1$2");

  cleaned = cleaned.replace(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)(\d{4})\b/g,
    "$1 $2",
  );
  cleaned = cleaned.replace(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(\d{4})\b/g,
    "$1 $2",
  );

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

  {
    const m = /AIEE\s+Nos\s+(\d+)\s+and\s+(\d+)\s+-\s+(\d{4})/.exec(cleaned);
    if (m !== null) {
      cleaned = cleaned.replace(
        /AIEE\s+Nos\s+(\d+)\s+and\s+(\d+)\s+-\s+(\d{4})/,
        `AIEE No ${m[1]}-${m[3]} and AIEE No ${m[2]}-${m[3]}`,
      );
    }
  }

  cleaned = cleaned.replace(/\bStad\b/g, "Std");
  cleaned = cleaned.replace(/\b(IEEE|ANSI|AIEE)\s+std\b/g, "$1 Std");
  cleaned = cleaned.replaceAll("(TM)", "");

  if (/^(\d+[-.]\d+)\/D\d+/.test(cleaned)) {
    cleaned = `IEEE P${cleaned}`;
  }

  cleaned = cleaned.replace(/\/Preprint\b/g, "");
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

  cleaned = cleaned.replace(/^IEEE\/ISO\/IEC\s+(P[\w.-]+)/, "ISO/IEC/IEEE $1");
  cleaned = cleaned.replace(/^IEEE\/IEC\/ISO\s+(P[\w.-]+)/, "IEC/ISO/IEEE $1");
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
  cleaned = cleaned.replace(/^IEEE\/ISO\/IEC\s+(8802[\w.-]+)/, "ISO/IEC/IEEE $1");
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
