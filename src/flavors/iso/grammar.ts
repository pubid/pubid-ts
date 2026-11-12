import { Grammar, P, match, ref, str } from "../../grammar/engine.js";
import { stageTokens } from "./model.js";
import { ISO_TYPED_STAGES } from "./stages.generated.js";

/**
 * Port of lib/pubid/iso/parser.rb. The identifier alternation order is
 * load-bearing (PEG ordered choice): nsb_iso | tc_document |
 * directives | jcgm | iso_r_supplement | iso_r | suppl³ | suppl² |
 * suppl | joint | copublishers. Stage tokens come from the typed-stage
 * registry (longest first), split into base (non-supplement) and
 * supplement tables exactly like the Ruby TYPED_STAGES constants.
 */

const SUPPLEMENT_TYPE_KEYS = ["amd", "cor", "suppl", "ext", "add"];

/** The DAM-family ballot stage codes (grammar table
 * typed_stages_ballots: PDAM, DAM, DAmd, FDAM, FDAmd, FPDAM — exactly
 * these entries' abbrs); the TYPE-first ballot branch stays scoped to
 * the ballot family. */
export const BALLOT_STAGE_CODES = ["pdam", "damd", "fdamd", "fpdam"];

const BASE_STAGE_TOKENS = stageTokens().filter((t) => {
  // Supplement tokens are excluded from the base table by type key, but
  // stageTokens() is type-agnostic here; the split is done via the
  // supplement table below (tokens unique to supplement types).
  return true;
});

const DIRECTIVES_TOKENS = ["Directives Part", "Directives, Part", "Directives,", "Directives", "DIR"];
const DIRECTIVES_SUPPLEMENT_TOKENS = ["DIR SUP", "Supplement", "SUP"];

const ORGANIZATIONS = [
  "ISO", "IEC", "IEEE", "CIW", "SAE", "CIE", "ASME", "ASTM", "OECD", "HL7", "CEI", "UNDP",
];

const TC_TYPES = [
  "TC", "JTC", "PC", "IT", "CAB", "CASCO", "COPOLCO", "COUNCIL", "CPSG", "CS",
  "DEVCO", "GA", "GAAB", "INFCO", "ITN", "ISOlutions", "REMCO", "TMB", "TMBG",
  "WMO", "DMT", "JCG", "SGPM", "ATMG", "CCCC", "CCCC-TG", "JDMT", "JSAG",
  "JSCTF-TF", "JTCG", "JTCG-TF", "SAG_Acc", "SAG_CRMI", "SAG_CRMI_CG",
  "SAG_ESG", "SAG_ESG_CG", "SAG_MRS", "SAG_SF", "SAG_SF_CG", "SMCC", "STMG",
  "MENA_STAR",
];

const WG_TYPES = [
  "AG", "AhG", "WG", "JWG", "QC", "TF", "PPC", "CAG", "CSC", "ITSAG",
  "CSC/FIN", "CSC/NOM", "CSC/OVE", "CSC/SP", "CSC", "SF", "ITSG", "JAG",
  "JCTF", "JSG", "JTAG", "JTG",
];

function literalAlternation(tokens: string[]): P {
  const sorted = [...new Set(tokens)].sort((a, b) => b.length - a.length);
  return sorted.map((t) => str(t)).reduce((a, b) => a.or(b));
}

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  const yearDigits = digit.repeat(4, 4);
  const monthDigits = digit.repeat(2, 2);
  const dayDigits = digit.repeat(2, 2);
  const dashChars = ["-", "‑", "‐"];
  const dash = literalAlternation(dashChars);

  rule("publisher", () => str("ISO").or(str("IEC")).as("publisher"));

  rule("copublishers", () =>
    str("/")
      .then(space.maybe(), literalAlternation(ORGANIZATIONS).as("copublisher"))
      .repeat(0, Infinity)
      .as("copublishers"),
  );

  // (:|dash)(-- undated | Y[-M[-D]]), all optional after the separator.
  rule("date", () =>
    str(":")
      .or(dash)
      .then(
        str("--")
          .or(str("—"))
          .as("undated_marker")
          .or(
            yearDigits
              .then(
                dash.then(monthDigits).maybe(),
                dash.then(dayDigits).maybe(),
              )
              .as("date"),
          )
          .maybe(),
      ),
  );

  rule("number", () => digit.repeat(1, 5));

  // Modern "-A01", "-5-1-1" (space-tolerant) vs legacy "/6" (guarded
  // against supplement type names).
  rule("part_and_subpart", () =>
    dash
      .then(
        space.maybe(),
        match("\\w").repeat(1, Infinity),
        dash.then(match("\\w").repeat(1, Infinity)).repeat(0, Infinity).maybe(),
      )
      .or(
        str("/").then(
          space.maybe(),
          ref(rules, "supplement_type_with_stage").absent(),
          match("\\w").repeat(1, Infinity),
        ),
      ),
  );

  rule("number_with_part", () =>
    rules["number"]!.then(rules["part_and_subpart"]!.maybe()).as("number_with_part"),
  );

  rule("all_parts", () => str("(all parts)").as("all_parts"));

  const supplementTypeTokens = stageTokens(SUPPLEMENT_TYPE_KEYS);
  const baseStageTokens = BASE_STAGE_TOKENS.filter((t) => !supplementTypeTokens.includes(t));

  rule("type_with_stage", () =>
    literalAlternation(baseStageTokens)
      .as("type_with_stage")
      .then(digit.as("stage_iteration").then(space).maybe()),
  );

  rule("supplement_type_with_stage", () =>
    literalAlternation(supplementTypeTokens).as("type_with_stage"),
  );

  // (en,fr) or (E/F) — repeated captures joined.
  rule("language", () =>
    str("(").then(
      match("[a-z]")
        .repeat(1, Infinity)
        .then(str(",").maybe())
        .or(match("[EFARDS]").then(str("/").or(str(",")).maybe()))
        .repeat(0, Infinity)
        .as("languages"),
      str(")"),
    ),
  );

  rule("edition", () =>
    literalAlternation(["Edition", "Ed.", "ED", "Ed"])
      .then(space.maybe(), digits.maybe())
      .as("edition"),
  );

  rule("stage_iteration", () => str(".").then(digit.as("stage_iteration")));

  rule("second_part", () =>
    rules["number_with_part"]!
      .then(
        rules["stage_iteration"]!.maybe(),
        space.maybe(),
        rules["date"]!.maybe(),
      ),
  );

  rule("third_part_edition", () => space.maybe().then(rules["edition"]!.maybe()));

  rule("third_part", () =>
    rules["third_part_edition"]!
      .then(
        rules["language"]!.maybe(),
        space.maybe(),
        rules["all_parts"]!.maybe(),
      ),
  );

  rule("guide_prefix", () => str("Guide").or(str("GUIDE")));

  rule("prefix_with_copublishers", () =>
    str("ISO/R")
      .as("iso_r_prefix")
      .then(space)
      .or(
        rules["publisher"]!
          .then(space.maybe(), rules["copublishers"]!.maybe()),
      ),
  );

  rule("identifier_copublishers_no_third", () =>
    rules["guide_prefix"]!
      .as("type_with_stage_fr")
      .then(space)
      .maybe()
      .then(
        rules["prefix_with_copublishers"]!.maybe(),
        space.maybe(),
        str("/").maybe(),
        rules["type_with_stage"]!.maybe(),
        space.maybe(),
        rules["second_part"]!,
        rules["third_part_edition"]!,
      ),
  );

  rule("identifier_copublishers", () =>
    rules["identifier_copublishers_no_third"]!.then(rules["third_part"]!),
  );

  // NSB-prefixed: FprISO… / WD/ISO…
  const nsbBody = () =>
    rules["publisher"]!
      .then(
        space.maybe(),
        rules["copublishers"]!.maybe(),
        space.maybe(),
        rules["type_with_stage"]!.maybe(),
        space.maybe(),
        rules["second_part"]!,
        rules["third_part"]!,
      );
  rule("nsb_iso_identifier", () =>
    str("Fpr")
      .as("nsb_stage")
      .then(nsbBody())
      .or(str("WD").as("nsb_stage").then(str("/"), nsbBody())),
  );

  // TC documents: ISO/TC 184/SC 4/WG 3 N 123[:year]
  rule("tc_type", () => literalAlternation(TC_TYPES).as("tc_type"));
  rule("sc_type", () => str("SC/QC").or(str("SC")).as("sc_type"));
  rule("wg_type", () => literalAlternation(WG_TYPES).as("wg_type"));
  // Bare TC reference (pubid-iso#285): "184/SC 4/WG 12 N10291" — the
  // ISO/TC route without the ORIGINATOR prefix; the SC segment is
  // required so bare numbers cannot leak into the route.
  rule("bare_tc_document", () =>
    digits.as("tc_number")
      .then(str("/"), rules["sc_type"]!, space, digits.as("sc_number"))
      .then(
        str("/"),
        rules["wg_type"]!,
        space,
        digits.as("wg_number"),
      ).maybe()
      .then(space, str("N"), space.maybe(), digits.as("number"))
      .then(str(":"), yearDigits.as("year")).maybe(),
  );
  rule("tc_subcommittee_part", () =>
    str("/")
      .then(
        rules["sc_type"]!,
        space,
        digits.as("sc_number"),
        str("/"),
        rules["wg_type"]!,
        space,
        digits.as("wg_number"),
      )
      .or(str("/").then(rules["sc_type"]!, space, digits.as("sc_number"))),
  );
  rule("tc_document", () =>
    rules["publisher"]!
      .then(
        str("/").or(space),
        rules["tc_type"]!,
        space,
        digits.as("tc_number"),
        rules["tc_subcommittee_part"]!.maybe(),
        space,
        str("N"),
        space.maybe(),
        digits.as("number"),
        str(":").then(yearDigits.as("year")).maybe(),
      ),
  );

  // JCGM 200:2008(F)
  rule("jcgm_identifier", () =>
    str("JCGM")
      .as("publisher")
      .then(space, rules["second_part"]!, rules["third_part"]!),
  );

  // Legacy ISO/R forms.
  rule("iso_r_second_part", () =>
    rules["number_with_part"]!
      .then(
        rules["stage_iteration"]!.maybe(),
        space.maybe(),
        rules["date"]!.maybe(),
      ),
  );
  rule("iso_r_identifier", () =>
    str("ISO/R")
      .as("iso_r_prefix")
      .then(space, rules["iso_r_second_part"]!, rules["third_part"]!),
  );
  rule("iso_r_supplement_separator", () =>
    str("/").or(space.maybe().then(str("—"), space.maybe()), space.then(str("-"), space)),
  );
  rule("iso_r_supplement_identifier", () =>
    str("ISO/R")
      .as("iso_r_prefix")
      .then(space, rules["iso_r_second_part"]!)
      .as("base")
      .then(
        rules["iso_r_supplement_separator"]!,
        rules["supplement_type_with_stage"]!,
        space.maybe(),
        rules["second_part"]!,
        rules["third_part"]!,
      ),
  );

  // Supplements: base + "/" + stage + (second_part | .N | date)? [+ third]
  rule("supplement_identifier_no_third", () =>
    rules["identifier_copublishers_no_third"]!
      .as("base")
      .then(
        str("/"),
        rules["supplement_type_with_stage"]!,
        space
          .maybe()
          .then(rules["second_part"]!)
          .or(
            str(".").then(digits.as("number")),
            space.maybe().then(rules["date"]!),
          )
          .maybe(),
      ),
  );
  rule("supplement_identifier", () =>
    rules["supplement_identifier_no_third"]!.then(rules["third_part"]!),
  );
  rule("supplement_supplement_identifier", () =>
    rules["supplement_identifier_no_third"]!
      .as("base")
      .then(
        str("/"),
        rules["supplement_type_with_stage"]!,
        space
          .maybe()
          .then(rules["second_part"]!, rules["third_part"]!)
          .or(str(".").then(digits.as("number"), rules["third_part"]!)),
      ),
  );
  rule("supplement_supplement_supplement_identifier", () =>
    rules["supplement_supplement_identifier"]!
      .as("base")
      .then(
        str("/"),
        rules["supplement_type_with_stage"]!,
        space
          .maybe()
          .then(rules["second_part"]!, rules["third_part"]!)
          .or(str(".").then(digits.as("number"), rules["third_part"]!)),
      ),
  );

  // Directives.
  rule("directives_publisher_subgroup", () => str("JTC 1").as("subgroup"));
  rule("directives_part_and_subpart", () =>
    space.then(
      str("ISO").or(str("IEC")),
      str("/").absent(),
      space.then(str("SUP")).absent(),
    ),
  );
  rule("directives_number_with_part", () =>
    rules["number"]!
      .then(rules["directives_part_and_subpart"]!.maybe())
      .as("number_with_part"),
  );
  rule("directives_identifier_no_third", () =>
    rules["prefix_with_copublishers"]!
      .then(
        space.maybe(),
        rules["directives_publisher_subgroup"]!.then(space).maybe(),
        literalAlternation(DIRECTIVES_TOKENS).as("type_with_stage"),
        space
          .then(
            rules["directives_publisher_subgroup"]!,
            space.then(str("SUP")).absent(),
          )
          .maybe(),
        space
          .then(rules["directives_number_with_part"]!)
          .maybe()
          .then(str(":").then(rules["date"]!).maybe())
          .maybe(),
      ),
  );
  rule("directives_identifier", () =>
    rules["directives_identifier_no_third"]!
      .then(
        rules["third_part"]!.maybe(),
        space.maybe(),
        rules["date"]!.maybe(),
      ),
  );

  rule("directives_supplement_part_no_third", () =>
    space
      .maybe()
      .then(str("--"), space.maybe(), str("Consolidated"), space)
      .maybe()
      .then(
        str("ISO/IEC").or(str("ISO"), str("IEC"), str("JTC 1")).as("publisher"),
        space.then(literalAlternation(DIRECTIVES_SUPPLEMENT_TOKENS).as("type_with_stage")),
        rules["date"]!.maybe(),
      ),
  );
  rule("directives_supplement_part", () =>
    rules["directives_supplement_part_no_third"]!.then(rules["third_part"]!.maybe()),
  );
  rule("directives_supplement_identifier", () =>
    rules["directives_identifier_no_third"]!
      .as("base")
      .then(space.maybe(), rules["directives_supplement_part"]!),
  );
  rule("directives_bundled_identifier", () =>
    rules["directives_identifier_no_third"]!
      .then(
        rules["third_part"]!.then(space.maybe()).maybe(),
        rules["date"]!.then(space.maybe()).maybe(),
      )
      .as("base_document")
      .then(
        str("+ ")
          .then(rules["directives_supplement_part_no_third"]!.as("supplement"))
          .repeat(1, Infinity)
          .as("supplements"),
      ),
  );
  rule("directives_identifiers", () =>
    rules["directives_bundled_identifier"]!.or(
      rules["directives_supplement_identifier"]!,
      rules["directives_identifier"]!,
    ),
  );

  // Joint ISO|IDF — IDF side unreachable by the corpus (no rows); the
  // twin is captured raw like ITU's common-text twin.
  rule("idf_identifier", () => match("[^|]").repeat(1, Infinity).as("idf_raw"));
  rule("joint_identifier", () =>
    rules["identifier_copublishers_no_third"]!
      .as("base")
      .then(
        space.maybe(),
        str("|"),
        space.maybe(),
        rules["idf_identifier"]!,
      )
      .as("joint_identifier"),
  );

  // Historic TYPE-first ballot faces (decode-to-modern, owner ruling
  // 2026-11-12): the DAM-family token in TYPE position — "ISO/IEC FDAM 1
  // 14496-12:2004", "ISO/PDAM 19973-2" — and the space-attached ballot
  // face "ISO 15877-5:2009 FDAM 1". Both branches sit LAST in the
  // identifier alternation, so they are purely additive: every face an
  // earlier branch parses keeps its exact parse. The ballot token
  // captures as ballot_type_with_stage; a number on the TYPE token is
  // space-bounded (ballot_number) so "PDAM 19973-2" keeps 19973 in the
  // base; an on-base stamp's number/date capture as ballot_stamp_* (the
  // stamp token itself matches uncaptured — the ballot's stage comes
  // from the TYPE token and the decode keeps no spelling). The builder
  // folds the captures into ONE amendment layer over the whole base, the
  // number taken from the TYPE token, the stamp, or the implied 1.
  const ballotStageTokens = ISO_TYPED_STAGES
    .filter((st) => BALLOT_STAGE_CODES.includes(st.code))
    .flatMap((st) => st.abbr);
  const ballotTypeAlt = literalAlternation(ballotStageTokens).as("ballot_type_with_stage");

  rule("ballot_type_with_stage", () => ballotTypeAlt);

  // An on-base stamp riding a ballot face ("/Amd 9:2001", "/Amd.1",
  // "/Am1:2006"): it carries the amendment's number and ballot date
  // while its own token letters are decode-away (matched uncaptured).
  // The stamp's date captures under its own ballot_stamp_* names —
  // reusing the base date capture would collide with second_part's at
  // the sequence merge and the stamp's year would eat the base's.
  rule("ballot_stamp", () =>
    str("/")
      .then(literalAlternation(supplementTypeTokens))
      .then(
        space
          .maybe()
          .then(digit.repeat(1, 5).as("ballot_stamp_number"))
          .then(
            str(":")
              .or(dash)
              .then(
                yearDigits
                  .then(dash.then(monthDigits).maybe(), dash.then(dayDigits).maybe())
                  .as("ballot_stamp_date"),
              )
              .or(
                str(":")
                  .or(dash)
                  .then(str("--").or(str("—")).as("ballot_stamp_undated_marker")),
              )
              .maybe(),
          )
          .or(str(".").then(digits.as("ballot_stamp_dot_number"))),
      ),
  );
  // "ISO/IEC FDAM 1 14496-12:2004", "ISO/PDAM 19973-2": the ballot
  // token first, then the base kept whole. The TYPE-token number is
  // space-bounded on both sides — mandatory trailing space — so
  // "PDAM 19973-2" cannot read 19973 as the ballot number: with no
  // second space the group backtracks and 19973 parses in second_part.
  rule("ballot_supplement_identifier", () =>
    rules["prefix_with_copublishers"]!
      .then(
        space.maybe(),
        str("/").maybe(),
        ballotTypeAlt,
        space.then(digit.repeat(1, Infinity).as("ballot_number")).then(space).maybe(),
        space.maybe(),
        rules["type_with_stage"]!.maybe(),
        space.maybe(),
        rules["second_part"]!,
        rules["ballot_stamp"]!.maybe(),
      ),
  );

  // The space-attached ballot face: "ISO 15877-5:2009 FDAM 1" — the
  // base designation first, then the ballot token attached by a space.
  // The base front is inlined (not identifier_copublishers_no_third):
  // that rule ends in third_part_edition, whose own optional space
  // would consume the separator the ballot token needs. No base
  // edition is served here — none of the stored or owner-cited ballot
  // faces carries one.
  rule("ballot_space_supplement_identifier", () =>
    rules["guide_prefix"]!
      .as("type_with_stage_fr")
      .then(space)
      .maybe()
      .then(
        rules["prefix_with_copublishers"]!.maybe(),
        space.maybe(),
        str("/").maybe(),
        rules["type_with_stage"]!.maybe(),
        space.maybe(),
        rules["second_part"]!,
        space,
        ballotTypeAlt,
        space.then(digit.repeat(1, Infinity).as("ballot_number")).maybe(),
      ),
  );

  rule("identifier", () =>
    rules["bare_tc_document"]!.or(
      rules["nsb_iso_identifier"]!,
      rules["tc_document"]!,
      rules["directives_identifiers"]!,
      rules["jcgm_identifier"]!,
      rules["iso_r_supplement_identifier"]!,
      rules["iso_r_identifier"]!,
      rules["supplement_supplement_supplement_identifier"]!,
      rules["supplement_supplement_identifier"]!,
      rules["supplement_identifier"]!,
      rules["joint_identifier"]!,
      rules["identifier_copublishers"]!,
      // The historic ballot faces go last — purely additive branches
      // (an input an earlier member parses keeps that parse).
      rules["ballot_supplement_identifier"]!,
      rules["ballot_space_supplement_identifier"]!,
    ),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const isoGrammar: Grammar = { rules: buildRules(), root: "root" };
