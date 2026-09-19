/**
 * Port of lib/pubid/nist/preprocessor.rb + data/nist/update_codes.yaml.
 * Every regex-based normalization applied before the grammar sees the
 * string. Stage order is load-bearing — later stages match patterns
 * produced by earlier ones (reordering requires the full corpus gate).
 */

const UPDATE_CODE_LINES: Record<string, string> = {
  "NBS MN": "NBS MONO",
  "NIST MN": "NIST MONO",
  "NIST MP": "NBS MP",
  "NIST SP 260-162 2006ed.": "NIST SP 260-162e2006",
  "NIST AI NIST AI 100-2e2023 ipd": "NIST AI 100-2e2023 ipd",
  "NBS CIRC 154suprev": "NBS CIRC 154r1sup",
  "NBS CIRC supJun1925-Jun1926": "NBS CIRC 24e7sup2",
  "NBS CIRC supJun1925-Jun1927": "NBS CIRC 24e7sup3",
  "NBS CIRC 25sup-1924": "NBS CIRC 25sup",
  "NIST SP 260-126 rev 2013": "NIST SP 260-126r2013",
  "NIST CSRC White Paper": "NIST CSWP",
  "NIST SP 800-56ar": "NIST SP 800-56Ar1",
  "NIST.LCIRC": "NIST.LC",
  "NBS.LCIRC": "NBS.LC",
  "NIST LCIRC": "NIST LC",
  "NBS LCIRC": "NBS LC",
  "NIST SP 800-57Pt3r1": "NIST SP 800-57pt3r1",
  NISTIR: "NIST IR",
  "NIST FIPS": "FIPS",
  "NIST.CSWP.01162020pt": "NIST.CSWP.01162020(por)",
  "NBS FIPS 11-1-Sep30": "NBS FIPS 11-1-Sep30/1977",
  "NBS FIPS 89-Sep1": "NBS FIPS 89-Sep1981",
  "FIPS PUB 54-1-Jan15": "FIPS 54-1",
  "FIPS 54-1-Jan15": "FIPS 54-1",
  "FIPS 54-1-Jan17": "FIPS 54-1-Jan17/1991",
  "FIPS PUB": "FIPS",
  "NBS CRPL c4-4": "NBS CRPL 4-4",
  "NIST AMS 300-8r1 (February 2021 update)": "NIST AMS 300-8r1/Upd1-202102",
  "NIST AMS 300-8r1/upd": "NIST AMS 300-8r1/Upd1-202102",
  "NIST IR 8115r1-upd": "NIST IR 8115r1/Upd1-202103",
  "NIST IR 8170-upd": "NIST IR 8170/Upd1-202003",
  "NIST TN 2150-upd": "NIST TN 2150/Upd1-202102",
  "NBS IR 73-197r": "NBS IR 73-197r1",
  "NBS.HB.105-1r1990": "NIST.HB.105-1r1990",
  "NBS.HB.28p11969": "NBS.HB.28-1969pt1",
  "NIST HB 105-1-1990": "NIST HB 105-1r1990",
  "NBS.FIPS.100-1-1991": "NIST.FIPS.100-1-1991",
  "NBS.LC.1088sp": "NBS.LC.1088.spa",
  "NBS LC 1088sp": "NBS LC 1088 spa",
  "NIST SP 955 Suppl.": "NIST SP 955sup",
  "NIST SP 800-38e": "NIST SP 800-38E",
  "NIST SP 782-1995-96": "NIST SP 782-1995",
  "NIST FIPS 54-Jan15": "NIST FIPS 54",
  "NBS report ;": "NBS RPT",
  "NBS TN 467p1adde1": "NBS TN 467pt1-add",
  "NIST SP 1011-II-1.0": "NIST SP 1011v2ver1.0",
  "NIST SP 1011-II-1 0": "NIST SP 1011v2ver1.0",
  "NIST SP 1011-I-2.0": "NIST SP 1011v1ver2.0",
  "NIST SP 1011-I-2 0": "NIST SP 1011v1ver2.0",
  "NIST SP 500-281-v1.0": "NIST SP 500-281v1.0",
  "NIST IR 8259Aes": "NIST IR 8259A(spa)",
  "NIST IR 8259Apt": "NIST IR 8259A(por)",
  "NIST IR 8211-upd": "NIST IR 8211/Upd1-2021",
  "NIST IR 8115r1/upd": "NIST IR 8115r1/Upd1-2021",
  "NBS CS v": "NBS CSM v",
  "NIST SP 800-57p1r2006": "NIST SP 800-57pt1r1",
  "NIST SP 800-57p1r2007": "NIST SP 800-57pt1r2",
  "NIST SP 500-268v1 1": "NIST SP 500-268v1.1",
  "NIST SP 500-270v1 1": "NIST SP 500-270v1.1",
  "NIST SP 500-280v2 1": "NIST SP 500-280v2.1",
  "NIST SP 500-281-v1 0": "NIST SP 500-281v1.0",
  "NIST SP 800-63v1 0 1": "NIST SP 800-63v1.0.1",
  "NIST SP 800-63v1 0 2": "NIST SP 800-63v1.0.2",
  "NIST SP 955 Suppl": "NIST SP 955sup",
  "NIST SP 984 4": "NIST SP 984-4",
  "NISTPUB 0413171251": "NIST TN 1648-2009",
  "NIST HB 135e2022-upd1": "NIST HB 135e2022/Upd1-202205",
  "NIST SP 1900-206-upd1": "NIST SP 1900-206/Upd1-202202",
  "NIST TN 2207-upd1": "NIST TN 2207/Upd1-202205",
  "NIST IR 8290-upd1": "NIST IR 8290/Upd1-202205",
  "NIST IR 8413-upd1": "NIST IR 8413/Upd1-202207",
  "NIST IR 85-3273-37-upd1": "NIST IR 85-3273-37/Upd1-202205",
  "NIST.AMS.300-8r1/upd": "NIST.AMS.300-8r1-upd1",
  "NIST.hb.150-1-2017": "NIST HB 105-1r2017",
  "nbs.tn.671": "NBS TN 671",
  "NIST.TN.1648_2009": "NIST TN 1648-2009",
  "NBS NSRDS": "NSRDS-NBS",
  "nist ir": "NIST IR",
};

const UPDATE_CODE_REGEXES: [RegExp, string][] = [
  [/\bMonograph\b/, "MONO"],
  [/,\s+(Rev\.|Part\.|Vol\.|Revision|Volume|Part)(?=\s|\d)/, " $1"],
  [/^NBS CIRC sup$/, "NBS CIRC 24e7sup"],
  [/-draft$/, " (Draft)"],
  [/-draft2$/, " 2pd"],
  [/NBS CRPL-F-B(?=\d+)/, "NBS CRPL-F-B "],
  [/(?<=\d)es/, "(spa)"],
  [/(?<=\d)chi/, "(zho)"],
  [/(?<=\d)viet/, "(vie)"],
  [/(?<=\d)port/, "(por)"],
  [/(?<=\d)(pt)(?!\d)/, "(por)"],
  [/(?<=\d)id/, "(ind)"],
];

const ROMAN_TO_ARABIC: Record<string, string> = {
  I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6",
  VII: "7", VIII: "8", IX: "9", X: "10",
};

function romanToArabic(roman: string): string {
  return ROMAN_TO_ARABIC[roman] ?? roman;
}

export interface PreprocessorResult {
  cleaned: string;
  format: "mr" | "short";
}

export function preprocessNist(input: string): PreprocessorResult {
  let cleaned = input.trim();
  const line = UPDATE_CODE_LINES[cleaned];
  if (line !== undefined) {
    cleaned = line;
  }
  for (const [pattern, replacement] of UPDATE_CODE_REGEXES) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  // normalize_spurious_u_suffix
  cleaned = cleaned.replace(/(\d)U([a-z])/g, "$1$2");

  // normalize_publisher_and_series
  cleaned = cleaned.replace(/^nbs\b/i, "NBS");
  cleaned = cleaned.replace(/^nist\b/i, "NIST");
  cleaned = cleaned.replace(/^(NBS|NIST)(IR|FIPS|GCR|HB|MONO|MP|NCSTAR|NSRDS)/i, "$1 $2");
  cleaned = cleaned.replace(/\b(ir|sp|tn|hb|fips|ams|vts)\b/i, (m) => m.toUpperCase());
  cleaned = cleaned.replace(/\bLC\b(?!IRC)/g, "LCIRC");

  // normalize_lcirc_supplement_contexts
  cleaned = cleaned.replace(/\bNBS LCIRC\b(?=.*\b(?:supp?|sup\+|r\d+\/)\d)/, "NBS.LCIRC");
  cleaned = cleaned.replace(/\bNBS\.LCIRC\.(\d+r\d+\/\d{4})/, "NBS LCIRC $1");
  cleaned = cleaned.replace(/\bNBS\.LCIRC\.(\d+r\d+)\b/, "NBS LCIRC $1");

  // normalize_revision_spacing
  cleaned = cleaned.replace(/([-\d]+[IVX]+[-\d]+)\s+(\d+)/g, "$1.$2");
  cleaned = cleaned.replace(/(?<!e)(\d)(rev\d{4})/g, "$1 $2");
  cleaned = cleaned.replace(/(\d+e\d+)\.([A-Za-z]{3,9}\d{4})/g, "$1rev$2");
  // normalize_ir_slash_year_to_update
  if (/\bIR\b/.test(cleaned) && !cleaned.includes("CIRC")) {
    cleaned = cleaned.replace(/(\d)r(\d{1,2})\/(\d{2,4})/g, (_m, num: string, mon: string, yr: string) => {
      const yyyy = yr.length === 2 ? `19${yr}` : yr;
      return `${num}/Upd1-${yyyy}${mon.padStart(2, "0")}`;
    });
  }
  if (!cleaned.includes("LCIRC") && !cleaned.includes("CIRC")) {
    cleaned = cleaned.replace(/(\d)(r\d+\/\d{4})/g, "$1 $2");
  }
  cleaned = cleaned.replace(/\b(r(?!v)\d{4})\b/g, " $1");
  cleaned = cleaned.replace(/(\d)(r[A-Z][a-z]{2,8}\d{4})/g, "$1 $2");

  // normalize_letter_suffix_casing
  cleaned = cleaned.replace(/(\d)-([a-z])$/, (_m, d: string, l: string) => `${d}-${l.toUpperCase()}`);
  cleaned = cleaned.replace(/(\d)([a-qs-z])$/, (_m, d: string, l: string) => `${d}${l.toUpperCase()}`);
  cleaned = cleaned.replace(/(\d)(r)(\d+)([a-z])$/, (_m, d: string, r: string, n: string, l: string) => `${d}${r}${n}${l.toUpperCase()}`);
  cleaned = cleaned.replace(/(\d)([a-z])(r\d)/g, (_m, d: string, l: string, r: string) => `${d}${l.toUpperCase()}${r}`);
  if (!cleaned.includes("NCSTAR")) {
    cleaned = cleaned.replace(/(\d)([a-qs-z])(v\d+)/g, (_m, d: string, l: string, v: string) => `${d}${l.toUpperCase()}${v}`);
  }

  // normalize_draft_and_volume
  cleaned = cleaned.replace(/(\d{2}-\d{4})\s+(\d)$/, "$1 v$2");
  cleaned = cleaned.replace(/(\d)-draft(\d)/g, "$1 -draft $2");
  cleaned = cleaned.replace(/(\d)draft(\d)/g, "$1 -draft $2");
  cleaned = cleaned.replace(/(\d)suprev/g, "$1supprev");
  cleaned = cleaned.replace(/(\d{2,})([A-Z])(r\d+)([-\s]draft\d*)/g, "$1$2 $3$4");

  // convert_roman_volumes
  cleaned = cleaned.replace(/(\d+)-([IVX]+)-(\d+(?:\.\d+)*)/g, (_m, n: string, roman: string, ver: string) => `${n} v${romanToArabic(roman)} ver${ver}`);

  // normalize_supplement_and_part
  cleaned = cleaned.replace(/(\d)(supp\d+\/\d{4})/g, "$1 $2");
  cleaned = cleaned.replace(/(\d)Pt(\d+)(r\d+)/g, "$1 pt$2 $3");

  // normalize_version_notation
  cleaned = cleaned.replace(/(\d)ver(\d)/g, "$1 ver $2");
  cleaned = cleaned.replace(/ver(\d+)e(\d{4})/g, "ver$1 e$2");
  cleaned = cleaned.replace(/ver(\d+)v(\d+)/g, "ver$1 v$2");
  cleaned = cleaned.replace(/(\d)(v\d+\.\d+)/g, "$1 $2");
  cleaned = cleaned.replace(/(\d)(v\d+\.\d+)/g, "$1 $2");
  cleaned = cleaned.replace(/(\d)(v\d+)\s+(\d+)$/g, "$1 $2.$3");
  cleaned = cleaned.replace(/(\d)(v\d+)\s+(\d+)\s+(\d+)$/g, "$1 $2.$3.$4");
  cleaned = cleaned.replace(/(\d)(v\d+[a-z]-[a-z])/g, "$1 $2");
  cleaned = cleaned.replace(/(\d)(v\d+[A-Z])/g, "$1 $2");
  cleaned = cleaned.replace(/(v\d+)([A-Z])-([A-Z])/g, (_m, v: string, a: string, b: string) => `${v}${a}-${b.toLowerCase()}`);

  // normalize_edition_year_suffix
  cleaned = cleaned.replace(/(\d{4})ed\./g, "e$1");

  // normalize_revision_with_letter
  cleaned = cleaned.replace(/(\d+)(r\d{1,2})([a-z])(?=-|[A-Z]|$)/g, (_m, n: string, r: string, l: string) => `${n}${r}${l.toUpperCase()}`);
  cleaned = cleaned.replace(/(\d+)(r\d{1,2})(?![a-zA-Z])(?=[A-Z]|-(?=[A-Z])|\/(?:upd|errata|insert))/g, "$1 $2");

  // normalize_version_dotted_spaces
  cleaned = cleaned.replace(/(\b(?:v|\d)[v\d]*[-A-Z]*)\s+(\d+)(?!(?:pd|wd|prd|PD|WD|PRD)\b)\s+(\d+)(?!(?:pd|wd|prd|PD|WD|PRD)\b)/g, "$1.$2.$3");
  cleaned = cleaned.replace(/(\b(?:v|\d)[v\d]*)\s+(\d+)(?!(?:pd|wd|prd|PD|WD|PRD)\b)/g, "$1.$2");

  // normalize_update_markers
  cleaned = cleaned.replace(/(\d+)-upd(\d*)/g, "$1 -upd$2");
  cleaned = cleaned.replace(/(\d+)\/upd(\d*)/g, "$1 /upd$2");
  cleaned = cleaned.replace(/([a-z]\d+)-upd/g, "$1 -upd");
  cleaned = cleaned.replace(/([a-z]\d+)\/upd/g, "$1 /upd");
  cleaned = cleaned.replace(/(\d+[A-Z])-upd(\d*)/g, "$1 -upd$2");
  cleaned = cleaned.replace(/(\d+[A-Z])\/upd(\d*)/g, "$1 /upd$2");

  // normalize_supplement_variants
  cleaned = cleaned.replace(/(\d)(sup\d)/g, "$1 $2");
  cleaned = cleaned.replace(/(\d)(sup+)(\d)/g, "$1 $2$3");
  cleaned = cleaned.replace(/(\d)(sup\+)(\d)/g, "$1 $2$3");
  cleaned = cleaned.replace(/(\d)(sup\d+)/g, "$1 $2");
  cleaned = cleaned.replace(/(\d)(sup\d+\b)/g, "$1 $2");
  cleaned = cleaned.replace(/(\d+[A-Z])sup(\b)/g, "$1supp$2");
  cleaned = cleaned.replace(/(\d+)sup(\d+\/\d{4})/g, "$1supp$2");
  cleaned = cleaned.replace(/(\d)(supp?)-(\d{4})(?![\d\/])/g, "$1supp$3");

  // normalize_revision_language
  cleaned = cleaned.replace(/(\d[a-z])r\b/g, "$1 r");
  cleaned = cleaned.replace(/(\d)r\z/, "$1r1");
  cleaned = cleaned.replace(/(r\d+)(es|pt|chi|viet|port|esp)\b/g, "$1 $2");

  // normalize_mr_translation_codes
  cleaned = cleaned.replace(/^([A-Z]+)\.SP\.(\d+)\.([a-z]{2,4})$/, "$1.SP.$2 $3");
  cleaned = cleaned.replace(/^([A-Z]+)\.([A-Z]+)\.(\d+)\.([a-z]{2,4})$/, "$1.$2.$3 $4");

  // convert_dashyear_to_edition
  cleaned = cleaned.replace(/(?<!e\d)(?<![eE-])(\d(?:[A-DF-Za-df-z]?))-(\d{4})(?=\s|$)/g, (match, prefix: string, year: string) => {
    const yearNum = Number(year);
    return yearNum >= 1901 && yearNum <= 2099 ? `${prefix.toUpperCase()}e${year}` : match;
  });

  // revert_dashyear_for_series
  if (cleaned.includes("CIRC")) {
    cleaned = cleaned.replace(/(CIRC[ .])(supp?)(\d{4})e(\d{4})(?=\s|$)/g, "$1$2$3-$4");
  }
  cleaned = cleaned.replace(/\b(HB|HB\s+)[^:\s.]*?(\d+)e(\d{4})(?=\s|$)/g, "$1$2-$3");
  cleaned = cleaned.replace(/\b(OWMWP|OWMWP\s*)[^:\s]*?(\d{2})-(\d{2})e(\d{4})(?=\s|$)/g, "$1$2-$3-$4");
  cleaned = cleaned.replace(/\b(RPT|RPT\s*)([^:\s]*?)(\d{4})e(\d{4})(?=\s|$)/g, (match, prefix: string, sep: string, first: string, second: string) =>
    Number(first) < Number(second) ? `${prefix}${sep}${first}-${second}` : match,
  );

  // normalize_version_verbose
  cleaned = cleaned.replace(/-v(\d+\.\d+)/g, ".ver$1");
  cleaned = cleaned.replace(/\bVer\.\s+(\d+(?:\.\d+)*)/g, "ver$1");
  cleaned = cleaned.replace(/\bv(\d+\.\d+(?:\.\d+)*)/g, "ver$1");

  // normalize_part_notation
  cleaned = cleaned.replace(/(\d)P(\d)/g, "$1 p$2");
  cleaned = cleaned.replace(/\b([pn])(\d+)(?!\d{4}\b)/g, "pt$2");
  cleaned = cleaned.replace(/(\d)([pP]\d+)/g, "$1 $2");

  // normalize_series_specific_spacing
  cleaned = cleaned.replace(/(NBS CRPL-F-[AB])(\d)/g, "$1 $2");
  cleaned = cleaned.replace(/(CRPL-F-[AB])(\d)/g, "$1 $2");
  cleaned = cleaned.replace(/(\d+-\d+)(v\d+)(?![.\d])/g, "$1 $2");

  // normalize_verbose_keywords
  cleaned = cleaned.replace(/(\d+)\s+Suppl\b/g, "$1Suppl");
  cleaned = cleaned.replace(/\s+Version\s+(\d+)/g, " ver $1");
  cleaned = cleaned.replace(/\s+Revision\s+\(r\)/g, " r");
  cleaned = cleaned.replace(/\s+Part\s+(\d+)/g, "pt$1");
  cleaned = cleaned.replace(/(\d[a-z]?)\s+Add\b\.?/gi, (_m, d: string) => `${d.toUpperCase()} Add.`);
  cleaned = cleaned.replace(/(\d+)\s+rev\s+(\d{4})/g, "$1r$2");
  cleaned = cleaned.replace(/\breport\s*;\s*/g, "RPT ");
  cleaned = cleaned.replace(/\breport\b/g, "RPT");

  const format: "mr" | "short" = input.includes(".") && !/\s/.test(input) ? "mr" : "short";
  return { cleaned, format };
}
