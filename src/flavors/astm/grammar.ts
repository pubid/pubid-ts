import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/astm/parser.rb — 1:1. The identifier alternation
 * order is load-bearing (research_report first, standard last).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const dash = str("-");
  const slash = str("/");
  const colon = str(":");
  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  const letter = match("[A-Z]");
  const letters = letter.repeat(1, Infinity);

  const publisher = () => str("ASTM").as("publisher").then(space.maybe());

  rule("standard_letter", () => match("[A-G]").as("letter"));

  rule("year_2digit", () => digit.repeat(2, 2).as("year"));

  rule("reapproval", () =>
    str("(").then(digit.repeat(4, 4).as("reapproval")).then(str(")")));

  rule("comment", () => space.maybe().then(str("#")).then(match("[^#]").repeat(0, Infinity)));

  rule("edition", () =>
    str("e").then(digits.as("edition_number"))
      .or(str("9TH")).or(str("8TH")).or(str("7TH")).or(str("6TH"))
      .or(str("5TH")).or(str("4TH")).or(str("3RD")).or(str("2ND"))
      .or(str("1ST"))
      .as("edition"),
  );

  rule("sub_year", () => match("[a-c]").as("sub_year"));

  rule("format_suffix", () => dash.then(str("EB").as("format_suffix")));

  rule("format_suffix_no_dash", () => str("EB").as("format_suffix"));

  rule("supplement", () => dash.then(str("SUP").as("supplement")).then(dash));

  rule("research_report", () =>
    publisher().maybe()
      .then(str("RR").as("type"))
      .then(colon)
      .then(letter.then(digit.repeat(2, 2)).as("committee"))
      .then(dash)
      .then(digits.as("number")),
  );

  rule("manual", () =>
    publisher().maybe()
      .then(str("MNL").as("type"))
      .then(str("TP").as("tp_designation").maybe())
      .then(digits.as("number"))
      .then(dash.then(ref(rules, "edition")).maybe())
      .then(
        ref(rules, "supplement").then(ref(rules, "format_suffix_no_dash").maybe())
          .or(ref(rules, "format_suffix").maybe()),
      ),
  );

  rule("monograph", () =>
    publisher().maybe()
      .then(str("MONO").as("type"))
      .then(digits.as("number"))
      .then(dash.then(ref(rules, "edition")).maybe())
      .then(ref(rules, "format_suffix").maybe()),
  );

  rule("data_series_suffix", () => match("[A-Z]").as("suffix"));

  rule("data_series_subseries_with_dash", () =>
    dash.then(str("S")).then(digits.as("subseries")));

  rule("data_series_subseries_no_dash", () => digits.as("subseries"));

  rule("data_series_code", () =>
    digits.as("number").then(
      str("HOL").as("hol_suffix")
        .or(
          ref(rules, "data_series_suffix")
            .then(ref(rules, "data_series_subseries_no_dash").maybe()),
        )
        .or(ref(rules, "data_series_subseries_with_dash"))
        .maybe(),
    ),
  );

  rule("data_series", () =>
    publisher().maybe()
      .then(str("DS").as("type"))
      .then(ref(rules, "data_series_code"))
      .then(ref(rules, "format_suffix").maybe()),
  );

  rule("work_in_progress", () =>
    publisher().maybe()
      .then(str("WK").as("type"))
      .then(digits.as("number")),
  );

  rule("adjunct", () =>
    publisher().maybe()
      .then(str("ADJ").as("type"))
      .then(
        letter.then(digits).or(letters).or(digits).as("designation"),
      )
      .then(dash.then(str("EA")).maybe().as("ea_suffix"))
      .then(str("DVD").maybe().as("dvd_suffix")),
  );

  rule("technical_report_iso_astm", () =>
    str("ISO/ASTMTR").as("type")
      .then(digits.as("number"))
      .then(ref(rules, "format_suffix").maybe())
      .then(ref(rules, "comment").maybe()),
  );

  rule("technical_report_simple", () =>
    publisher().maybe()
      .then(str("TR").as("type"))
      .then(digits.as("number"))
      .then(ref(rules, "format_suffix").maybe())
      .then(ref(rules, "comment").maybe()),
  );

  rule("technical_report", () =>
    ref(rules, "technical_report_iso_astm").or(ref(rules, "technical_report_simple")));

  rule("dual_unit", () =>
    slash.then(ref(rules, "standard_letter")).then(digits).then(str("M").as("dual_m")));

  rule("standard_code_with_letter", () =>
    ref(rules, "standard_letter").then(digits.as("number")).then(ref(rules, "dual_unit").maybe()),
  );

  rule("standard_code_digit_only", () => digits.as("number"));

  rule("standard", () =>
    publisher().maybe()
      .then(
        ref(rules, "standard_code_with_letter").or(ref(rules, "standard_code_digit_only")),
      )
      .then(
        dash.then(ref(rules, "year_2digit"))
          .then(ref(rules, "sub_year").maybe())
          .then(ref(rules, "reapproval").maybe())
          .then(ref(rules, "edition").maybe())
          .maybe(),
      )
      .then(ref(rules, "comment").maybe()),
  );

  rule("identifier", () =>
    ref(rules, "research_report")
      .or(ref(rules, "technical_report"))
      .or(ref(rules, "manual"))
      .or(ref(rules, "monograph"))
      .or(ref(rules, "data_series"))
      .or(ref(rules, "work_in_progress"))
      .or(ref(rules, "adjunct"))
      .or(ref(rules, "standard")),
  );

  return rules;
}

export const astmGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};
