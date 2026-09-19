import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/nist/parser.rb — 1:1 translation. The identifier
 * alternation order is load-bearing: circ_supplement | dated | mr |
 * research_library | compound_series | publisher+series | bare series.
 */

const COMPOUND_SERIES = [
  "NBS BRPD-CRPL-D", "NBS CRPL-F-A", "NBS CRPL-F-B",
  "NBS CS-E", "CSRC Building Block", "CSRC Use Case", "CSRC Book",
  "ITL Bulletin", "NSRDS-NBS",
  "NIST LCIRC", "NBS LCIRC", "NIST.LCIRC", "NBS.LCIRC", "NBS RPT",
  "NIST PS", "NIST DCI", "NIST Other",
  "NISTPUB",
  "NBS CSM", "NBS CIRC", "NBS.CRPL", "NBS CRPL", "NBS CS",
  "NBS CIS", "NBS HR", "NBS IRPL", "NBS IP", "NBS PS",
  "NBS BH",
];

const SIMPLE_SERIES = [
  "AMS", "VTS", "BSS", "BMS", "BH",
  "FIPS", "GCR", "HB", "MONO", "MP", "NCSTAR", "NSRDS", "IR",
  "SP", "TN", "CSWP",
  "AI", "CIRC", "CS", "CSM",
  "CRPL", "LCIRC", "OWMWP", "PC", "RPT",
  "SIBS", "TIBM", "TTB", "EAB",
  "JPCRD", "JRES",
  "CHIPS", "NWIRP", "RB",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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
  const dot = str(".");
  const dash = str("-");
  const slash = str("/");
  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  const upperLetter = match("[A-Z]");
  const lowerLetter = match("[a-z]");
  const letter = match("[A-Za-z]");
  const monthAbbrev = () => literalAlternation(MONTHS);
  const anyChar = match("[\\s\\S]");

  rule("hash_prefix", () => str("#"));

  rule("month_abbrev", () => monthAbbrev());

  rule("language_code", () =>
    (space.or(dot))
      .maybe()
      .then(
        literalAlternation(["es", "pt", "chi", "viet", "port", "esp"]).or(
          match("[a-z]").repeat(2, 4),
        ),
      )
      .as("translation"),
  );

  const stageId = () =>
    str("i").or(str("I"), str("f"), str("F"), str("1"), str("2"), str("3"), str("4"), str("5"), str("6"), str("7"), str("8"), str("9"));
  const stageType = () =>
    str("pd").or(str("PD"), str("wd"), str("WD"), str("prd"), str("PRD"));

  rule("old_stage", () =>
    str("(")
      .then(stageId().as("stage_id"), stageType().as("stage_type"))
      .as("stage")
      .then(str(")")),
  );
  rule("new_stage", () =>
    (space.or(dot))
      .then(stageId().as("stage_id"), stageType().as("stage_type"))
      .as("stage"),
  );

  rule("publisher", () => str("NBS").or(str("NIST")).as("publisher"));

  rule("compound_series", () => literalAlternation(COMPOUND_SERIES).as("series"));

  rule("simple_series", () => literalAlternation(SIMPLE_SERIES).as("series"));

  rule("number_suffix", () =>
    str("U")
      .then(lowerLetter)
      .or(
        letter.then(
          literalAlternation([
            "ec", "ndex", "nsert", "rrata", "raft", "pp", "s", "t",
            "hi", "iet", "ort", "r", "p",
          ]).absent(),
          digits.maybe(),
        ),
      ),
  );

  rule("digits_with_suffix", () =>
    digits.then(ref(rules, "number_suffix").then(digit.absent()).maybe()),
  );

  rule("first_number", () =>
    ref(rules, "owmwp_date_number")
      .or(
        str("ADHOC"),
        str("div").then(digits),
        monthAbbrev().then(dash, monthAbbrev(), digits),
        digits
          .as("number")
          .then(str("v"), digits.as("volume_suffix"))
          .as("number_with_volume"),
        digits
          .then(
            dash,
            literalAlternation(["III", "II", "IV", "I", "V", "VI", "VII", "VIII", "IX", "X"]),
            dash,
            digits,
            dot.then(digits).maybe(),
          ),
        digits.then(str("GB"), dash, digits, upperLetter.maybe()),
        digits.then(upperLetter, dash, digits),
        str("v")
          .then(digits.as("volume_number"), str("n"), digits.as("issue_number")),
        digits.then(str("supprev")),
        digits.then(str("e"), digits, str("rev"), digits),
        digits
          .as("number")
          .then(str("rv"), digits.as("revision_year"))
          .as("number_with_rev_year"),
        digits.then(str("e"), digits, str("rev"), monthAbbrev(), digits),
        digits.then(str("e"), digits, str("supp"), digits.maybe()),
        str("e").then(digits, str("rev"), monthAbbrev(), digits),
        str("e").then(digits, str("supp"), digits.maybe()),
        digits.then(str("e"), digits),
        str("e").then(digits, dash.then(digits).absent()),
        lowerLetter.then(digits),
        digits.then(str("supp"), monthAbbrev(), digits),
        digits.then(str("supp"), digits.maybe()),
        digits.then(str("sup"), monthAbbrev(), digits),
        digits.then(str("sup")),
        digits
          .as("number")
          .then(
            literalAlternation(["sp", "pt", "es", "SP", "PT", "ES"]).as("language_code"),
            upperLetter.absent(),
            digit.absent(),
            letter.absent(),
            dash.absent(),
            dot.absent(),
          ),
        digits
          .as("number")
          .then(str("pt"), digits.as("part_number"), str("e"), digits.as("edition_year")),
        digits
          .as("number")
          .then(str("("), literalAlternation(["SP", "PT", "ES"]).as("language_code"), str(")")),
        digits
          .as("number")
          .then(upperLetter.as("letter_suffix"), str("r"), digits.as("revision_id"))
          .as("number_with_letter_revision"),
        rules["digits_with_suffix"]!,
      )
      .as("first_number"),
  );

  // OWMWP date number: MM-DD-YYYY — must precede the other shapes.
  rule("owmwp_date_number", () =>
    match("[0-9]")
      .repeat(2, 2)
      .as("owmwp_month")
      .then(
        dash,
        match("[0-9]").repeat(2, 2).as("owmwp_day"),
        dash,
        match("[0-9]").repeat(4, 4).as("owmwp_year"),
      )
      .as("owmwp_date_number"),
  );

  rule("second_number", () =>
    monthAbbrev()
      .absent()
      .then(
        str("draft").absent(),
        (
          digits
            .then(literalAlternation(["supp", "sup"]), digit.absent(), letter.absent())
            .or(
              digits.then(str("r"), digits, str("U"), lowerLetter),
              digits.then(str("r"), digits, letter),
              digits.as("number_only").then(str("r"), digits.as("edition_id")),
              digits.then(str("_"), digits, dash, digits, upperLetter.maybe()),
              lowerLetter.then(dash, digits),
              digits.then(str("pt"), digits, dash.absent()),
              digits.then(upperLetter),
              digits
                .as("number_only")
                .then(str("r"), letter.as("letter"))
                .as("revision_letter"),
              str("r").then(letter).as("revision_letter_suffix"),
              str("r").then(digits.as("edition_id")).as("revision_simple"),
              str("NCNR"),
              str("PERMIS"),
              str("BFRL"),
              upperLetter.repeat(1, 3),
              rules["digits_with_suffix"]!
                .then(dash.then(monthAbbrev(), digits, slash).absent()),
              lowerLetter.then(digit.absent()),
            )
        ).as("second_number"),
      ),
  );

  const editionInner = () =>
    space
      .maybe()
      .then(str("e"), digits.as("edition_id"))
      .as("edition_e")
      .or(
        space
          .then(str("r"), digits.as("edition_id"), letter.as("edition_letter"))
          .as("edition_r_with_space_letter"),
        space.then(str("r"), digits.as("edition_id")).as("edition_r_with_space"),
        str("r")
          .then(digits.as("edition_id"), letter.as("edition_letter"))
          .as("edition_r_no_space_letter"),
        str("r").then(digits.as("edition_id")).as("edition_r_no_space"),
        space
          .maybe()
          .then(str("rev"), space.maybe(), digits.as("edition_id"))
          .as("edition_rev"),
        dash.then(match("[1-9]").as("edition_id"), digit.absent()).as("edition_historical"),
        dash
          .then(match("[0-9]").repeat(4, 4).as("dash_year"))
          .as("edition_dash_year"),
      );

  rule("edition", () => editionInner());

  rule("date", () =>
    dash
      .then(
        match("[0-9]").repeat(4, 4).as("date_year"),
        match("[0-9]").repeat(2, 2).as("date_month"),
        match("[0-9]").repeat(2, 2).as("date_day"),
      )
      .as("date")
      .or(
        dash
          .then(match("[0-9]").repeat(4, 4).as("date_year"), match("[0-9]").repeat(2, 2).as("date_month"))
          .as("date"),
        dash.then(match("[0-9]").repeat(4, 4).as("date_year")).as("date"),
        dash
          .then(monthAbbrev().as("date_month"), digits.as("date_year"))
          .as("date"),
      ),
  );

  rule("iso_date", () =>
    match("[0-9]")
      .repeat(4, 4)
      .as("date_year")
      .then(dash, match("[0-9]").repeat(2, 2).as("date_month"), dash, match("[0-9]").repeat(2, 2).as("date_day")),
  );

  rule("dated_identifier", () =>
    rules["hash_prefix"]!
      .maybe()
      .then(
        rules["publisher"]!,
        space.or(dot),
        rules["iso_date"]!.as("dated_date"),
        space.or(dot),
        digits.as("dated_seq"),
      ),
  );

  rule("research_library_identifier", () =>
    rules["publisher"]!
      .then(
        space,
        str("Research Library").as("series"),
        space.then(str("("), match("[0-9]").repeat(4, 4).as("year"), str(")")).maybe(),
      ),
  );

  rule("legacy_edition", () =>
    (str("r").or(str(" R")))
      .then(match("[0-9]").repeat(1, 2).as("edition"), lowerLetter.as("edition_letter"))
      .or(
        str("rev").then(space.maybe(), digits.as("edition_year")),
        (str("e").or(str(" E"))).then(
          match("[0-9]").repeat(1, 3).as("edition"),
          str("rev"),
          match("[A-Za-z]").repeat(3, 9).as("edition_month"),
          digits.as("edition_year"),
        ),
        str("e").then(
          match("[0-9]").repeat(4, 4).as("edition_year"),
          match("[0-9]").repeat(2, 2).as("edition_month").maybe(),
        ),
        str("rev").then(
          match("[A-Za-z]").repeat(3, 9).as("edition_month"),
          digits.as("edition_year"),
        ),
      ),
  );

  rule("crpl_range", () =>
    digits
      .then(str("_"), digits, dash, digits, upperLetter.maybe())
      .as("crpl_range"),
  );

  rule("report_number", () =>
    rules["first_number"]!.then(
      str("_").then(digits.as("edition_year"))
        .or(
          dash.then(monthAbbrev().as("edition_month"), digits.as("edition_year")),
          // FIPS date: -1-Sep30/1977
          dash.then(
            digits.as("fips_part"),
            dash,
            monthAbbrev().as("edition_month"),
            digits.as("edition_day"),
            slash,
            digits.as("edition_year"),
          ),
          // Decimal: -2073.3
          dash
            .then(digits.as("decimal_base"), dot, digits.as("decimal_suffix"))
            .as("decimal_number"),
          // Letter: -1A / -197Ur
          dash
            .then(
              digits.as("letter_base"),
              (str("U").then(lowerLetter.as("letter_suffix_extra"))).or(upperLetter).as("letter_suffix"),
            )
            .as("letter_number"),
          // Dash-separated letter: -4-B
          dash
            .then(
              digits.as("letter_base"),
              dash,
              monthAbbrev().absent(),
              upperLetter.as("letter_suffix"),
              letter.or(digit).absent(),
            )
            .as("letter_number"),
          // Edition dash-year
          dash
            .then(
              match("[0-9]").repeat(4, 4).as("dash_year"),
              space.or(dot).or(ref(rules, "part")).or(ref(rules, "crpl_range")).or(ref(rules, "second_number")).or(dash).absent(),
            )
            .as("edition_dash_year"),
          // Second number + edition dash-year
          dash
            .then(
              rules["second_number"]!,
              dash,
              match("[0-9]").repeat(4, 4).as("dash_year"),
              space.or(dot).or(ref(rules, "part")).or(ref(rules, "crpl_range")).or(ref(rules, "revision")).or(ref(rules, "draft")).absent(),
            )
            .as("second_number_edition_year"),
          // FIPS month+year after part
          dash
            .then(
              rules["second_number"]!,
              dash,
              monthAbbrev().as("edition_month"),
              digits.as("edition_year"),
              space
                .or(dot)
                .or(ref(rules, "part"))
                .or(ref(rules, "crpl_range"))
                .or(editionInner())
                .or(ref(rules, "revision"))
                .or(ref(rules, "draft"))
                .absent(),
            )
            .as("fips_month_year_after_part"),
          // GCR multi-dash
          dash.then(rules["second_number"]!, dash, digits.then(upperLetter.maybe()).as("part_number")),
          // Dot-separated part
          dot.then(rules["second_number"]!),
          // Dash + (crpl_range | second_number) + edition?
          dash.then(rules["crpl_range"]!.or(rules["second_number"]!), editionInner().maybe()),
          dash.then(editionInner()),
        )
        .maybe(),
    ),
  );

  rule("volume", () =>
    space
      .maybe()
      .then(literalAlternation(["Vol. ", "Vol.", "v"]))
      .then(
        digits
          .then(literalAlternation(["a-l", "m-z", "A-L", "M-Z"]).maybe())
          .then(upperLetter.repeat(0, 2))
          .as("volume"),
      ),
  );


  rule("part", () =>
    literalAlternation([" Part. ", " Part.", " Part "])
      .or(space.maybe().then(literalAlternation(["pt", "p", "P"])))
      .then(
        digits
          .then((space.maybe().then(str("r"), digits)).maybe())
          .then((str("add").then((str("e").then(digits)).maybe())).maybe())
          .then((dash.then(digits)).maybe())
          .as("part"),
      ),
  );

  rule("revision", () =>
    space
      .maybe()
      .then(str("r").or(str("rev")), space.maybe(), monthAbbrev().as("revision_month"), digits.as("revision_year"))
      .or(
        space
          .maybe()
          .then(str("r").or(str("rev")), digits.as("revision"), slash, digits.as("revision_year")),
        (str(" r").or(str("r"))).then(space.maybe(), match("[0-9]").repeat(4, 4).as("revision_year")),
        str("rev").then(space.maybe(), digits.as("revision_year")),
        literalAlternation([" rev ", "rev", " r", "r", " Rev. ", " Rev.", " Revision (r)"])
          .as("revision_prefix")
          .then(
            space.maybe(),
            (digits.then(letter.maybe())).or(letter.repeat(1, Infinity)).as("revision_id"),
          )
          .as("revision"),
        str(" r").then(anyChar.absent()).as("revision_standalone"),
      ),
  );

  rule("version", () =>
    (space.or(dot))
      .maybe()
      .then(
        str("ver"),
        space.maybe(),
        digits.then(dot.then(digits).repeat(0, Infinity)).as("version"),
      )
      .or(
        (str(" Ver. ").or(str(" Version "))).then(
          digits,
          dot,
          digits,
          (dot.then(digits)).maybe(),
        ).as("version"),
        (dash.or(space))
          .maybe()
          .then(
            str("v"),
            digits.then(dot, digits, (dot.then(digits)).maybe()).as("version"),
          ),
      ),
  );

  rule("update", () =>
    str("/Upd")
      .as("update_prefix")
      .or(space.maybe().then(str("/upd").or(str("-upd"))).as("update_prefix"))
      .then(
        digits
          .as("update_number")
          .maybe()
          .then(
            dash
              .then(
                match("[0-9]").repeat(4, 4).as("update_year").then(match("[0-9]").repeat(2, 2).as("update_month")).or(
                  match("[0-9]").repeat(4, Infinity).as("update_year"),
                ),
              )
              .maybe(),
          )
          .as("update"),
      ),
  );

  rule("addendum", () =>
    (str("-add").or(str(".add")).or(str(" Add.")))
      .then((space.or(dash)).maybe(), digits.or(str("")).as("addendum_number"))
      .as("addendum"),
  );

  rule("supplement", () =>
    space
      .maybe()
      .then(str("supp").or(str("sup")))
      .then(
        str("rev")
          .as("supplement_with_rev")
          .or(
            monthAbbrev()
              .as("supp_month_start")
              .then(
                digits.as("supp_year_start"),
                dash,
                monthAbbrev().as("supp_month_end"),
                digits.as("supp_year_end"),
              )
              .as("supplement_date_range"),
            monthAbbrev().as("supp_month").then(digits.as("supp_year")).as("supplement_date"),
            digits.as("supp_number").then(slash, digits.as("supp_year")).as("supplement_slash_year"),
            digits.as("supp_year"),
            match("[A-Za-z0-9]").repeat(1, Infinity).as("supplement_suffix"),
          )
          .maybe(),
      ),
  );

  rule("errata", () => dash.maybe().then(str("errata").or(str("err"))).as("errata"));
  rule("index", () => str("index").or(str("indx")).as("index"));
  rule("insert", () => str("insert").or(str("ins")).as("insert"));
  rule("appendix", () => str("app").as("appendix"));
  rule("section", () => str("sec").then(digits.as("section").maybe()));

  rule("translation", () =>
    str("(")
      .then(match("\\w").repeat(3, 3).as("translation"), str(")"))
      .or(
        space.then(match("\\w").repeat(3, 3).as("translation")),
        space.maybe().then(dot, match("\\w").repeat(3, 3).as("translation")),
      ),
  );

  rule("pd_suffix", () => space.then(digits, str("pd")).as("public_draft"));

  rule("draft", () =>
    space
      .then(str("(Draft)"))
      .or(
        space.maybe().then(dash, str("draft"), (space.then(digits)).or(digits).maybe()),
        rules["pd_suffix"]!,
      )
      .as("draft"),
  );

  rule("fips_date", () =>
    dash.then(
      digits.as("fips_part"),
      dash,
      monthAbbrev().as("fips_month"),
      digits.as("fips_day"),
      slash,
      digits.as("fips_year"),
    ),
  );

  rule("parts", () =>
    rules["new_stage"]!.or(
      rules["section"]!,
      rules["index"]!,
      rules["insert"]!,
      rules["appendix"]!,
      rules["pd_suffix"]!,
      rules["edition"]!,
      rules["date"]!,
      rules["legacy_edition"]!,
      rules["revision"]!,
      rules["version"]!,
      rules["volume"]!,
      rules["part"]!,
      rules["update"]!,
      rules["addendum"]!,
      rules["supplement"]!,
      rules["errata"]!,
      rules["language_code"]!,
    ),
  );

  rule("mr_identifier", () =>
    rules["hash_prefix"]!
      .maybe()
      .then(
        rules["publisher"]!,
        dot,
        rules["simple_series"]!,
        dot,
        rules["report_number"]!,
        str("_").then(digits.as("edition_year")).maybe(),
        upperLetter.maybe(),
        rules["edition"]!.maybe(),
        rules["update"]!.maybe(),
        dot.then(digits.or(upperLetter)).repeat(0, 3),
        rules["parts"]!.repeat(0, Infinity),
        rules["draft"]!.maybe(),
      ),
  );

  rule("identifier", () =>
    ref(rules, "circ_supplement_identifier").or(
      rules["dated_identifier"]!,
      rules["mr_identifier"]!,
      rules["research_library_identifier"]!,
      rules["compound_series"]!
        .then(
          space.or(dot),
          rules["old_stage"]!.maybe(),
          rules["report_number"]!.maybe(),
          rules["fips_date"]!.maybe(),
          rules["parts"]!.repeat(0, Infinity),
          rules["draft"]!.maybe(),
          rules["translation"]!.maybe(),
          rules["new_stage"]!.maybe(),
        ),
      rules["publisher"]!
        .then(
          space.or(dot),
          rules["simple_series"]!,
          rules["old_stage"]!.maybe(),
          space.or(dot),
          rules["report_number"]!.maybe(),
          rules["fips_date"]!.maybe(),
          rules["parts"]!.repeat(0, Infinity),
          rules["draft"]!.maybe(),
          rules["translation"]!.maybe(),
          rules["new_stage"]!.maybe(),
        ),
      rules["simple_series"]!
        .then(
          rules["old_stage"]!.maybe(),
          space.or(dot),
          rules["report_number"]!.maybe(),
          rules["fips_date"]!.maybe(),
          rules["parts"]!.repeat(0, Infinity),
          rules["draft"]!.maybe(),
          rules["translation"]!.maybe(),
          rules["new_stage"]!.maybe(),
        ),
    ),
  );

  rule("circ_supplement_identifier", () =>
    literalAlternation(["NBS CIRC", "NBS LCIRC", "NBS.CIRC", "NBS.LCIRC"])
      .as("series")
      .then(space.or(dot))
      .as("circ_series")
      .then(
        str("supp")
          .then(
            monthAbbrev().as("supp_month_start"),
            digits.as("supp_year_start"),
            dash,
            monthAbbrev().as("supp_month_end"),
            digits.as("supp_year_end"),
          )
          .as("supplement_date_range")
          .or(
            (str("supp").or(str("sup")))
              .then(
                match("[0-9]").repeat(4, 4).as("supp_year_start"),
                dash,
                match("[0-9]").repeat(4, 4).as("supp_year_end"),
              )
              .as("supplement_date_range"),
            (
              digits.as("base_number").then(str("e"), digits.as("edition_number")).or(
                digits
                  .as("base_number")
                  .then(lowerLetter.as("revision_letter"), digits.as("revision_number")),
                digits.as("base_number").then(upperLetter.as("letter_suffix")),
                digits.as("simple_number"),
              )
            )
              .as("base_portion")
              .then(
                (
                  (str("supp").or(str("sup"))).then(
                    (
                      monthAbbrev().then(digits).as("supplement_month_year").or(
                        dash.then(digits.as("supp_number"), slash, digits.as("supp_year")).as("supplement_dash_slash_year"),
                        dash.then(digits.as("supplement_year")),
                        digits.as("supp_number").then(slash, digits.as("supp_year")).as("supplement_slash_year"),
                        str("").as("supplement_empty"),
                      )
                    ).maybe(),
                  )
                ).or(
                  slash.then(digits.as("implicit_supplement_year")).as("implicit_supplement"),
                ),
              ),
          ),
      ),
  );

  rule("root", () => rules["identifier"]!);
  return rules;
}

export const nistGrammar: Grammar = { rules: buildRules(), root: "root" };
