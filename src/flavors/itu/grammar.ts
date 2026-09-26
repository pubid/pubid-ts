import { Grammar, P, match, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/itu/parser.rb — the ITU grammar, 1:1 in dependency
 * order. Load-bearing orderings (PEG ordered choice never re-enters a
 * succeeded alternative, so neighbour order in `identifier` is pinned
 * by the Ruby comments):
 *   annex_to | special_publication | supplement | annex | appendix |
 *   report | handbook | numeric_question | letter_question | with_series |
 *   contribution | series_code | without_series
 * and supplement chains precede supplement_with_base (which would
 * otherwise strand "/Technical Cor. 1" trailing input).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };

  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  const letter = match("[A-Z]");
  const space = str(" ");
  const dash = str("-");
  const dot = str(".");

  // ITU prefix — the optional "Recommendation " long form (issues #233/#234).
  rule("itu_prefix", () =>
    str("Recommendation ")
      .then(str("ITU"), dash.or(space))
      .or(str("ITU").then(dash.or(space))),
  );

  rule("sector", () => str("R").or(str("T"), str("D")).as("sector"));

  // Study groups (SG1, SG12) or 1-3 letter series (BO, V, X).
  rule("series", () =>
    str("SG")
      .then(digits)
      .or(letter.repeat(1, 3))
      .as("series"),
  );

  // A numeric series GROUP ("E-100", "G-100") — exactly one leading
  // letter, or it would shadow series-code documents (EMC-5, IMPL-8).
  rule("series_group", () =>
    letter.then(digits.maybe(), dash, digits).as("series"),
  );

  rule("series_word", () => space.then(str("series").as("series_word")));

  rule("number", () => digits.as("number"));

  rule("subseries", () => dot.then(digits.as("subseries")));

  // "quarter" is a real ITU misspelling kept verbatim so the two
  // records stay distinct from their "quater" siblings.
  const seriesSuffixWord = () =>
    str("bis").or(str("ter"), str("quater"), str("quarter"));

  // Glued edition suffix ("X.50bis", "V.8bis").
  rule("series_suffix", () => seriesSuffixWord().as("series_suffix"));

  // The spaced form ("E.250 bis") — the captured space IS the marker
  // that sets series_suffix_spaced.
  rule("series_suffix_spaced", () =>
    space.as("series_suffix_spaced").then(seriesSuffixWord().as("series_suffix")),
  );

  // A single trailing variant letter ("D.200 R", glued "D.502R",
  // lowercase "I.256.2a"). The A-R cap excludes "S" of " Suppl." and
  // "V" of " V2"; the absent-guard stops it eating "Amd."/"Annex"/"Cor.".
  rule("qualifier_letter", () =>
    match("[A-R]")
      .or(match("[a-r]"))
      .as("qualifier")
      .then(match("[A-Za-z0-9]").absent()),
  );

  rule("qualifier_glued", () => rules["qualifier_letter"]!);

  rule("qualifier_spaced", () =>
    space.as("qualifier_spaced").then(rules["qualifier_letter"]!),
  );

  // Print-form suffixes spliced after code, before combined_suffixes.
  rule("code_suffixes", () =>
    rules["series_suffix_spaced"]!
      .maybe()
      .then(rules["qualifier_spaced"]!.maybe()),
  );

  rule("attachment", () => space.then(str("attachment").as("attachment")));

  // "ITU-T Q.120-Q.139 (11/1988)" — one document covering a range.
  rule("range_end", () =>
    dash.then(letter.repeat(1, 3).then(dot, digits).as("range_end")),
  );

  rule("date_part", () =>
    space.then(
      str("("),
      digits.as("month").then(str("/")).maybe(),
      digit.repeat(4, 4).as("year"),
      str(")"),
    ),
  );

  // A "-YYYYMM" approval date — the "200307" of "T-REC-T.4-200307-I" and
  // "ITU-T T.4-200307". ITU's own edition suffix is short ("-5"), so six
  // digits that read as a plausible year (19xx/20xx) and month (01-12) are
  // the date, never a part. A six-digit run that fails either test
  // ("-200313", "-180001") is still a part, as it was before.
  rule("yyyymm_year", () => str("19").or(str("20")).then(digit.repeat(2, 2)));
  rule("yyyymm_month", () =>
    str("0").then(match("[1-9]")).or(str("1").then(match("[0-2]"))),
  );
  rule("yyyymm_shape", () =>
    rules["yyyymm_year"]!.then(rules["yyyymm_month"]!, digit.absent()),
  );

  rule("part", () =>
    dash.then(rules["yyyymm_shape"]!.absent(), digits.as("part")),
  );

  rule("parts", () => rules["part"]!.repeat(0, Infinity).as("parts"));

  // Imp code first: the standard code needs digits, which "Imp712" lacks.
  rule("imp_code", () =>
    str("Imp")
      .as("imp_marker")
      .then(digits.or(letter.repeat(1, 3)).as("number"), rules["subseries"]!.maybe(), rules["parts"]!),
  );

  rule("standard_code", () =>
    rules["number"]!
      .then(
        rules["series_suffix"]!.maybe(),
        rules["subseries"]!.maybe(),
        rules["parts"]!,
        rules["qualifier_glued"]!.maybe(),
      ),
  );

  rule("code", () => rules["imp_code"]!.or(rules["standard_code"]!));

  // The status letter that trails the date in a publication id — "I" (in
  // force) or "S" (superseded). It names the state of the edition, not the
  // edition, so it is parsed and dropped. "S" is also the Spanish language
  // suffix, so it is a status ONLY in the full "T-REC-…" id, where ITU
  // always writes one; after an "ITU-T …-YYYYMM" print form only "I" is,
  // and "-S" stays the language ("ITU-T Z.100-199911-S").
  rule("id_status", () => dash.then(match("[IS]"), match("[A-Za-z0-9]").absent()));
  rule("print_id_status", () => dash.then(str("I"), match("[A-Za-z0-9]").absent()));
  rule("yyyymm_date", () =>
    dash.then(
      rules["yyyymm_year"]!.as("year"),
      rules["yyyymm_month"]!.as("month"),
      digit.absent(),
    ),
  );
  rule("id_date", () => rules["yyyymm_date"]!.then(rules["print_id_status"]!.maybe()));

  // Either date spelling of a Recommendation.
  rule("document_date", () => rules["date_part"]!.or(rules["id_date"]!));

  // "ITU-T REC T.4", "ITU-T REC-T.4" — the redundant type word of ITU's
  // own URLs. Not captured: a Recommendation is the default type.
  rule("rec_word", () => str("REC").then(space.or(dash)));

  // "(V14)" plus the bare spellings "V2", "v10", "v.1" — all
  // normalise to the parenthesised form on render.
  rule("version_part", () =>
    space.then(
      str("(V")
        .then(digits.as("version"), str(")"))
        .or(
          str("V")
            .or(str("v"))
            .then(dot.maybe(), digits.as("version")),
        ),
    ),
  );

  rule("language", () => dash.then(match("[EFASCR]").as("language")));

  // "/Y.1351" joint designations, repeatable for triples. Each
  // designation carries its own print-form suffixes ("D.81/F.80 bis").
  rule("combined_designation", () =>
    str("/").then(
      rules["series"]!
        .then(
          dot,
          digits.as("number"),
          rules["subseries"]!.maybe(),
          rules["parts"]!,
          rules["qualifier_glued"]!.maybe(),
          rules["series_suffix_spaced"]!.maybe(),
          rules["qualifier_spaced"]!.maybe(),
        )
        .as("designation"),
    ),
  );

  rule("combined_suffixes", () =>
    rules["combined_designation"]!.repeat(1, Infinity).as("combined"),
  );

  // "Technical" is bound to the Cor. branch alone — offered at the
  // head it would be silently dropped on "Technical Err. 1" and
  // collapse that onto another document.
  rule("technical_marker", () => str("Technical").as("technical").then(space));

  rule("supplement_type", () =>
    str("Suppl.")
      .or(
        str("Suppl"),
        str("Amd."),
        str("Amd"),
        str("Add."),
        str("Add"),
        str("Err."),
        str("Err"),
      )
      .as("supplement_type")
      .or(
        rules["technical_marker"]!
          .maybe()
          .then(str("Cor.").or(str("Cor")).as("supplement_type")),
      ),
  );

  // The captured space marks the SPACED ordinal; its absence is the
  // glued flag. The ordinal itself may be dotted ("M Suppl. 1.1").
  rule("supplement_number", () =>
    space
      .as("supplement_space")
      .maybe()
      .then(digits.then(dot.then(digits).repeat(0, Infinity)).as("supplement_number")),
  );

  rule("supplement_date", () =>
    space.then(
      str("("),
      digits.as("supplement_month").then(str("/")).maybe(),
      digit.repeat(4, 4).as("supplement_year"),
      str(")"),
    ),
  );

  rule("base_with_series", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["rec_word"]!.maybe(),
        rules["series"]!,
        dot,
        rules["code"]!,
        rules["range_end"]!.maybe(),
        rules["code_suffixes"]!,
        rules["combined_suffixes"]!.maybe(),
        rules["series_word"]!.maybe(),
        rules["attachment"]!.maybe(),
        rules["version_part"]!.maybe(),
        rules["document_date"]!.maybe(),
      ),
  );

  rule("base_without_series", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["code"]!,
        rules["code_suffixes"]!,
        rules["attachment"]!.maybe(),
        rules["version_part"]!.maybe(),
        rules["document_date"]!.maybe(),
      ),
  );

  // Series-code documents ("EMC-5", "SEC-QKD"): 2+ letter mnemonic,
  // dash-joined number. The OB guard keeps "ITU-T OB-1" a clean parse
  // failure rather than an escaped ArgumentError.
  rule("series_code_body", () =>
    str("OB")
      .then(dash)
      .absent()
      .then(
        letter.repeat(2, Infinity).as("series"),
        dash.as("series_dash"),
        digits.or(letter.repeat(1, Infinity)).as("number"),
        rules["parts"]!,
      ),
  );

  // "ITU-R SG17-C1000" (pubid#340) — the "-C" marker distinguishes it.
  rule("contribution", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["series"]!,
        str("-C").as("contribution_marker"),
        rules["number"]!,
        rules["parts"]!,
        rules["language"]!.maybe(),
      ),
  );

  rule("base_series_code", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["series_code_body"]!,
        rules["version_part"]!.maybe(),
        rules["date_part"]!.maybe(),
      ),
  );

  rule("series_code_identifier", () =>
    rules["base_series_code"]!.then(rules["language"]!.maybe()),
  );

  rule("report_word", () => str("Report").as("report_marker"));

  // No combined_suffixes: a joint Report would silently drop the
  // marker in the combined branch; a clean failure is better. The OB
  // guard mirrors series_code_body's.
  rule("report_body", () =>
    str("OB")
      .then(dot)
      .absent()
      .then(
        rules["series"]!.then(dot).maybe(),
        rules["code"]!,
        rules["range_end"]!.maybe(),
        rules["code_suffixes"]!,
        rules["series_word"]!.maybe(),
        rules["attachment"]!.maybe(),
        rules["version_part"]!.maybe(),
        rules["date_part"]!.maybe(),
      ),
  );

  rule("base_report", () =>
    rules["report_word"]!
      .then(space, rules["itu_prefix"]!, rules["sector"]!, space, rules["report_body"]!)
      .or(
        rules["itu_prefix"]!.then(
          rules["sector"]!,
          space,
          rules["report_word"]!,
          space,
          rules["report_body"]!,
        ),
      ),
  );

  rule("report_identifier", () =>
    rules["base_report"]!.then(rules["language"]!.maybe()),
  );

  rule("base", () =>
    rules["base_report"]!.or(
      rules["base_with_series"]!,
      rules["base_without_series"]!,
      rules["base_series_code"]!,
    ),
  );

  // Annex label: one letter, optional number and/or "+" ("F3", "C+").
  rule("annex_label", () => letter.then(digits.maybe(), str("+").maybe()));

  rule("annex_body", () =>
    rules["base"]!
      .as("base")
      .then(
        space,
        str("Annex"),
        space,
        rules["annex_label"]!.as("annex_number"),
        rules["date_part"]!.maybe(),
      ),
  );

  rule("annex_identifier", () =>
    rules["annex_body"]!.then(rules["language"]!.maybe()),
  );

  rule("roman", () => match("[IVX]").repeat(1, Infinity));

  rule("appendix_material", () =>
    space.then(
      str("test vectors").or(str("Software")).as("appendix_material"),
    ),
  );

  rule("appendix_body", () =>
    rules["base"]!
      .as("base")
      .then(
        space,
        str("App."),
        space.maybe(),
        rules["roman"]!.as("appendix_number"),
        rules["appendix_material"]!.maybe(),
        rules["date_part"]!.maybe(),
      ),
  );

  rule("appendix_identifier", () =>
    rules["appendix_body"]!.then(rules["language"]!.maybe()),
  );

  rule("supplement_with_base", () =>
    rules["annex_body"]!
      .as("base")
      .or(
        rules["appendix_body"]!.as("base"),
        rules["base"]!.as("base"),
      )
      .then(
        space,
        rules["supplement_type"]!,
        rules["supplement_number"]!,
        rules["supplement_date"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  // series_group FIRST: the greedy 1-3 letter series would take the
  // "E" of "E-100" and strand the required space.
  rule("supplement_series_only", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["series_group"]!.or(rules["series"]!),
        rules["series_word"]!.maybe(),
        space,
        rules["supplement_type"]!,
        rules["supplement_number"]!,
        rules["supplement_date"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  // A supplement whose base is itself a supplement (Err. on Amd.).
  rule("chained_supplement", () =>
    rules["supplement_with_base"]!
      .or(rules["supplement_series_only"]!)
      .as("base")
      .then(
        space,
        rules["supplement_type"]!,
        rules["supplement_number"]!,
        rules["supplement_date"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  // "Amd. 1/Technical Cor. 1" — one Technical Corrigendum against an
  // Amendment, sharing the trailing date. The "/" marker round-trips.
  rule("slash_chained_supplement", () =>
    rules["supplement_with_base"]!
      .as("base")
      .then(
        str("/").as("supplement_slash"),
        rules["supplement_type"]!,
        rules["supplement_number"]!,
        rules["supplement_date"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("supplement_identifier", () =>
    rules["chained_supplement"]!
      .or(
        rules["slash_chained_supplement"]!,
        rules["supplement_with_base"]!,
        rules["supplement_series_only"]!,
      ),
  );

  rule("with_series", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["rec_word"]!.maybe(),
        rules["series"]!,
        dot,
        rules["code"]!,
        rules["range_end"]!.maybe(),
        rules["code_suffixes"]!,
        rules["combined_suffixes"]!.maybe(),
        rules["series_word"]!.maybe(),
        rules["attachment"]!.maybe(),
        rules["version_part"]!.maybe(),
        rules["document_date"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("without_series", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["code"]!,
        rules["code_suffixes"]!,
        rules["attachment"]!.maybe(),
        rules["version_part"]!.maybe(),
        rules["document_date"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("ob_series", () => str("OB").as("series"));

  rule("ob_dot_body", () => dot.then(rules["number"]!));

  rule("ob_no_body", () => space.then(str("No."), space, rules["number"]!));

  // "ITU OB 1000" — metanorma-itu's docidentifier ("Annex to ITU OB %").
  // Accepted as an input spelling only; it renders "ITU OB No. 1000", the
  // form ITU's own bulletin site uses.
  rule("ob_bare_body", () => space.then(rules["number"]!));

  // The date as a bulletin prints it — "ITU-T OB.1096 - 15.III.2016": day,
  // Roman month, year. The months are tried longest first, because PEG
  // takes the first alternative that matches and "I" would otherwise win
  // on "III"; "XIII" matches "XII", then fails on the required dot.
  rule("roman_month", () =>
    str("XII")
      .or(str("XI"))
      .or(str("X"))
      .or(str("IX"))
      .or(str("VIII"))
      .or(str("VII"))
      .or(str("VI"))
      .or(str("V"))
      .or(str("IV"))
      .or(str("III"))
      .or(str("II"))
      .or(str("I")),
  );

  rule("ob_roman_date", () =>
    str(" - ")
      .then(
        digit.repeat(2, 2).as("day"),
        dot,
        rules["roman_month"]!.as("roman_month"),
        dot,
        digit.repeat(4, 4).as("year"),
      ),
  );

  rule("ob_date", () => rules["date_part"]!.or(rules["ob_roman_date"]!));

  rule("ob_with_sector", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!.then(space).maybe(),
        rules["ob_series"]!,
        rules["ob_dot_body"]!.or(rules["ob_no_body"]!).or(rules["ob_bare_body"]!),
        rules["ob_date"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("ob_long_form", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!.then(space).maybe(),
        str("Operational Bulletin").as("_op_bull"),
        space,
        str("No."),
        space,
        rules["number"]!,
        rules["ob_date"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  rule("special_publication", () =>
    rules["ob_with_sector"]!.or(rules["ob_long_form"]!),
  );

  rule("annex_to_identifier", () =>
    str("Annex to").then(space, rules["special_publication"]!.as("annex_to")),
  );

  rule("handbook", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["number"]!,
        dot,
        str("HDB").as("handbook_marker"),
        rules["date_part"]!.maybe(),
      ),
  );

  rule("numeric_question", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["number"]!,
        rules["parts"]!,
        str("/"),
        digits.as("study_group"),
        str(":").as("question_colon").maybe(),
      ),
  );

  rule("question_tail", () =>
    rules["number"]!
      .then(
        str("/BL").as("has_bl").maybe(),
        str("/"),
        digits.as("study_group"),
      ),
  );

  rule("letter_question", () =>
    rules["itu_prefix"]!
      .then(
        rules["sector"]!,
        space,
        rules["series"]!,
        dot,
        str("[")
          .as("bracketed")
          .then(rules["question_tail"]!, str("]"))
          .or(rules["question_tail"]!),
        str(":").as("question_colon").maybe(),
      ),
  );

  rule("common_text_twin", () =>
    space
      .then(str("|"), space, match("[^|]").repeat(1, Infinity))
      .as("common_text_twin"),
  );

  // ITU's publication id — "T-REC-T.4-200307-I",
  // "R-REC-BO.1130-5-202602-I": <sector>-REC-<number>[-<edition>]-<YYYYMM>
  // [-<status>], the name ITU gives each edition in its URLs and PDF
  // files. It builds the plain Recommendation it names and renders in the
  // print form ("ITU-T T.4 (07/2003)"). The date is required: without it
  // the string names no edition. No other rule starts with a bare sector
  // letter, so the slot is free.
  rule("publication_id", () =>
    rules["sector"]!
      .then(
        dash,
        str("REC"),
        dash,
        rules["series"]!,
        dot,
        rules["code"]!,
        rules["yyyymm_date"]!,
        rules["id_status"]!.maybe(),
        rules["language"]!.maybe(),
      ),
  );

  // The Radio Regulations — "ITU-R RR", "ITU-R RR (2020)", and the URL
  // spelling "ITU-R RR-2020". Always ITU-R. The trailing any.absent? is
  // load-bearing: PEG ordered choice never re-enters the alternation once
  // an alternative succeeds, so a partial match on "ITU-R RR.1" must fail
  // here and fall through to with_series.
  rule("radio_regulations", () =>
    rules["itu_prefix"]!
      .then(
        str("R").as("sector"),
        space,
        str("RR").as("radio_regulations"),
        rules["date_part"]!.or(dash.then(digit.repeat(4, 4).as("year"))).maybe(),
        rules["language"]!.maybe(),
        match(".").absent(),
      ),
  );

  rule("identifier", () =>
    rules["annex_to_identifier"]!
      .or(
        rules["special_publication"]!,
        rules["supplement_identifier"]!,
        rules["annex_identifier"]!,
        rules["appendix_identifier"]!,
        rules["report_identifier"]!,
        rules["handbook"]!,
        rules["numeric_question"]!,
        rules["letter_question"]!,
        rules["radio_regulations"]!,
        rules["with_series"]!,
        rules["contribution"]!,
        rules["series_code_identifier"]!,
        rules["without_series"]!,
        rules["publication_id"]!,
      ),
  );

  rule("root", () =>
    rules["identifier"]!
      .then(rules["common_text_twin"]!)
      .or(rules["identifier"]!),
  );

  return rules;
}

/** ITU's listings carry doubled spaces; whitespace is never significant. */
export function normalizeWhitespaceItu(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export const ituGrammar: Grammar = { rules: buildRules(), root: "root" };
