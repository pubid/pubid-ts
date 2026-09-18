import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import { stageTokens } from "./model.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";


/**
 * Port of lib/pubid/iec/ on the unified model — 12,334 corpus rows
 * across 16 identifier types. The distinctive traits, all pinned against
 * the Ruby reference:
 * - typed stages: an abbreviation table (abbr -> {code, stageCode,
 *   typeCode}); "stage" serializes only the non-published stage CODE;
 *   type is derived from the stage's type_code.
 * - positional URN: urn:iec:std:{authority}:{number-part-subpart}:{date}:
 *   {type[-stage]}:{deliverable|edition}:{language}[:adjuncts], with EMPTY
 *   segments kept (only a bare published "ser" series drops the language
 *   slot). Supplements contribute "plus"/token/number/date adjuncts.
 * - supplements copy year/publisher/copublishers to their own hash level
 *   (Ruby delegates those reads to the base when unset; the wire shape
 *   equals copying base.publisher when it is not the IEC default).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const spaceQ = space.maybe();
  const dash = str("-").or(str("‑")).or(str("‐"));
  const digits = match("[0-9]").repeat(1, Infinity);
  const yearDigits = match("[0-9]").repeat(4, 4);
  const monthDigits = match("[0-9]").repeat(2, 2);
  const dayDigits = match("[0-9]").repeat(2, 2);
  const alnumWD = match("[A-Za-z0-9]").repeat(1, Infinity);

  // --- publishers ---
  const PUBLISHERS = ["IECQ OD", "IECQ CS", "IEC CAB", "IEC CA", "IECRE", "CISPR", "IECEE", "IECEx", "IECQ", "IEC", "ISO"];
  const ORGS = ["IEC", "ISO", "IEEE", "CIW", "SAE", "CIE", "ASME", "ASTM", "OECD", "HL7", "CEI", "UNDP"];

  rule("prefix_sole_publisher", () =>
    PUBLISHERS.reduce<P>((acc, p) => acc.or(str(p)), str(PUBLISHERS[0]!)).as("publisher"),
  );
  rule("copublishers", () =>
    str("/")
      .then(
        spaceQ,
        ORGS.reduce<P>((acc, o) => acc.or(str(o)), str(ORGS[0]!)).as("copublisher"),
      )
      .repeat(0, Infinity)
      .as("copublishers"),
  );
  rule("prefix_with_copublishers", () =>
    rules["prefix_sole_publisher"]!.then(spaceQ).then(rules["copublishers"]!.maybe()),
  );

  // --- numbers ---
  rule("number", () =>
    // DIR / VIM / SYMBOL / IECEx version / IECEE letter forms / digit runs
    (str("DIR").then((space.then(match("[A-Z0-9]").repeat(1, Infinity))).repeat(0, Infinity)))
      .or(str("VIM"))
      .or(str("SYMBOL"))
      .or(
        match("[0-9]").repeat(1, 6)
          .then(str("v"), match("[0-9]").repeat(1, Infinity), match("[a-zA-Z]").repeat(0, Infinity), str("_").then(match("[a-zA-Z]").repeat(0, Infinity)).maybe()),
      )
      .or(
        // The dash stays for part_and_subpart: "AD-001" -> number "AD",
        // part "001" (the corpus-recorded split).
        match("[A-Z]").repeat(2, 4).then(match("[A-Z0-9]").repeat(0, Infinity)),
      )
      .or(
        // TRF comma-list numbers: "60950,60065A" is ONE number.
        match("[0-9]").repeat(1, 6)
          .then((str(",").then(match("[0-9]").repeat(1, 6))).repeat(0, Infinity))
          .then(match("[a-zA-Z]").then(str("_").then(match("[a-zA-Z]").repeat(0, Infinity)).maybe()).maybe()),
      )
      .as("number"),
  );
  rule("part_and_subpart", () =>
    (dash.or(str(",")))
      .then(spaceQ)
      .then(match("[\\w&_,]").repeat(1, Infinity).as("part"))
      .then(
        (dash.or(str(",")))
          .then(spaceQ)
          .then(
            match("[\\w&_,]").repeat(1, Infinity)
              .then((dash.or(str(","))).then(match("[\\w&_,]").repeat(1, Infinity)).repeat(0, Infinity))
              .as("subpart"),
          )
          .maybe(),
      ),
  );  rule("number_with_part", () =>
    rules["number"]!.then(rules["part_and_subpart"]!.maybe()).as("number_with_part"),
  );


  // --- date ---
  rule("date", () =>
    str(":").or(dash).then(
      (str("--").or(str("—"))).as("undated_marker")
        .or(
          yearDigits
            .then(str("-").then(monthDigits).maybe())
            .then(str("-").then(dayDigits).maybe())
            .as("date"),
        ),
    ),
  );

  // --- edition / iteration / languages / all parts ---
  rule("edition", () =>
    str("Edition").or(str("Ed."), str("ED"), str("Ed"))
      .then(spaceQ)
      .then(
        digits.then(str(".").then(digits).maybe()).maybe().as("edition"),
      ),
  );
  rule("stage_iteration", () => str(".").then(match("[0-9]").as("stage_iteration")));
  rule("language", () =>
    str("(").then(
      (match("[a-z]").repeat(1, Infinity).then(str(",").maybe())
        .or(match("[EFARDS]").then(str("/").maybe()))).repeat(1, Infinity).as("languages"),
      str(")"),
    ),
  );
  rule("all_parts", () => space.then(str("(all parts)")).as("all_parts"));

  // --- typed stage token ---
  const stageAbbrs = stageTokens().sort((a, b) => b.length - a.length);
  rule("type_with_stage", () =>
    stageAbbrs.reduce<P>((acc, a) => acc.or(str(a)), str(stageAbbrs[0]!)).as("type_with_stage")
      .then(match("[0-9]").as("stage_iteration").then(space).maybe()),
  );

  // --- supplements ---
  const SUPP_ABBRS = [
    "PRF Amd", "PWI Amd", "NP Amd", "ANW Amd", "WD Amd",
    "PRF Cor", "PWI Cor", "NP Cor", "ANW Cor", "WD Cor", "CDCor", "WDCor",
    "CDAM", "DAM", "FDAM", "DCOR", "FDCOR", "AMD", "Amd", "COR", "Cor", "ISH", "Ish",
  ];
  rule("supplement_type_with_stage", () =>
    SUPP_ABBRS.reduce<P>((acc, a) => acc.or(str(a)), str(SUPP_ABBRS[0]!))
      .or(str("FRAG"))
      .as("type_with_stage"),
  );

  // --- sheets / fragments / VAP / database / consolidated ---
  rule("sheet_notation", () =>
    str("/").then(match("[0-9]").repeat(1, Infinity).as("sheet_number"), str(":"), yearDigits.as("sheet_year")),
  );
  rule("sheet_notation_no_year", () => str("/").then(match("[0-9]").repeat(1, Infinity).as("sheet_number")));
  rule("fragment_notation", () =>
    str("/").then(
      (str("FRAGC").or(str("FRAG"))).as("fragment_type"),
      match("[0-9]").repeat(1, Infinity).as("fragment_number"),
    ),
  );
  const VAP_CODES = ["CSV", "CMV", "RLV", "SER", "EXV", "PAC", "PRV"];
  rule("vap_code", () => VAP_CODES.reduce<P>((acc, v) => acc.or(str(v)), str(VAP_CODES[0]!)));
  rule("vap_suffix", () =>
    space.then(rules["vap_code"]!.then(str("-").then(rules["vap_code"]!).repeat(0, Infinity)).as("vap_suffix")),
  );
  rule("database_suffix", () => space.then(str("DB")).as("database"));
  rule("consolidated_supplement", () =>
    str("+").then(
      (str("AMD").or(str("COR"))).as("supplement_type"),
      match("[0-9]").repeat(1, Infinity).as("supplement_number"),
      (str(":").then(yearDigits.as("supplement_year"))).maybe(),
    ),
  );
  rule("consolidated_supplements", () =>
    rules["consolidated_supplement"]!.repeat(1, Infinity).as("consolidated_supplements"),
  );

  // --- second/third part ---
  rule("trf_org_number", () => str("CISPR").then(space).as("trf_org").then(rules["number_with_part"]!));
  rule("second_part", () =>
    (rules["trf_org_number"]!.or(rules["number_with_part"]!))
      .then(rules["stage_iteration"]!.maybe())
      .then((spaceQ.then(rules["date"]!)).maybe())
      .then(rules["consolidated_supplements"]!.maybe())
      .then(rules["vap_suffix"]!.or(rules["database_suffix"]!).maybe()),
  );
  rule("third_part_edition", () => spaceQ.then(rules["edition"]!).maybe());
  rule("third_part", () =>
    rules["third_part_edition"]!
      .then(rules["language"]!.maybe())
      .then(rules["fragment_notation"]!.maybe())
      .then(rules["all_parts"]!.maybe()),
  );

  // --- working programme / working document / technical group ---
  rule("wp_number", () =>
    (match("[A-Za-z0-9]").repeat(1, Infinity).then(
      dash.then(match("[0-9]").repeat(1, Infinity)).repeat(0, Infinity),
    )).as("wp_raw").or(rules["number_with_part"]!),
  );
  rule("wp_type", () => (str("TR").or(str("TS"), str("SRD"))).then(space).maybe().as("wp_type"));
  rule("working_programme", () =>
    (str("PWI").or(str("PNW"))).as("wp_stage")
      .then(space)
      .then(rules["wp_type"]!)
      .then(rules["wp_number"]!)
      .then(space.then(rules["edition"]!).maybe()),
  );
  rule("working_document", () =>
    (str("JTC1-SC").then(match("[0-9]").repeat(1, Infinity))
      .or(match("[A-Z]").repeat(1, Infinity).then(str("/"), match("[A-Z]").repeat(1, Infinity)))
      .or(alnumWD)
    ).as("technical_committee")
      .then(str("/"), alnumWD.as("wd_number"))
      .then(str("(").then(match("[A-Z]").as("wd_language"), str(")")).maybe())
      .then(str("/").then(match("[A-Z]").repeat(1, Infinity).as("wd_stage")).maybe()),
  );
  rule("tc_body", () =>
    str("CISPR")
      .or(str("CIS").then(str("/"), match("[A-Z]")))
      .or(
        (str("JTC").or(str("JPC"), str("TC"), str("SC"), str("PC")))
          .then(space, digits, match("[A-Z]").maybe()),
      ),
  );
  rule("sc_body", () => str("SC").then(space, digits, match("[A-Z]").maybe()));
  rule("technical_group", () =>
    rules["prefix_sole_publisher"]!.then(spaceQ).then(rules["copublishers"]!.maybe())
      .then(space, rules["tc_body"]!.as("technical_committee"))
      .then(str("/").then(spaceQ, rules["sc_body"]!).as("subcommittee").maybe())
      .or(
        rules["tc_body"]!.as("technical_committee")
          .then(str("/").then(spaceQ, rules["sc_body"]!).as("subcommittee").maybe()),
      ),
  );

  // --- the main single-document spine ---
  rule("guide_prefix", () => str("Guide").or(str("GUIDE")));
  rule("identifier_copublishers_no_third", () =>
    rules["guide_prefix"]!.as("type_with_stage_fr").then(space).maybe()
      .then(rules["prefix_with_copublishers"]!.maybe())
      .then(spaceQ, str("/").maybe())
      .then(rules["type_with_stage"]!.maybe())
      .then(space.maybe())
      .then(rules["second_part"]!)
      .then(rules["third_part_edition"]!),
  );
  rule("identifier_copublishers", () =>
    rules["identifier_copublishers_no_third"]!.then(rules["third_part"]!),
  );

  rule("sheet_identifier", () =>
    rules["identifier_copublishers_no_third"]!.as("base")
      .then(rules["sheet_notation"]!.or(rules["sheet_notation_no_year"]!)),
  );
  rule("sheet_supplement_identifier", () =>
    rules["identifier_copublishers_no_third"]!.as("base")
      .then(rules["sheet_notation"]!)
      .then(str("/"), rules["supplement_type_with_stage"]!)
      .then(spaceQ, rules["second_part"]!, rules["third_part"]!),
  );
  rule("supplement_identifier_no_third", () =>
    rules["identifier_copublishers_no_third"]!.as("base")
      .then(str("/"), rules["supplement_type_with_stage"]!)
      .then(spaceQ, rules["second_part"]!),
  );
  rule("supplement_identifier", () =>
    rules["supplement_identifier_no_third"]!.then(rules["third_part"]!),
  );
  rule("supplement_supplement_identifier", () =>
    rules["supplement_identifier_no_third"]!.as("base")
      .then(str("/"), rules["supplement_type_with_stage"]!)
      .then(spaceQ, rules["second_part"]!, rules["third_part"]!),
  );
  rule("standalone_supplement", () =>
    rules["prefix_with_copublishers"]!
      .then(str("/"), rules["supplement_type_with_stage"]!)
      .then(space, rules["second_part"]!, rules["third_part"]!),
  );

  rule("identifier", () =>
    rules["working_programme"]!
      .or(rules["technical_group"]!)
      .or(rules["working_document"]!)
      .or(rules["sheet_supplement_identifier"]!)
      .or(rules["sheet_identifier"]!)
      .or(rules["supplement_supplement_identifier"]!)
      .or(rules["standalone_supplement"]!)
      .or(rules["supplement_identifier"]!)
      .or(rules["identifier_copublishers"]!),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

// The parse preprocessor (Ruby Parser.parse): tab and ", Ed." normalization
// plus the IEV shorthand expansion.
export function preprocessIec(input: string): string {
  return input
    .replaceAll("\t", " ")
    .replace(/,\s+Ed\./, " Ed.")
    .replace(/^IEV(?=$|[\s-])/, "IEC 60050");
}

export const iecGrammar: Grammar = { rules: buildRules(), root: "root" };
