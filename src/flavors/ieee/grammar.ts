import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/ieee/parser.rb (and the aiee/ire/nesc sub-parsers),
 * 1:1. The identifier alternation order is load-bearing.

 * Parslet notes preserved from the Ruby: sequences fold strings away when a
 * capture appears; `.as()` wraps the whole then-chain it closes; duplicate
 * capture keys in one sequence raise ("Duplicate subtrees"), which the Ruby
 * grammar avoids by design (distinct :trailing_year vs :year keys etc.).
 */

const MONTHS = [
  "Sept.", "Oct.", "Nov.", "Dec.", "Jan.", "Feb.", "Mar.", "Apr.",
  "Jun.", "Jul.", "Aug.",
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept",
  "Oct", "Nov", "Dec",
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
  // Forward-safe rule read (mirrors parslet's named-rule indirection).
  const R = (name: string): P => ref(rules, name);
  const space = str(" ");
  const dash = str("-");
  const dot = str(".");
  const slash = str("/");
  const comma = str(", ");
  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  const upper = match("[A-Z]");
  const lower = match("[a-z]");
  const letter = match("[A-Za-z]");
  const anyChar = match("[\\s\\S]");

  const spaceMaybe = () => space.maybe();
  const dashMaybe = () => dash.maybe();
  const monthName = () => literalAlternation(MONTHS);
  const absent = (p: P) => p.absent();
  // The ISO/IEC draft-stage vocabulary of the D= notation
  // (docs/IEEE-DRAFT-STAGES.md §1.2). Ordered so the longest token wins
  // ("FDIS" over "DIS").
  const stageVocab = () => literalAlternation(["FDIS", "CDV", "PWI", "DIS", "WD", "NP", "CD"]);

  rule("year_digits", () =>
    str("19").or(str("20")).then(digit.repeat(2, 2)).then(lower.repeat(0, 2)).then(absent(digits)),
  );

  rule("month_numeric", () =>
    str("0").then(match("[1-9]")).or(str("1").then(match("[0-2]"))),
  );

  rule("date_with_month_text", () =>
    monthName().as("month").then(space).then(R("year_digits").as("year")),
  );

  rule("date_with_month_numeric", () =>
    R("year_digits").as("year").then(dash).then(R("month_numeric").as("month")),
  );

  rule("date_standalone", () =>
    ref(rules, "date_with_month_text")
      .or(ref(rules, "date_with_month_numeric"))
      .or(R("year_digits").as("year")),
  );

  rule("trailing_month_year", () =>
    (
      comma.or(space)
        .then(monthName().as("trailing_month"))
        .then(space)
        .then(R("year_digits").as("trailing_year"))
    ).or(
      comma.or(space)
        .then(R("month_numeric").as("trailing_month"))
        .then(space.or(dash))
        .then(R("year_digits").as("trailing_year")),
    ),
  );

  rule("organization", () =>
    literalAlternation([
      "IEEE", "AIEE", "ANSI", "ASA", "ANS", "IEC", "ISO", "ASTM", "CSA",
      "ASME", "NACE", "NSF", "ASHRAE", "NCTA", "AESC", "EIA",
      "USEMCSC", "AMPP", "USAS", "EAB", "MPAI",
    ]),
  );

  rule("complex_org_prefix", () =>
    str("ANSI/IEEE-ANS").or(str("ANSI/IEEE")).or(str("ANSI")),
  );

  rule("characteristic_ieee_number", () =>
    (
      str("C").then(digit.repeat(2, 2)).then(dot).then(digits).then(match("[a-z]").repeat(0, Infinity).maybe())
    ).or(
      str("802").then(dot).then(digits).then(match("[a-z]").repeat(0, Infinity).maybe()),
    ).or(str("P").then(digits.repeat(1, Infinity))),
  );

  rule("publisher", () => R("complex_org_prefix").or(R("organization")).as("publisher"));

  rule("copublisher", () =>
    str("/ISO/IEC").as("copublisher")
      .or(str("/IEC/ISO").as("copublisher"))
      .or(slash.then(spaceMaybe()).then(R("organization").as("copublisher"))),
  );

  rule("conformance", () =>
    (
      spaceMaybe().then(slash)
        .then(str("Conformance"))
        .then(match("[0-9]").repeat(1, Infinity).as("conf_number"))
        .then(dash)
        .then(R("year_digits").as("conf_year"))
    ).as("conformance"),
  );

  rule("ashrae_copub", () =>
    (
      slash.then(str("ASHRAE")).then(space)
        .then(str("Guideline").then(space).maybe())
        .then(digits.as("ashrae_number"))
        .then(dash.then(R("year_digits").as("ashrae_year")).maybe())
    ).as("ashrae_copub"),
  );

  rule("ieee_crossref", () =>
    (
      slash.then(str("C")).then(digits).then(dot).then(digits).then(dot).then(digits)
        .then(dash).then(R("year_digits"))
    ).as("ieee_crossref"),
  );

  rule("ipcea_copub", () =>
    (
      slash.then(str("IPCEA")).then(space)
        .then(match("[A-Za-z0-9.\\-]").repeat(1, Infinity))
    ).as("ipcea_copub"),
  );

  rule("s_designation", () =>
    (
      R("publisher").then(space).maybe()
    ).maybe()
      .then(
        (
          ref(rules, "type_word").as("type").then(spaceMaybe()).maybe()
        ).maybe(),
      )
      .then(str("S").then(dash).then(digits).as("s_number"))
      .then(ref(rules, "ipcea_copub").maybe())
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("number", () =>
    (
      str("P").maybe()
        .then(upper.repeat(0, Infinity)).then(digits).then(digits.or(upper).repeat(0, Infinity))
        .then(
          dash.then(digits).then(absent(R("year_digits"))).then(dash.then(digits).repeat(0, Infinity)).maybe(),
        )
        .then(lower.maybe())
    ).as("number"),
  );

  rule("type_word", () =>
    str("Draft Std")
      .or(str("STD"))
      .or(str("Standard"))
      .or(str("Std No."))
      .or(str("Std"))
      .or(str("PTC"))
      .or(match("[Nn]").then(str("o.")))
      .or(match("[Nn]").then(str("o")))
      .or(str("No")),
  );

  rule("part", () => (dot.or(dash)).then(match("[0-9A-Za-z]").repeat(1, Infinity).as("part")));

  rule("subpart", () =>
    (dot.or(dash).or(str("_"))).then(
      (
        str("REV").or(str("Rev")).maybe()
          .then(match("[0-9a-z]").repeat(1, Infinity))
          .then(dot.then(digits).maybe())
      ).as("subpart"),
    ),
  );

  rule("year", () =>
    dot.or(dash).then(ref(rules, "date_standalone")).then(str("(E)").maybe()),
  );

  rule("draft_status", () =>
    literalAlternation([
      "Active Unapproved", "Active Approved", "Unapproved", "Approved", "Active",
    ]).then(space),
  );

  rule("draft_prefix", () => spaceMaybe().then(slash.or(str("_")).or(dash).or(space)));

  rule("draft_version", () =>
    absent(str("R").then(dash))
      .then(str("D").then(absent(str("IS"))).maybe())
      .then(
        (
          match("[0-9]").repeat(1, 2).then(dot).then(match("[0-9]").repeat(1, 2)).then(lower.maybe())
        ).or(dot.then(digits))
          .or(digits.then(str("+")).then(digits))
          .or(digits.then(dot.maybe()).then(str("e")).then(digits))
          .or(
            str("-").maybe()
              .then(match("[0-9A-Za-z]").repeat(1, Infinity))
              .then(str("-d").or(str("_").then(match("[0-9A-Za-z]").repeat(0, Infinity))).maybe()),
          ).as("draft_version"),
      ),
  );

  rule("draft_date", () =>
    (
      comma.or(space).then(monthName().as("month")).then(space).then(R("year_digits").as("year"))
    ).or(
      // Space-separated bare year after the draft designator
      // ("IEEE Draft Std P14764/D1 2004, Nov 2004" - the "D1 2004" draft
      // carries its own year, with the print date still trailing).
      space.then(R("year_digits").as("year")),
    ).or(
      comma.or(space).then(R("month_numeric").as("month")).then(space.or(dash)).then(R("year_digits").as("year")),
    ).or(
      (
        spaceMaybe().then(comma).then(spaceMaybe()).or(space)
      ).then(monthName().as("month")).then(
        (
          space.then(digits.as("day")).then(comma.or(space).or(dash)).then(R("year_digits").as("year"))
        ).or(
          space.then(digits.as("day")).maybe().then(comma).then(R("year_digits").as("year")),
        ).or(comma.then(spaceMaybe()).then(R("year_digits").as("year")))
          .or(space.then(R("year_digits").as("year"))),
      ),
    ),
  );

  rule("fdraft", () =>
    (
      slash
        .then(literalAlternation(["FDIS", "CDV", "CD", "WD", "PWI", "NP"]))
        .then(
          (
            comma.or(space).then(monthName().as("month")).then(space).then(R("year_digits").as("year"))
          ).or(comma.or(space).then(R("year_digits").as("year"))).maybe(),
        )
        .then(ref(rules, "parenthetical").maybe())
    ).as("fdraft"),
  );

  rule("draft", () =>
    (
      ref(rules, "draft_prefix")
        .then(ref(rules, "draft_version").repeat(1, 2))
        .then(dot.then(digits.as("revision")).maybe())
        .then(
          // The compound both-systems form (docs/IEEE-DRAFT-STAGES.md
          // §1.3): "=DDIS.3" - IEEE draft ordinal = draft of the ISO/IEC
          // stage, with its iteration. The glued "=DDIS3" / "=DDIS-3"
          // spellings are accepted aliases of "=DDIS.3".
          str("=")
            .then(
              str("D").then(stageVocab().as("draft_iso_stage"))
                .or(stageVocab().as("draft_iso_stage")),
            )
            .then((dot.or(dash)).maybe().then(digits.as("draft_iso_iteration")).maybe())
            .maybe(),
        )
        .then(ref(rules, "draft_date").maybe())
    ).as("draft"),
  );

  rule("revision_suffix", () =>
    slash.then(str("R")).then(dash).then(match("[0-9A-Za-z]").repeat(1, Infinity).as("revision")),
  );

  rule("edition", () =>
    (
      comma.then(R("year_digits").as("edition_year")).then(str(" Edition"))
    ).or(
      space.or(dash)
        .then(str("Edition "))
        .then((digits.then(dot).then(digits)).as("edition"))
        .then(str(" - ").or(space).or(dash))
        .then(R("year_digits").as("edition_year"))
        .then(dash.then(digit.repeat(2, 2).as("edition_month")).maybe()),
    ),
  );

  rule("part_subpart_year", () =>
    (
      ref(rules, "part").then(ref(rules, "subpart").repeat(1, 2)).then(ref(rules, "year"))
    ).or(ref(rules, "part").then(ref(rules, "subpart")).then(ref(rules, "year")))
      .or(ref(rules, "part").then(ref(rules, "year")))
      .or(ref(rules, "part").then(ref(rules, "subpart")))
      .or(ref(rules, "year"))
      .or(ref(rules, "part")),
  );

  rule("corrigendum", () =>
    (
      str("_").or(slash).or(dash).or(space)
        .then(str("Corrigendum").or(str("Cor")))
        .then(dash.or(dot).or(space).maybe())
        .then(spaceMaybe())
        .then(digits.as("cor_number").maybe())
        .then((dash.or(str(":")).or(space)).then(R("year_digits").as("cor_year")).maybe())
    ).as("corrigendum"),
  );

  rule("amendment", () =>
    (
      str("_").or(slash).or(dash).or(space)
        .then(str("Amendment").or(str("Amd")))
        .then(dash.or(dot).or(space).maybe())
        .then(spaceMaybe())
        .then(digits.as("amd_number").maybe())
        .then((dash.or(str(":")).or(space)).then(R("year_digits").as("amd_year")).maybe())
    ).as("amendment"),
  );

  rule("interpretation", () =>
    (
      slash.then(str("INT")).then(
        (dash.or(str(":")).or(space)).then(R("year_digits").as("int_year")).maybe(),
      )
    ).as("interpretation"),
  );

  rule("reaffirmed", () =>
    (
      str("Reaffirmed ").then(R("year_digits").as("year"))
    ).or(
      space.maybe().then(str("(R")).then(R("year_digits").as("year")).then(str(")")),
    ).as("reaffirmed"),
  );

  rule("redline", () =>
    (
      space.then(dash.then(space).maybe())
        .then(literalAlternation(["Redline", "REDLINE", "redline"]))
    ).as("redline"),
  );

  rule("book_nickname", () =>
    space.then(str("[")).then(match("[^\\]]").repeat(1, Infinity).as("nickname")).then(str("]")),
  );

  const relationshipType = () =>
    literalAlternation([
      "Draft Amendment to ", "DRAFT Amendment to ", "Draft Revision of ",
      "Previously designated as ", "Reaffirmation of ", "Redesignation of ",
      "redesignated as ", "Supersedes ", "Supercedes ", "Includes ",
      "Revision of ", "Revison of ", "Amendment to ", "Corrigendum to ",
      "Corrigenda to ", "incorporates ", "Incorporating ", "Incorporates ",
      "Adoption of ", "Supplement to ",
    ]);

  rule("relationship_type", () =>
    (
      literalAlternation(["Draft Amendment to ", "DRAFT Amendment to "]).as("draft_amendment_to")
    ).or(str("Draft Revision of ").as("draft_revision_of"))
      .or(str("Previously designated as ").as("previously_designated_as"))
      .or(str("Reaffirmation of ").as("reaffirmation_of"))
      .or(literalAlternation(["Redesignation of ", "redesignated as "]).as("redesignation_of"))
      .or(literalAlternation(["Supersedes ", "Supercedes "]).as("supersedes"))
      .or(str("Includes ").as("includes"))
      .or(literalAlternation(["Revision of ", "Revison of "]).as("revision_of"))
      .or(str("Amendment to ").as("amendment_to"))
      .or(literalAlternation(["Corrigendum to ", "Corrigenda to "]).as("corrigendum_to"))
      .or(literalAlternation(["incorporates ", "Incorporating ", "Incorporates "]).as("incorporates"))
      .or(str("Adoption of ").as("adoption_of"))
      .or(str("Supplement to ").as("supplement_to")),
  );

  rule("relationship_separator", () =>
    space.maybe().then(slash).then(space.maybe()).or(
      space.maybe().then(str(";")).then(space.maybe()),
    ).or(space.maybe().then(dash).then(space.maybe())),
  );

  rule("relationship_break", () =>
    ref(rules, "relationship_separator").then(spaceMaybe()).then(ref(rules, "relationship_type")),
  );

  rule("identifier_string", () =>
    (
      absent(str(", and "))
        .then(absent(str(" and ")))
        .then(absent(str(", ")))
        .then(absent(str(" as amended by ")))
        .then(absent(ref(rules, "relationship_break")))
        .then(absent(str(")")))
        .then(anyChar)
    ).repeat(1, Infinity),
  );

  rule("identifier_list", () =>
    ref(rules, "identifier_string").as("id").then(
      (
        str(", and ").or(str(" and ")).or(str(", ")).then(ref(rules, "identifier_string").as("id"))
      ).repeat(0, Infinity),
    ),
  );

  rule("as_amended_by_clause", () =>
    str(" as amended by IEEE's ").then(ref(rules, "identifier_list").as("amendments"))
      .or(str(" as amended by ").then(ref(rules, "identifier_list").as("amendments")))
      .or(str(" and its approved amendments").as("approved_amendments")),
  );

  rule("relationship_clause", () =>
    spaceMaybe().then(str("("))
      .then(ref(rules, "relationship_type").as("relationship_type"))
      .then(ref(rules, "identifier_list").as("related_ids"))
      .then(ref(rules, "as_amended_by_clause").maybe())
      .then(
        (
          ref(rules, "relationship_separator")
            .then(ref(rules, "relationship_type").as("relationship_type"))
            .then(ref(rules, "identifier_list").as("related_ids"))
            .then(ref(rules, "as_amended_by_clause").maybe())
        ).repeat(0, Infinity).as("additional_rels"),
      )
      .then(str(")")),
  );

  rule("title_portion", () =>
    str(":").then(space).then(match("[^\\n]").repeat(1, Infinity).as("title")),
  );

  rule("approved_draft_suffix", () =>
    space.then(str("- (Approved Draft)")).or(space.then(str("(Approved Draft)"))),
  );

  rule("additional_parameters", () =>
    (
      spaceMaybe().then(str("(")).then(
        ref(rules, "reaffirmed")
          .or(
            str("Revision of IEEE Std ").then(spaceMaybe())
              .then(match("[^)]").repeat(1, Infinity).as("revision_of")),
          )
          .or(
            str("Revison of IEEE Std ").then(spaceMaybe())
              .then(match("[^)]").repeat(1, Infinity).as("revision_of")),
          )
          .or(
            str("Revision to IEEE Std ").then(spaceMaybe())
              .then(match("[^)]").repeat(1, Infinity).as("revision_of")),
          )
          .or(
            str("Revison to IEEE Std ").then(spaceMaybe())
              .then(match("[^)]").repeat(1, Infinity).as("revision_of")),
          )
          .or(
            literalAlternation(["DRAFT", "Draft", "draft"]).then(str(" Amendment to "))
              .then(match("[^)]").repeat(1, Infinity).as("draft_amendment_to")),
          )
          .or(
            str("Amendment to IEEE Std ").then(spaceMaybe())
              .then(match("[^)]").repeat(1, Infinity).as("amendment_to")),
          )
          .or(str("Adoption of ").then(match("[^)]").repeat(1, Infinity).as("adoption")))
          .or(
            str("Notebooks").then(spaceMaybe())
              .then(match("[^,\\)]").repeat(1, Infinity).as("notebooks")),
          )
          .or(
            str("Standard Newspaper(s)").then(spaceMaybe())
              .then(match("[^,\\)]").repeat(1, Infinity).as("standard_newspapers")),
          )
          .or(match("[^)]").repeat(1, Infinity).as("parenthetical_content"))
      )
      .then(str(")").maybe())
    ).as("parameters"),
  );

  rule("parenthetical", () =>
    ref(rules, "relationship_clause").or(ref(rules, "additional_parameters")),
  );

  rule("iec_ieee_copublished", () =>
    str("IEC/IEEE")
      .then(space)
      .then(absent(str("P")))
      .then(
        match("[^0-9\\n]").repeat(0, Infinity).then(digit).present(),
      )
      .then(match("[^\\n]").repeat(1, Infinity).as("content")),
  );

  rule("joint_development_ieee_format", () =>
    literalAlternation(["ISO/IEC/IEEE", "ISO/IEEE", "IEC/IEEE", "IEEE/CSA"]).as("joint_publishers")
      .then(space)
      // P = project (the document is a draft): identity-bearing, so it
      // is captured and preserved, never silently consumed.
      .then(str("P").as("project_marker"))
      .then(digits.as("number"))
      .then((dot.or(dash)).then(digits.as("part")).maybe())
      .then(
        slash.then(digits).then(dot.then(digits).maybe())
          .then(dash.then(digits.as("draft_version")).maybe()).maybe(),
      )
      .then(
        // Variant 1b: the ordinal-less stage draft "D=CDV[:2020]" -
        // D (draft) = CDV (the IEC stage it drafts). The year rides in
        // the draft clause (a distinct key, so the builder keeps the
        // date inside the designator).
        slash.then(str("D")).then(str("="))
          .then(stageVocab().as("draft_iso_stage"))
          .then(str(":").then(R("year_digits").as("draft_stage_year")).maybe())
          .or(
            // Variant 1: /D8 notation (original), with the compound
            // both-systems suffix "=DDIS.3" (docs/IEEE-DRAFT-STAGES.md
            // §1.3). The doubled-D spelling is consumed and echoed: the
            // joint form prints the stage as spelled.
            slash.then(str("D")).then(digits.as("draft_version"))
              .then(
                str("=")
                  .then(
                    str("D").as("draft_stage_d").then(stageVocab().as("draft_iso_stage"))
                      .or(stageVocab().as("draft_iso_stage")),
                  )
                  .then((dot.or(dash)).maybe().then(digits.as("draft_iso_iteration")).maybe())
                  .maybe(),
              ),
          )
          .or(
            // Variant 2: , CDV1 notation (comma before stage code) —
            // the stage draft of the named ISO/IEC stage, its iteration
            comma.then(literalAlternation(["CDV", "FDIS", "CD", "DIS"]).as("iec_stage"))
              .then(digits.maybe().as("stage_iteration")),
          )
          .maybe(),
      )
      .then(ref(rules, "edition").maybe())
      .then(
        (
          dash.then(R("year_digits").as("year"))
        ).or(
          comma.maybe().then(space).then(monthName().as("month")).then(spaceMaybe())
            .then(R("year_digits").as("year")),
        ).maybe(),
      )
      .then(ref(rules, "revision_suffix").maybe()),
  );

  rule("joint_development_iso_format", () => {
    const isoLed = literalAlternation([
      "ISO/IEC/IEEE", "IEEE/ISO/IEC", "IEEE/IEC/ISO", "ISO/IEEE",
    ]);
    const stagedOnly = literalAlternation([
      "IEC/IEEE", "IEEE/IEC", "ISO/IEC", "IEEE",
    ]);
    const isoStage = () =>
      str("FDIS")
        .or(str("FCD"))
        .or(str("CDV"))
        .or(str("DIS").then(digit.maybe()))
        .or(str("CD").then(digit.maybe()))
        .or(str("WD"))
        .or(str("PWI"))
        .or(str("NP"))
        .as("iso_stage");
    const stdNoise = () => (space.then(str("Std"))).maybe();
    // The dash-year and ", Month YYYY" spellings are the catalogue-PRINTED
    // joint form; tag them so the builder routes to a Standard. A
    // dash-joined part is tagged too (printed parts spell the dash).
    const dateClause = () =>
      (
        str(":").then(R("year_digits").as("year"))
      ).or(
        dash.then(R("year_digits").as("year"))
          .then(dash.then(R("month_numeric").as("month")).maybe())
          .then(str("").as("printed_dash_year")),
      ).or(
        (comma.or(space)).then(monthName().as("month")).then(space)
          .then(R("year_digits").as("year"))
          .then(str("").as("printed_month_year")),
      ).maybe();

    return (
      isoLed.as("joint_publishers").then(space)
        .then(
          isoStage().then(stdNoise()).then(space)
            .or(str("").as("iso_published").then(spaceMaybe())),
        )
        .or(stagedOnly.as("joint_publishers").then(space).then(isoStage()).then(stdNoise()).then(space))
    )
      .then(str("P").as("project_marker").maybe())
      .then(digits.as("number"))
      .then(
        (dot.then(absent(R("year_digits"))).then(digits.as("part")))
          .or(dash.then(str("").as("part_dash")).then(absent(R("year_digits")))
            .then(digits.as("part")))
          .maybe(),
      )
      .then(dateClause())
      .then(
        // The ISO/IEC edition marker may sit between the year and an
        // amendment/draft tail ("8802.11:2012 (E)/Amd 1-2014").
        (
          spaceMaybe().then(str("("))
            .then(match("[^)]").repeat(1, Infinity).as("edition_marker"))
            .then(str(")"))
        ).maybe(),
      )
      .then(
        // The stage-draft clause of the ISO-led print: "/D=WD.5" - D
        // (draft) = the ISO/IEC stage it drafts, with its iteration
        // (docs/IEEE-DRAFT-STAGES.md §1.2).
        (
          slash.then(str("D")).then(str("="))
            .then(stageVocab().as("draft_iso_stage"))
            .then(
              dot.then(digits.then(match("[A-Za-z]").repeat(0, 1)).as("draft_iso_iteration")).maybe(),
            )
        )
        .or(
          slash.then(str("D")).then(dashMaybe())
            .then(match("[0-9.]").repeat(1, Infinity).as("draft_version"))
            .then(
              (
                (comma.or(space)).then(monthName().as("draft_month")).then(space)
                  .then(R("year_digits").as("draft_year"))
              ).or(comma.then(R("year_digits").as("draft_year"))).maybe(),
            ),
        ).maybe(),
      )
      .then(
        (
          slash.then(str("Amd")).then(dot.or(space).maybe())
            .then(digits.as("amd_number"))
            .then((str(":").or(dash)).then(R("year_digits").as("amd_year")).maybe())
        ).maybe(),
      )
      .then(ref(rules, "edition").maybe())
      .then(ref(rules, "revision_suffix").maybe())
      .then(ref(rules, "parenthetical").maybe());
  });

  // The stage-less ISO/IEC label with a colon year and the ISO/IEC
  // edition marker: "ISO/IEC 13210:1994 (E)" - the ISO/IEC portion of a
  // double-labeled standard. The (E) parenthetical is REQUIRED: without it
  // this spelling is the ISO flavor's own form and must not be stolen.
  rule("joint_development_iso_iec_edition", () =>
    str("ISO/IEC").as("joint_publishers")
      .then(space)
      .then(str("").as("iso_published"))
      .then(str("P").as("project_marker").maybe())
      .then(digits.as("number"))
      // The part may be dot- or dash-joined ("8802-9"); a dash-year is
      // not a part. A distinct key: the iso-format route's part_dash
      // prints as a dot in the joint code; only the label keeps its dash.
      .then(
        (dot.then(digits.as("part")))
          .or(dash.then(str("").as("iec_label_dash")).then(absent(R("year_digits"))).then(digits.as("part")))
          .maybe(),
      )
      .then(str(":").then(spaceMaybe()).then(R("year_digits").as("year")))
      .then(spaceMaybe())
      .then(ref(rules, "parenthetical")),
  );

  rule("joint_development_embedded_stage", () =>
    literalAlternation([
      "ISO/IEC/IEEE", "IEEE/ISO/IEC", "IEEE/IEC/ISO", "ISO/IEEE",
      "IEC/IEEE", "IEEE/IEC", "ISO/IEC", "IEEE",
    ]).as("joint_publishers")
      .then(space)
      .then(str("P").as("project_marker").maybe())
      .then(digits.as("number"))
      .then((dot.or(dash)).then(absent(R("year_digits"))).then(digits.as("part")).maybe())
      .then(dot)
      .then(
        str("FDIS")
          .or(str("FCD"))
          .or(str("CDV"))
          .or(str("DIS").then(digit.maybe()))
          .or(str("CD").then(digit.maybe()))
          .or(str("WD"))
          .or(str("PWI"))
          .or(str("NP"))
          .as("iso_stage"),
      )
      .then(absent(digit.or(letter)))
      .then(
        (
          str(":").then(R("year_digits").as("year"))
        ).or(
          dash.then(R("year_digits").as("year"))
            .then(dash.then(R("month_numeric").as("month")).maybe()),
        ).or(
          (comma.or(space)).then(monthName().as("month")).then(space)
            .then(R("year_digits").as("year")),
        ).maybe(),
      ),
  );

  rule("number_first_identifier", () =>
    ref(rules, "number")
      .then(dash.then(R("year_digits").as("year")).maybe())
      .then(space)
      .then((R("publisher").then(R("copublisher").repeat(0, Infinity).as("copublishers"))).as("publishers"))
      .then(space)
      .then(ref(rules, "type_word").as("type").then(spaceMaybe()).maybe())
      .then(match("[^\\n]").repeat(0, Infinity).as("title")),
  );

  rule("ieee_p_identifier", () =>
    (str("IEEE").as("publisher").then(space).maybe())
      .then(ref(rules, "number"))
      .then(ref(rules, "part_subpart_year").or(ref(rules, "edition")).maybe())
      .then((slash.then(digits.as("draft_version"))).as("digit_draft").maybe())
      .then(ref(rules, "fdraft").maybe())
      .then(ref(rules, "trailing_month_year").maybe())
      .then(ref(rules, "corrigendum").maybe())
      .then(ref(rules, "draft").maybe())
      .then(ref(rules, "revision_suffix").maybe())
      .then(ref(rules, "trailing_month_year").maybe())
      .then(ref(rules, "corrigendum").maybe())
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("ansi_p_identifier", () =>
    str("ANSI").as("publisher")
      .then(space)
      .then(str("P"))
      .then(spaceMaybe())
      .then(ref(rules, "number"))
      .then(ref(rules, "part_subpart_year").or(ref(rules, "edition")).maybe())
      .then(ref(rules, "trailing_month_year").maybe())
      .then(ref(rules, "corrigendum").maybe())
      .then(ref(rules, "draft").maybe())
      .then(ref(rules, "revision_suffix").maybe())
      .then(ref(rules, "trailing_month_year").maybe())
      .then((comma.or(space)).then(R("year_digits").as("trailing_year")).maybe())
      .then(ref(rules, "corrigendum").maybe())
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("ieee_draft_p_identifier", () =>
    (str("IEEE").as("publisher").then(space).maybe())
      .then(ref(rules, "draft_status").as("draft_status").maybe())
      .then(str("Draft"))
      .then(space)
      .then(ref(rules, "number"))
      .then(ref(rules, "part_subpart_year").or(ref(rules, "edition")).maybe())
      .then(
        (
          space.then(monthName().as("trailing_month")).then(space)
            .then(R("year_digits").as("trailing_year"))
        ).or(
          space.then(R("month_numeric").as("trailing_month")).then(space.or(dash))
            .then(R("year_digits").as("trailing_year")),
        ).maybe(),
      )
      .then(ref(rules, "draft").maybe())
      .then(ref(rules, "revision_suffix").maybe())
      .then(ref(rules, "corrigendum").maybe())
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("ieee_approved_draft_identifier", () =>
    str("IEEE").as("publisher")
      .then(space)
      .then(str("Approved"))
      .then(space)
      .then(str("Draft Std").or(str("Std")).as("type"))
      .then(space)
      .then(str("P").maybe())
      .then(ref(rules, "number"))
      .then(ref(rules, "part_subpart_year").or(ref(rules, "edition")).maybe())
      .then(ref(rules, "draft").maybe())
      .then(ref(rules, "revision_suffix").maybe())
      .then(ref(rules, "parenthetical").maybe()),
  );

  // --- AIEE sub-parser ----------------------------------------------------

  rule("aiee_year", () =>
    str("18").then(digit.repeat(2, 2))
      .or(
        str("19").then(
          literalAlternation(["0", "1", "2", "3", "4", "5"]).then(digit),
        ),
      )
      .or(str("196").then(match("[0-3]"))),
  );

  rule("aiee_prefix", () =>
    literalAlternation(["IEEE-AIEE", "A.I.E.E.", "A. I. E. E.", "AIEE"]).as("publisher"));

  rule("aiee_type", () =>
    literalAlternation([
      "Standard No.", "Standard No", "Std No.", "Std No", "Std", "Nos",
      "No.", "No", "no", "Standard", "Trans.",
    ]).as("type"),
  );

  rule("aiee_number", () =>
    (
      (
        upper.repeat(2, 3).then(dash).then(digits)
      ).or(
        digits.then(upper).then(absent(space.then(str("and")))),
      ).or(digits.then(dot).then(digits))
        .or(
          digits.as("main_number").then(space)
            .then((str("(").then(digits.as("alt_number")).then(str(")"))).as("parenthetical")),
        )
        .or(digits.then(absent(space.then(str("and")).then(space).then(digits))))
    ).as("number"),
  );

  rule("aiee_date_short", () => space.maybe().then(dash).then(R("aiee_year").as("year")));

  rule("aiee_date_long", () =>
    spaceMaybe().then(
      (
        (str(",").or(dot)).as("separator").then(spaceMaybe())
          .then(monthName().as("month").then(space).maybe())
          .then(R("aiee_year").as("year"))
      ).or(monthName().as("month").then(dash).then(R("aiee_year").as("year"))),
    ),
  );

  rule("aiee_date", () => ref(rules, "aiee_date_short").or(ref(rules, "aiee_date_long")).maybe());

  rule("aiee_identifier", () =>
    ref(rules, "aiee_prefix")
      .then(space)
      .then(ref(rules, "aiee_type").then(space).maybe())
      .then(ref(rules, "aiee_number"))
      .then(ref(rules, "aiee_date")),
  );

  // --- IRE sub-parser -----------------------------------------------------

  rule("ire_year_full", () =>
    str("191").then(digit.repeat(1, 1))
      .or(str("19").then(literalAlternation(["2", "3", "4", "5"])).then(digit))
      .or(str("196").then(match("[0-3]"))),
  );

  rule("ire_year_short", () => match("[1-6]").then(digit));

  rule("ire_prefix", () => str("IEEE-IRE").or(str("IRE")).as("publisher"));

  rule("ire_type", () => literalAlternation(["Trans.", "Standard", "Std"]).as("type"));

  rule("ire_number", () =>
    (
      (
        digits.then(space.or(dot)).then(upper).then(digits)
      ).or(
        digits.then(dot).then(str("IRE")).then(digits).then(dot).then(digits).then(upper).then(digits),
      ).or(upper.repeat(2, 4).then(dash).then(digits))
        .or(digits)
    ).as("number"),
  );

  rule("ire_date", () =>
    (
      spaceMaybe().then(dash.or(str(",")).maybe()).then(spaceMaybe())
        .then(ref(rules, "ire_year_full").or(ref(rules, "ire_year_short")).as("year"))
    ).maybe(),
  );

  rule("ire_identifier", () =>
    (
      ref(rules, "ire_year_full").or(ref(rules, "ire_year_short")).as("year")
        .then(space)
        .then(ref(rules, "ire_prefix"))
        .then(space)
        .then(ref(rules, "ire_type").then(space).maybe())
        .then(ref(rules, "ire_number"))
        .then(
          spaceMaybe().then(dash.or(str(",")).maybe()).then(spaceMaybe())
            .then(ref(rules, "ire_year_full").as("full_year")).maybe(),
        )
    ).or(
      ref(rules, "ire_prefix")
        .then(space)
        .then(ref(rules, "ire_type").then(space).maybe())
        .then(ref(rules, "ire_number"))
        .then(ref(rules, "ire_date")),
    ),
  );

  // --- NESC sub-parser ----------------------------------------------------

  rule("nesc_c2_code", () => str("C2").as("code"));

  rule("nesc_full_name", () =>
    str("National Electrical Safety Code").or(str("National Electric Safety Code")));

  rule("nesc_registered", () => str("(R)"));

  rule("nesc_edition", () =>
    literalAlternation([
      "Premier Edition", "First Edition", "Second Edition", "Third Edition",
      "Fourth Edition", "Fifth Edition", "Sixth Edition", "Seventh Edition",
      "Eighth Edition", "Ninth Edition", "Tenth Edition",
    ]).as("edition"),
  );

  rule("nesc_variant", () => str("Handbook").or(str("Redline")).as("variant"));

  rule("nesc_month", () =>
    literalAlternation([
      "January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December",
    ]).as("month"),
  );

  rule("nesc_c2_standard", () =>
    ref(rules, "nesc_c2_code")
      .then(dash)
      .then(digit.repeat(4, 4).as("year"))
      .then(str(",").maybe().then(space).maybe())
      .then(ref(rules, "nesc_full_name"))
      .then(ref(rules, "nesc_registered").maybe())
      .then(
        space.then(str("(")).then(str("NESC")).then(ref(rules, "nesc_registered").maybe())
          .then(str(")")).maybe(),
      ),
  );

  rule("nesc_year_first", () =>
    str("IEEE").then(space).then(str("Std")).then(space).maybe()
      .then(digit.repeat(4, 4).as("year"))
      .then(space)
      .then(
        (
          ref(rules, "nesc_full_name").as("full_name")
            .then(ref(rules, "nesc_registered").as("name_registered").maybe())
            .then(
              space.then(str("(")).then(str("NESC").as("paren_abbr"))
                .then(ref(rules, "nesc_registered").as("paren_registered").maybe())
                .then(str(")")).maybe(),
            )
        ).or(
          str("NESC").as("abbr").then(ref(rules, "nesc_registered").as("abbr_registered").maybe()),
        ),
      )
      .then(space.then(ref(rules, "nesc_variant")).maybe())
      .then(str(",").then(space).then(ref(rules, "nesc_edition")).maybe()),
  );

  rule("nesc_name_first", () =>
    ref(rules, "nesc_full_name")
      .then(ref(rules, "nesc_registered").maybe())
      .then(str(","))
      .then(space)
      .then(ref(rules, "nesc_c2_code"))
      .then(dash)
      .then(digit.repeat(4, 4).as("year"))
      .then(
        space.then(str("-")).then(space).then(ref(rules, "nesc_variant")).as("variant").maybe(),
      ),
  );

  rule("nesc_draft_nesc", () =>
    str("Draft").as("draft")
      .then(space)
      .then(ref(rules, "nesc_full_name").or(str("NESC")))
      .then(ref(rules, "nesc_registered").maybe())
      .then(str(","))
      .then(space)
      .then(ref(rules, "nesc_month"))
      .then(space)
      .then(digit.repeat(4, 4).as("year")),
  );

  rule("nesc_identifier", () =>
    ref(rules, "nesc_draft_nesc")
      .or(ref(rules, "nesc_name_first"))
      .or(ref(rules, "nesc_c2_standard"))
      .or(ref(rules, "nesc_year_first")),
  );

  // --- PSI/SI -------------------------------------------------------------

  rule("psi_draft", () => slash.then(str("D")).then(dashMaybe()).then(digits.as("draft_version")));

  rule("psi_date", () =>
    (
      comma.then(monthName().or(R("month_numeric")).as("month")).then(space.or(dash))
        .then(R("year_digits").as("year"))
    ).or(
      dash.then(R("year_digits").as("year"))
        .then(dash.then(digit.repeat(2, 2).as("month")).maybe()),
    ),
  );

  rule("ieee_astm_si_psi", () =>
    str("IEEE/ASTM").or(str("IEEE")).as("publishers")
      .then(space)
      .then(str("PSI").or(str("SI")).as("si_type"))
      .then(space.or(str(".")))
      .then(digits.as("number"))
      .then(str(".").then(R("year_digits").as("year")).maybe())
      .then(
        (
          ref(rules, "psi_draft").then(ref(rules, "psi_date").maybe())
        ).or(ref(rules, "psi_date").then(ref(rules, "psi_draft").maybe())).maybe(),
      )
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("no_prefix_ieee", () =>
    R("characteristic_ieee_number").as("number")
      .then((dash.then(letter)).maybe().as("suffix"))
      .then((dash.then(R("year_digits"))).maybe().as("year"))
      .then(ref(rules, "draft").maybe())
      .then(str("(E)").or(str("(F)")).maybe())
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("corrigendum_identifier", () =>
    (
      R("publisher").then(R("copublisher").repeat(0, Infinity).as("copublishers")).as("publishers")
        .then(space).maybe()
    ).maybe()
      .then(ref(rules, "type_word").as("type").then(spaceMaybe()).maybe())
      .then(ref(rules, "number"))
      .then(ref(rules, "part_subpart_year").maybe())
      .as("base")
      .then(slash.or(dash).or(space))
      .then(str("Cor"))
      .then(dash.or(dot).or(space).maybe())
      .then(spaceMaybe())
      .then(digits.as("cor_number"))
      .then((dash.or(str(":")).or(space)).then(R("year_digits").as("cor_year")).maybe())
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("interpretation_identifier", () =>
    (
      R("publisher").then(R("copublisher").repeat(0, Infinity).as("copublishers")).as("publishers")
        .then(space).maybe()
    ).maybe()
      .then(ref(rules, "type_word").as("type").then(spaceMaybe()).maybe())
      .then(ref(rules, "number"))
      .then(ref(rules, "part_subpart_year").maybe())
      .as("base")
      .then(slash.or(dash).or(space))
      .then(str("INT"))
      .then((dash.or(str(":")).or(space)).then(R("year_digits").as("int_year")).maybe())
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("conformance_identifier", () =>
    (
      R("publisher").then(R("copublisher").repeat(0, Infinity).as("copublishers")).as("publishers")
        .then(space).maybe()
    ).maybe()
      .then(ref(rules, "type_word").as("type").then(spaceMaybe()).maybe())
      .then(ref(rules, "number"))
      .then(ref(rules, "part_subpart_year").maybe())
      .as("base")
      .then(slash.or(dash).or(space))
      .then(str("Conformance"))
      .then(match("[0-9]").repeat(1, Infinity).as("conf_number"))
      .then(dash)
      .then(R("year_digits").as("conf_year"))
      .then(ref(rules, "parenthetical").maybe()),
  );

  rule("multi_numbered_identifier", () =>
    (
      (
        R("publisher").then(space).maybe()
      ).maybe()
        .then(ref(rules, "type_word").as("type").then(spaceMaybe()).maybe())
        .then(ref(rules, "number"))
        .then(ref(rules, "part_subpart_year").or(ref(rules, "edition")).maybe())
      ).as("primary_identifier")
      .then(
        (
          (
            slash.then(str("C")).then(digits).then(dot).then(digits).then(dot).then(digits)
              .then(dash).then(R("year_digits"))
          ).as("secondary_crossref")
        ),
      )
      .or(
        str(",").then(space)
          .then(ref(rules, "type_word").as("type").then(spaceMaybe()).maybe())
          .then(ref(rules, "number"))
          .then(dash)
          .then(R("year_digits"))
          .as("secondary_joint"),
      ),
  );

  rule("csa_dual_published", () =>
    (
      R("publisher").then(space)
        .then(ref(rules, "type_word").as("type").then(spaceMaybe()).maybe())
        .then(ref(rules, "number"))
        .then(ref(rules, "part_subpart_year").or(ref(rules, "edition")).maybe())
    ).as("ieee_portion")
      .then(slash)
      .then(str("CSA"))
      .then(space)
      .then(
        (
          (
            str("C").then(digit.repeat(2, 2)).then(dot).then(digit).then(space)
              .then(str("No").or(str("NO"))).then(dot)
              .then(space).then(match("[0-9.]").repeat(1, Infinity))
              .then(dash.or(str(":"))).then(digit.repeat(2, 2))
          ).or(
            str("C").then(match("[0-9.]").repeat(1, Infinity)).then(dash).then(digit.repeat(2, 2)),
          ).or(
            str("C").then(digit.repeat(2, 2)).then(dot).then(digit).then(space)
              .then(str("No").or(str("NO")))
              .then(dot).then(space).then(match("[0-9.]").repeat(1, Infinity))
              .then(str(":")).then(digit.repeat(2, 2)),
          ).or(
            str("C").then(match("[0-9.]").repeat(1, Infinity)).then(str(":")).then(digit.repeat(2, 2)),
          )
        ).as("csa_portion")
      ),
  );

  rule("combined_aiee_identifier", () =>
    ref(rules, "aiee_identifier").as("first_aiee")
      .then(space)
      .then(str("and"))
      .then(space)
      .then(ref(rules, "aiee_identifier").as("second_aiee")),
  );

  rule("aiee_delegation", () =>
    (
      (
        str("IEEE-AIEE").then(space).then(
          literalAlternation(["No.", "Nos", "No", "Standard", "Trans."]),
        )
      ).or(
        str("A.I.E.E.").then(space).then(literalAlternation(["No.", "Nos", "No"])),
      ).or(
        str("A. I. E. E.").then(space).then(literalAlternation(["No.", "Nos", "No", "Standard"])),
      ).or(
        str("AIEE").then(space).then(
          literalAlternation(["No.", "Nos", "No", "Standard", "Trans.", "Std"]),
        ),
      )
    ).present()
      .then(ref(rules, "aiee_identifier").as("aiee")),
  );

  rule("ire_delegation", () =>
    (
      (
        match("[1-6]").then(digit).then(space).then(str("IRE"))
      ).or(
        str("19").then(digit.repeat(2, 2)).then(space).then(str("IRE")),
      ).or(
        str("IRE").then(space).then(digits.or(str("Standard")).or(str("Std")).or(str("Trans"))),
      ).or(str("IEEE-IRE").then(space))
    ).present()
      .then(ref(rules, "ire_identifier").as("ire")),
  );

  rule("nesc_delegation", () =>
    (
      str("C2-").then(R("year_digits"))
    ).or(
      R("year_digits").then(space).then(str("NESC").or(str("National Electrical Safety Code"))),
    ).or(
      str("Draft").then(space).then(str("NESC").or(str("National Electrical Safety Code"))),
    ).or(
      str("National Electrical Safety Code").then(str(",")).then(space).then(str("C2-")),
    ).or(
      // Catalogue form: "IEEE Std YYYY NESC …" / "IEEE Std YYYY National
      // Electrical Safety Code" - must not fall through to the generic
      // standard grammar, which would read YYYY as a number.
      str("IEEE").then(space).then(str("Std")).then(space).then(R("year_digits")).then(space)
        .then(str("NESC").or(str("National Electrical Safety Code"))),
    ).present()
      .then(ref(rules, "nesc_identifier").as("nesc")),
  );

  rule("identifier", () =>
    ref(rules, "combined_aiee_identifier")
      .or(ref(rules, "aiee_delegation"))
      .or(ref(rules, "combined_aiee_identifier"))
      .or(ref(rules, "ire_delegation"))
      .or(ref(rules, "nesc_delegation"))
      .or(ref(rules, "ieee_astm_si_psi"))
      .or(ref(rules, "multi_numbered_identifier"))
      .or(ref(rules, "csa_dual_published"))
      .or(ref(rules, "s_designation"))
      .or(ref(rules, "corrigendum_identifier"))
      .or(ref(rules, "interpretation_identifier"))
      .or(ref(rules, "conformance_identifier"))
      .or(ref(rules, "joint_development_ieee_format"))
      .or(ref(rules, "joint_development_iso_format"))
      .or(ref(rules, "joint_development_iso_iec_edition"))
      .or(ref(rules, "joint_development_embedded_stage"))
      .or(ref(rules, "iec_ieee_copublished"))
      .or(ref(rules, "number_first_identifier"))
      .or(ref(rules, "ieee_approved_draft_identifier"))
      .or(ref(rules, "ieee_draft_p_identifier"))
      .or(ref(rules, "ieee_p_identifier"))
      .or(ref(rules, "ansi_p_identifier"))
      .or(
        (
          R("publisher").then(R("copublisher").repeat(0, Infinity).as("copublishers")).as("publishers")
            .then(space).maybe()
        ).maybe()
          .then(ref(rules, "draft_status").as("draft_status").maybe())
          .then(str("Draft Std").as("type").then(spaceMaybe()).maybe())
          .then(
            ref(rules, "type_word").as("type")
              .then(space.then(str("No")).then(space).maybe())
              .then(spaceMaybe()).maybe(),
          )
          .then(ref(rules, "number"))
          .then(ref(rules, "part_subpart_year").or(ref(rules, "edition")).maybe())
          .then(ref(rules, "corrigendum").maybe())
          .then(ref(rules, "amendment").maybe())
          .then(ref(rules, "interpretation").maybe())
          .then(ref(rules, "conformance").maybe())
          .then(ref(rules, "ashrae_copub").maybe())
          .then(ref(rules, "ieee_crossref").maybe())
          .then(ref(rules, "draft").maybe())
          .then(ref(rules, "revision_suffix").maybe())
          .then(ref(rules, "trailing_month_year").maybe())
          .then(
            // The ASHRAE joint suffix may also trail a draft+date
            // ("IEEE P1635/D13, December, 2017/ASHRAE Guideline 21").
            ref(rules, "ashrae_copub").maybe(),
          )
          .then(
            // A bracketed narrative may sit between the base and a trailing
            // corrigendum ("IEEE Std 671-1985 [Corrigendum to …]/Cor. 1-2010").
            ref(rules, "book_nickname").maybe(),
          )
          .then(ref(rules, "corrigendum").maybe())
          .then(ref(rules, "edition").maybe())
          .then(ref(rules, "parenthetical").maybe())
          .then(ref(rules, "book_nickname").maybe())
          .then(ref(rules, "redline").maybe())
          .then(ref(rules, "title_portion").maybe())
          .then(ref(rules, "approved_draft_suffix").maybe()),
      )
      .or(ref(rules, "no_prefix_ieee")),
  );

  return rules;
}

export const ieeeGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};
