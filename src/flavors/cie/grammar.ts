import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/cie/parser.rb — the CIE grammar's 17 alternatives,
 * longest/most-specific first (PEG ordered choice). The dual-style date
 * era is carried by WHICH rule matched (current_date ":" vs
 * legacy_date "-"), wrapped in its own marker so the builder can derive
 * `style` without a separate separator field.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  const upper = match("[A-Z]");
  const space = str(" ");
  const dash = str("-");
  const colon = str(":");
  const dot = str(".");
  const slash = str("/");
  const comma = str(",");

  // Year 1900-2099.
  const yearDigits = str("19").or(str("20")).then(digit.repeat(2, 2));

  rule("legacy_date", () => dash.then(yearDigits.as("year")).as("legacy_date"));
  rule("current_date", () => colon.then(yearDigits.as("year")).as("current_date"));
  rule("date", () => rules["current_date"]!.or(rules["legacy_date"]!));

  // Legacy NUMBER-YEAR ("001-1980"), optionally with "(RU-2020)".
  rule("legacy_code_with_year", () =>
    str("CIE").then(
      space,
      digits.as("number"),
      dash,
      yearDigits.as("year"),
      ref(rules, "language_paren_year").or(str("")).as("trailing_lang"),
    ),
  );

  rule("code_with_iteration", () =>
    digits.as("number").then(dot, digits.as("iteration")),
  );
  rule("code_with_part_and_iteration_slash", () =>
    digits.as("number").then(slash, digits.as("part"), dot, digits.as("iteration")),
  );
  rule("code_with_part_and_iteration_dash", () =>
    digits
      .as("number")
      .then(dash, digits.as("part"), dot, digits.as("iteration"), dash.absent()),
  );
  // Part 1-3 digits, never a 4-digit year and never dot/dash after.
  rule("code_with_part_dash", () =>
    digits
      .as("number")
      .then(
        dash,
        digit.repeat(1, 3).as("part"),
        str("").as("dash_sep"),
        str("19").or(str("20")).absent(),
        dot.or(dash).absent(),
      ),
  );
  rule("code_with_part_slash", () =>
    digits
      .as("number")
      .then(slash, digits.as("part"), str("").as("slash_sep"), dot.absent()),
  );
  rule("code_simple", () => digits.as("number"));
  rule("code", () =>
    rules["code_with_part_and_iteration_slash"]!
      .or(
        rules["code_with_part_and_iteration_dash"]!,
        rules["code_with_iteration"]!,
        rules["code_with_part_slash"]!,
        rules["code_with_part_dash"]!,
        rules["code_simple"]!,
      ),
  );

  // Language formats: /E (slash), (DE) (paren), (RU-2021) (paren_year).
  rule("language_slash", () =>
    slash.then(upper.as("lang_code")).as("language_slash"),
  );
  rule("language_paren", () =>
    str("(")
      .then(match("[A-Za-z]").repeat(1, 3).as("lang_code"), str(")"))
      .as("language_paren"),
  );
  rule("language_paren_year", () =>
    space
      .maybe()
      .then(
        str("("),
        upper.repeat(2, Infinity).as("lang_code"),
        dash,
        yearDigits.as("trans_year"),
        str(")"),
      )
      .as("language_paren_year"),
  );
  rule("language", () =>
    rules["language_paren_year"]!
      .or(rules["language_paren"]!, rules["language_slash"]!),
  );

  const sPrefix = () => str("S").then(space);
  const stageCode = () => str("FDIS").or(str("DIS"), str("DS")).then(space);
  const docType = () => str("TR").or(str("TS"));

  // Proceedings paper code: 1+ uppercase letters (OP, PO, PP, …).
  const paperCode = () => match("[A-Z]").repeat(1, Infinity).as("paper_code");

  // Techstreet opaque conference variant; lowercase-alnum so it cannot
  // collide with /E, /Cor or /IEC tails.
  rule("variant_slug", () => slash.then(match("[0-9a-z]").repeat(1, Infinity).as("variant")));

  // "CIE x043-OP01".
  rule("conf_proceedings", () =>
    str("CIE").then(
      space,
      str("x"),
      digits.as("conf_number"),
      dash,
      paperCode(),
      digits.as("paper_number"),
    ),
  );

  // "CIE OP02 1-5".
  rule("standalone_proceedings", () =>
    str("CIE").then(
      space,
      paperCode(),
      digits.as("paper_number"),
      space,
      digits.then(dash, digits).as("page_range"),
    ),
  );

  rule("d_series_identifier", () =>
    str("CIE").then(space, str("D").as("d_prefix"), digits.as("number"), rules["date"]!),
  );

  // "CIE S 007/1998" — narrow number(+iteration) so part_slash can't
  // greedily eat the /year.
  rule("standard_with_slash_year", () =>
    str("CIE").then(
      space,
      stageCode().maybe().as("stage"),
      sPrefix().maybe().as("s_prefix"),
      digits.as("number").then(dot.then(digits.as("iteration")).maybe()),
      slash,
      yearDigits.as("slash_year"),
    ),
  );

  // "DIS 025-SP1/E:2019".
  rule("dis_with_supplement", () =>
    str("CIE").then(
      space,
      stageCode().as("stage"),
      sPrefix().maybe().as("s_prefix"),
      digits.as("base_number"),
      dash,
      str("SP"),
      digits.as("supplement_number"),
      dot.then(digits.as("supplement_part")).maybe(),
      slash,
      upper.as("lang_code"),
      colon.as("lang_colon"),
      yearDigits.as("year"),
    ),
  );

  rule("standard_identifier", () =>
    str("CIE").then(
      space,
      stageCode().maybe().as("stage"),
      sPrefix().maybe().as("s_prefix"),
      rules["code"]!,
      rules["language"]!
        .then(rules["date"]!)
        .as("lang_before")
        .or(
          rules["date"]!.then(rules["language"]!.maybe()).as("date_then_lang"),
          rules["date"]!,
        )
        .maybe(),
    ),
  );

  // "CIE S 014-4/E:2007" (language/year, no ISO reference).
  rule("standard_with_language_year", () =>
    str("CIE").then(
      space,
      stageCode().maybe().as("stage"),
      sPrefix().maybe().as("s_prefix"),
      rules["code"]!,
      slash,
      upper.as("lang_code"),
      colon.as("lang_colon"),
      yearDigits.as("year"),
    ),
  );

  rule("conference_identifier", () =>
    str("CIE").then(
      space,
      str("x").as("conference"),
      digits.as("conf_number"),
      rules["date"]!,
      space.then(str("Amendment"), space, digits.as("amd_number")).maybe(),
      rules["variant_slug"]!.maybe(),
    ),
  );

  // "CIE ISO 11664-1:2019(E)" — the absent-guard rejects "ISO/CIE".
  rule("joint_with_iso", () =>
    str("CIE")
      .then(
        space,
        str("ISO").as("copublisher"),
        slash.then(str("CIE")).absent(),
        space,
        docType().then(space).maybe().as("doc_type"),
        stageCode().maybe().as("stage"),
        digits.as("number"),
        dash.then(digits.as("part")).maybe(),
        colon.or(dash).then(yearDigits.as("year")).maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("joint_with_iso_cie", () =>
    str("CIE").then(
      space,
      str("ISO/CIE").as("copublisher"),
      space,
      docType().then(space).maybe().as("doc_type"),
      digits.as("number"),
      colon.then(yearDigits.as("year")).maybe(),
      rules["language"]!.maybe(),
    ),
  );

  // IEC always joins the part with a dot and the year with a dash.
  rule("joint_with_iec", () =>
    str("CIE").then(
      space,
      str("IEC").as("copublisher"),
      space,
      digits.as("number"),
      dot,
      digits.as("part"),
      dash,
      yearDigits.as("year"),
    ),
  );

  // "CIE S 008/E:2001 (ISO 8995-1:2002(E))".
  rule("identical_with_iso", () =>
    str("CIE").then(
      space,
      sPrefix().maybe().as("s_prefix"),
      digits.as("number"),
      dot.then(digits.as("iteration"))
        .or(dash.then(digits.as("part")))
        .maybe(),
      slash
        .then(
          upper
            .as("lang_code")
            .then(colon.as("lang_colon"), yearDigits.as("year"))
            .or(
              upper.as("lang_code").then(yearDigits.as("year")),
              yearDigits.as("slash_year"),
            ),
        )
        .maybe(),
      space,
      str("(ISO"),
      space,
      match("[0-9A-Z:/.\\-]")
        .repeat(1, Infinity)
        .then(str("(").then(match("[A-Z]").repeat(1, Infinity), str(")")).maybe())
        .as("iso_reference"),
      str(")"),
    ),
  );

  // "CIE S 009:2002/IEC 62471:2006".
  rule("dual_with_iec", () =>
    str("CIE").then(
      space,
      sPrefix().maybe().as("s_prefix"),
      digits.as("number"),
      colon,
      yearDigits.as("year"),
      slash,
      str("IEC"),
      space,
      match("[^)\\n]").repeat(1, Infinity).as("iec_identifier"),
    ),
  );

  rule("supplement_identifier", () =>
    str("CIE").then(
      space,
      digits.as("base_number"),
      dash,
      str("SP"),
      digits.as("supplement_number"),
      dot.then(digits.as("supplement_part")).maybe(),
      colon,
      yearDigits.as("year"),
    ),
  );

  rule("corrigendum_identifier", () =>
    str("CIE")
      .then(
        space,
        digits.as("base_number"),
        dash
          .then(
            str("SP"),
            digits.as("base_supplement"),
            dot.then(digits.as("base_supplement_part")).maybe(),
          )
          .maybe(),
        colon,
        yearDigits.as("base_year"),
        slash,
        str("Cor"),
        digits.as("cor_number"),
        colon,
        yearDigits.as("cor_year"),
      ),
  );

  rule("bundle_identifier", () =>
    str("CIE").then(
      space,
      digits.as("first_number"),
      dash,
      str("SP"),
      digits,
      dot,
      digits,
      colon,
      yearDigits,
      comma.then(
        digits.as("next_number"),
        dash,
        str("SP"),
        digits,
        dot,
        digits,
        colon,
        yearDigits,
      )
        .repeat(1, Infinity)
        .as("bundle_items"),
    ),
  );

  rule("tutorial_bundle", () =>
    str("CIE Tutorials Bundle").then(space, digits.as("bundle_number")),
  );

  rule("identifier", () =>
    rules["tutorial_bundle"]!
      .or(
        rules["bundle_identifier"]!,
        rules["joint_with_iso_cie"]!,
        rules["joint_with_iso"]!,
        rules["joint_with_iec"]!,
        rules["identical_with_iso"]!,
        rules["dis_with_supplement"]!,
        rules["dual_with_iec"]!,
        rules["corrigendum_identifier"]!,
        rules["supplement_identifier"]!,
        rules["standard_with_language_year"]!,
        rules["standard_with_slash_year"]!,
        rules["d_series_identifier"]!,
        rules["conf_proceedings"]!,
        rules["standalone_proceedings"]!,
        // Before standard_identifier, to catch the 001-1980 pattern.
        rules["legacy_code_with_year"]!,
        rules["conference_identifier"]!,
        rules["standard_identifier"]!,
      ),
  );

  rule("root", () => rules["identifier"]!);
  return rules;
}

/** Parser.parse's preprocessing: strip, drop #-comments, collapse runs,
 * insert the missing colon in "/E2007"-style language-years. */
export function preprocessCie(input: string): string {
  return input
    .trim()
    .replace(/\s*#.*$/, "")
    .replace(/\s+/g, " ")
    .replace(/\/(E|F|G|DE|ES|CN|RU|FR)(\d{4})/g, "/$1:$2");
}

export const cieGrammar: Grammar = { rules: buildRules(), root: "root" };
