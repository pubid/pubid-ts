import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/ashrae/parser.rb — 1:1. Root: identifier.
 *
 * Branch order matters (alternative retry semantics): errata,
 * interpretation (dead branch — never .as-wrapped, per the gem),
 * combined addenda, year-first addenda package, addenda package,
 * addendum, standalone copublisher, copublished with/without type,
 * plain ASHRAE.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };

  // "ANSI/ASHRAE" + up to 10 extra "/XXX" copublisher segments.
  const copublisherToken = () =>
    str("ANSI")
      .then(ref(rules, "slash"))
      .then(str("ASHRAE"))
      .then(
        ref(rules, "slash").then(ref(rules, "letter").repeat(3, 10)).repeat(0, 10),
      );

  rule("space", () => str(" "));
  rule("dash", () => str("-"));
  rule("dot", () => str("."));
  rule("slash", () => str("/"));
  rule("lparen", () => str("("));
  rule("rparen", () => str(")"));
  rule("comma", () => str(","));
  rule("colon", () => str(":"));
  rule("digit", () => match("[0-9]"));
  rule("digits", () => ref(rules, "digit").repeat(1, Infinity));
  rule("letter", () => match("[A-Za-z]"));

  rule("year_digits", () =>
    str("19").or(str("20")).then(ref(rules, "digit").repeat(2, 2)),
  );

  rule("reaffirmation_year", () =>
    ref(rules, "year_digits").or(ref(rules, "digit").repeat(2, 2)),
  );

  rule("publisher", () => str("ASHRAE"));

  rule("type", () => str("Guideline").or(str("Standard")));

  rule("code", () =>
    ref(rules, "digits")
      .then(ref(rules, "dot").then(ref(rules, "digits")).repeat(0, 2))
      .then(
        ref(rules, "letter")
          .then(ref(rules, "comma").then(ref(rules, "letter")).repeat(0, 10))
          .maybe(),
      )
      .as("code"),
  );

  rule("code_with_year", () =>
    ref(rules, "digits")
      .then(ref(rules, "dot").then(ref(rules, "digits")).repeat(0, 2))
      .then(
        ref(rules, "letter")
          .then(ref(rules, "comma").then(ref(rules, "letter")).repeat(0, 10))
          .maybe(),
      )
      .as("code")
      .then(ref(rules, "space").maybe().maybe())
      .then(ref(rules, "dash"))
      .then(ref(rules, "year_digits").as("year"))
      .as("code_with_year"),
  );

  rule("suffix", () => str("R").or(str("P")).as("suffix"));

  rule("additional_copublisher", () =>
    ref(rules, "slash")
      .then(
        ref(rules, "letter").repeat(4, 10)
          .then(ref(rules, "space"))
          .then(
            ref(rules, "digits")
              .then(ref(rules, "dash").then(ref(rules, "digits")).maybe())
              .maybe(),
          )
          .as("additional_copublisher"),
      )
      .or(
        ref(rules, "lparen")
          .then(
            str("ANSI")
              .then(ref(rules, "slash"))
              .then(
                ref(rules, "letter").repeat(2, 10)
                  .then(
                    ref(rules, "slash").then(ref(rules, "letter").repeat(2, 10)).repeat(0, 2),
                  ),
              )
              .as("additional_copublisher"),
          )
          .then(
            ref(rules, "space")
              .then(
                ref(rules, "digits")
                  .then(ref(rules, "dash").then(ref(rules, "digits")).maybe())
                  .maybe(),
              )
              .maybe(),
          )
          .then(ref(rules, "rparen")),
      ),
  );

  rule("optional_suffix", () =>
    ref(rules, "space").maybe()
      .then(ref(rules, "lparen"))
      .then(
        str("PDF").or(
          ref(rules, "letter").repeat(1, 20).then(
            ref(rules, "space")
              .or(ref(rules, "digit"))
              .or(ref(rules, "comma"))
              .or(ref(rules, "dash"))
              .or(ref(rules, "dot"))
              .or(ref(rules, "letter"))
              .or(str("–"))
              .repeat(0, 500),
          ),
        ),
      )
      .then(ref(rules, "rparen")),
  );

  rule("reaffirmed", () =>
    ref(rules, "space").maybe()
      .then(ref(rules, "lparen"))
      .then(str("RA"))
      .then(ref(rules, "space").maybe())
      .then(ref(rules, "reaffirmation_year").as("reaffirmed"))
      .then(ref(rules, "rparen"))
      .or(
        ref(rules, "space").maybe()
          .then(ref(rules, "lparen"))
          .then(str("RA"))
          .then(ref(rules, "dash"))
          .then(ref(rules, "reaffirmation_year").as("reaffirmed"))
          .then(ref(rules, "rparen")),
      )
      .or(
        ref(rules, "space")
          .then(str("RA"))
          .then(ref(rules, "space"))
          .then(ref(rules, "reaffirmation_year").as("reaffirmed")),
      )
      .or(
        ref(rules, "space")
          .then(str("RA"))
          .then(ref(rules, "dash"))
          .then(ref(rules, "reaffirmation_year").as("reaffirmed")),
      ),
  );

  rule("addendum_code", () =>
    ref(rules, "digits").maybe()
      .then(ref(rules, "letter").repeat(1, 3))
      .as("addendum_code"),
  );

  rule("month_name", () =>
    str("January").or(str("February")).or(str("March")).or(str("April"))
      .or(str("May")).or(str("June")).or(str("July")).or(str("August"))
      .or(str("September")).or(str("October")).or(str("November"))
      .or(str("December")),
  );

  rule("errata_date", () =>
    ref(rules, "space").maybe()
      .then(ref(rules, "lparen"))
      .then(ref(rules, "month_name").as("month"))
      .then(ref(rules, "space"))
      .then(ref(rules, "digit").repeat(1, 2).as("day"))
      .then(ref(rules, "comma").maybe())
      .then(ref(rules, "space").or(ref(rules, "comma").maybe()))
      .then(ref(rules, "year_digits").as("errata_year"))
      .then(ref(rules, "rparen"))
      .as("errata_date")
      .or(
        ref(rules, "space").maybe()
          .then(ref(rules, "lparen"))
          .then(ref(rules, "month_name").as("month"))
          .then(ref(rules, "space"))
          .then(ref(rules, "digit").repeat(1, 2).as("day"))
          .then(ref(rules, "rparen"))
          .as("errata_date"),
      )
      .or(
        ref(rules, "space").maybe()
          .then(ref(rules, "lparen"))
          .then(
            ref(rules, "digit").repeat(1, 2)
              .then(ref(rules, "dash"))
              .then(ref(rules, "digit").repeat(1, 2))
              .then(ref(rules, "dash"))
              .then(ref(rules, "space").maybe())
              .then(ref(rules, "year_digits"))
              .as("numeric_date"),
          )
          .then(ref(rules, "rparen"))
          .as("errata_date"),
      ),
  );

  rule("errata_suffix", () =>
    ref(rules, "space")
      .then(ref(rules, "dash").or(str("–")))
      .then(ref(rules, "space"))
      .then(
        ref(rules, "letter").then(
          ref(rules, "space")
            .or(ref(rules, "letter"))
            .or(ref(rules, "digit"))
            .or(ref(rules, "comma"))
            .repeat(0, 50),
        ),
      )
      .repeat(0, 3),
  );

  rule("errata_date_and_suffix", () =>
    ref(rules, "errata_suffix").then(ref(rules, "errata_date"))
      .or(ref(rules, "errata_date").then(ref(rules, "errata_suffix")))
      .or(ref(rules, "errata_date"))
      .or(ref(rules, "errata_suffix")),
  );

  rule("errata_suffix_on_addendum", () =>
    ref(rules, "space")
      .then(str("Errata").as("errata_keyword"))
      .then(
        ref(rules, "space")
          .then(ref(rules, "lparen"))
          .then(ref(rules, "month_name"))
          .then(ref(rules, "space"))
          .then(ref(rules, "digit").repeat(1, 2))
          .then(ref(rules, "comma").maybe())
          .then(ref(rules, "space").or(ref(rules, "comma").maybe()))
          .then(ref(rules, "year_digits"))
          .then(ref(rules, "rparen"))
          .or(
            ref(rules, "space")
              .then(ref(rules, "lparen"))
              .then(ref(rules, "month_name"))
              .then(ref(rules, "space"))
              .then(ref(rules, "digit").repeat(1, 2))
              .then(ref(rules, "rparen")),
          )
          .or(
            ref(rules, "space")
              .then(ref(rules, "lparen"))
              .then(ref(rules, "digit").repeat(1, 2))
              .then(ref(rules, "dash"))
              .then(ref(rules, "digit").repeat(1, 2))
              .then(ref(rules, "dash"))
              .then(ref(rules, "space").maybe())
              .then(ref(rules, "year_digits"))
              .then(ref(rules, "rparen")),
          )
          .or(str("")),
      ),
  );

  // The errata rule allows "ANSI-ASHRAE" (dash) as well as the slash
  // forms.
  const errataCopublisher = () =>
    str("ANSI").then(ref(rules, "dash")).then(str("ASHRAE"))
      .or(copublisherToken());

  const errataBaseWithType = () =>
    errataCopublisher().as("copublisher")
      .then(ref(rules, "space"))
      .then(ref(rules, "type").as("type"))
      .then(ref(rules, "space"))
      .then(ref(rules, "code"))
      .then(
        ref(rules, "space").maybe().maybe()
          .then(ref(rules, "dash"))
          .then(ref(rules, "year_digits").as("year"))
          .maybe(),
      )
      .then(ref(rules, "space").then(ref(rules, "additional_copublisher")).maybe())
      .then(ref(rules, "suffix").maybe())
      .then(ref(rules, "reaffirmed").maybe());

  const errataTail = () =>
    ref(rules, "space")
      .then(str("Errata").as("errata_keyword"))
      .then(ref(rules, "errata_date_and_suffix").maybe())
      .then(ref(rules, "optional_suffix").repeat(0, 2).as("optional_suffixes"));

  rule("errata_identifier", () =>
    errataBaseWithType().as("base")
      .then(errataTail())
      .or(
        errataCopublisher().as("copublisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "code_with_year"))
          .then(ref(rules, "space").then(ref(rules, "additional_copublisher")).maybe())
          .then(ref(rules, "suffix").maybe())
          .then(ref(rules, "reaffirmed").maybe())
          .as("base")
          .then(errataTail()),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(
            ref(rules, "space").maybe().maybe()
              .then(ref(rules, "dash"))
              .then(ref(rules, "year_digits").as("year"))
              .maybe(),
          )
          .then(ref(rules, "space").then(ref(rules, "additional_copublisher")).maybe())
          .then(ref(rules, "suffix").maybe())
          .then(ref(rules, "reaffirmed").maybe())
          .as("base")
          .then(errataTail()),
      ),
  );

  rule("interpretation_identifier", () =>
    str("Interpretations")
      .then(ref(rules, "space"))
      .then(str("for"))
      .then(ref(rules, "space"))
      .then(
        ref(rules, "type").as("type")
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(
            ref(rules, "dash").then(ref(rules, "year_digits").as("year")).maybe(),
          )
          .as("base"),
      ),
  );

  const addendaCodeList = (maxExtra: number, maxRepeat: number) =>
    ref(rules, "comma").then(ref(rules, "space")).then(str("and")).then(ref(rules, "space"))
      .then(ref(rules, "addendum_code"))
      .or(
        ref(rules, "space").then(str("and")).then(ref(rules, "space"))
          .then(ref(rules, "addendum_code")),
      )
      .or(
        ref(rules, "comma").then(ref(rules, "space"))
          .then(ref(rules, "addendum_code")).repeat(1, maxExtra),
      )
      .or(
        ref(rules, "comma").then(ref(rules, "addendum_code")).repeat(1, maxExtra),
      )
      .repeat(0, maxRepeat);

  const toFor = () => str("to").or(str("for")).then(ref(rules, "space"));

  const optionalCopublisherSpace = () =>
    copublisherToken().as("copublisher")
      .then(ref(rules, "space"))
      .maybe();

  const codeYearMaybe = () =>
    ref(rules, "dash").then(ref(rules, "year_digits").as("year")).maybe();

  rule("combined_addenda_identifier", () =>
    ref(rules, "publisher").as("publisher")
      .then(ref(rules, "space"))
      .then(str("Addenda"))
      .then(ref(rules, "space"))
      .then(ref(rules, "addendum_code"))
      .then(addendaCodeList(20, 50).as("additional_codes"))
      .then(ref(rules, "space"))
      .then(toFor())
      .then(optionalCopublisherSpace())
      .then(ref(rules, "type").as("type"))
      .then(ref(rules, "space"))
      .then(ref(rules, "code"))
      .then(codeYearMaybe())
      .then(ref(rules, "space").then(ref(rules, "additional_copublisher")).maybe())
      .then(ref(rules, "addendum_date_suffix").maybe())
      .then(ref(rules, "optional_suffix").repeat(0, 2))
      .as("combined_addenda")
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(
            ref(rules, "dash")
              .then(ref(rules, "year_digits").as("year")),
          )
          .then(ref(rules, "colon").then(ref(rules, "space")).or(ref(rules, "space")))
          .then(str("Addenda"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(
            ref(rules, "comma").then(ref(rules, "space"))
              .then(ref(rules, "addendum_code")).repeat(1, 50)
              .or(
                ref(rules, "comma").then(ref(rules, "addendum_code")).repeat(1, 50),
              )
              .as("additional_codes")
              .maybe(),
          )
          .then(ref(rules, "optional_suffix").repeat(0, 2))
          .as("combined_addenda"),
      )
      .or(
        str("Addenda")
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(addendaCodeList(20, 50).as("additional_codes"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(optionalCopublisherSpace())
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(ref(rules, "optional_suffix").repeat(0, 2))
          .as("combined_addenda"),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(str("Addenda"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(ref(rules, "optional_suffix").repeat(0, 2))
          .as("combined_addenda"),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(str("Addenda"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(addendaCodeList(20, 50).as("additional_codes"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(ref(rules, "code_with_year"))
          .then(ref(rules, "optional_suffix").repeat(0, 2))
          .as("combined_addenda"),
      )
      .or(
        str("Addenda")
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(addendaCodeList(20, 50).as("additional_codes"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(ref(rules, "code_with_year"))
          .then(ref(rules, "optional_suffix").repeat(0, 2))
          .as("combined_addenda"),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(ref(rules, "colon").then(ref(rules, "space")).or(ref(rules, "space")))
          .then(str("Addenda"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(
            ref(rules, "space").then(str("through")).then(ref(rules, "space"))
              .then(ref(rules, "addendum_code"))
              .or(
                ref(rules, "space")
                  .or(ref(rules, "comma").then(ref(rules, "space")))
                  .then(ref(rules, "addendum_code")).repeat(1, 50),
              )
              .or(
                ref(rules, "comma").then(ref(rules, "space"))
                  .then(ref(rules, "addendum_code")).repeat(1, 50),
              )
              .or(
                ref(rules, "comma").then(ref(rules, "addendum_code")).repeat(1, 50),
              )
              .as("additional_codes")
              .maybe(),
          )
          .then(ref(rules, "space").then(ref(rules, "additional_copublisher")).maybe())
          .then(ref(rules, "addendum_date_suffix").maybe())
          .then(ref(rules, "optional_suffix").repeat(0, 2))
          .as("combined_addenda"),
      ),
  );

  rule("year_first_addenda_package_identifier", () =>
    ref(rules, "year_digits").as("package_year")
      .then(ref(rules, "space"))
      .then(
        str("Addenda")
          .then(ref(rules, "space"))
          .then(str("Supplement"))
          .then(ref(rules, "space").then(str("Package")).maybe())
          .then(ref(rules, "space"))
          .then(str("to"))
          .then(ref(rules, "space"))
          .then(optionalCopublisherSpace())
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .or(
            str("Supplement")
              .then(ref(rules, "space"))
              .then(str("Addenda"))
              .then(ref(rules, "space"))
              .then(ref(rules, "addendum_code"))
              .then(
                ref(rules, "comma").then(ref(rules, "space"))
                  .then(ref(rules, "addendum_code")).repeat(1, 50)
                  .or(
                    ref(rules, "comma").then(ref(rules, "addendum_code")).repeat(1, 50),
                  )
                  .as("additional_codes")
                  .maybe(),
              )
              .then(ref(rules, "space"))
              .then(str("to"))
              .then(ref(rules, "space"))
              .then(optionalCopublisherSpace())
              .then(ref(rules, "type").as("type"))
              .then(ref(rules, "space"))
              .then(ref(rules, "code"))
              .then(codeYearMaybe()),
          )
          .or(
            str("Addenda")
              .then(ref(rules, "space"))
              .then(str("Supplement"))
              .then(ref(rules, "space"))
              .then(str("to"))
              .then(ref(rules, "space"))
              .then(optionalCopublisherSpace())
              .then(ref(rules, "type").as("type"))
              .then(ref(rules, "space"))
              .then(ref(rules, "code"))
              .then(codeYearMaybe()),
          )
          .or(
            str("Supplement")
              .then(ref(rules, "space"))
              .then(str("to"))
              .then(ref(rules, "space"))
              .then(optionalCopublisherSpace())
              .then(ref(rules, "type").as("type"))
              .then(ref(rules, "space"))
              .then(ref(rules, "code"))
              .then(codeYearMaybe())
              .then(ref(rules, "errata_suffix_on_addendum").maybe()),
          ),
      )
      .then(ref(rules, "optional_suffix").repeat(0, 2))
      .as("addenda_package"),
  );

  const packageDescription = () =>
    str("Supplement")
      .then(ref(rules, "space").then(str("Package")).maybe())
      .or(str("Package"))
      .as("package_description");

  const colonOrSpace = () =>
    ref(rules, "colon").then(ref(rules, "space")).or(ref(rules, "space"));

  rule("addenda_package_identifier", () =>
    copublisherToken().as("copublisher")
      .then(ref(rules, "space"))
      .then(ref(rules, "type").as("type"))
      .then(ref(rules, "space"))
      .then(ref(rules, "code"))
      .then(codeYearMaybe())
      .then(colonOrSpace())
      .then(str("Addenda"))
      .then(ref(rules, "space"))
      .then(packageDescription())
      .then(
        ref(rules, "space").then(str("for")).then(ref(rules, "space"))
          .then(ref(rules, "year_digits").as("target_year"))
          .maybe(),
      )
      .then(ref(rules, "optional_suffix").repeat(0, 3))
      .as("addenda_package")
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(ref(rules, "comma"))
          .then(ref(rules, "space"))
          .then(str("Addenda"))
          .then(ref(rules, "space"))
          .then(ref(rules, "year_digits").as("package_year"))
          .then(ref(rules, "space"))
          .then(str("Supplement"))
          .then(ref(rules, "colon"))
          .then(ref(rules, "space"))
          .then(str("Addenda"))
          .then(ref(rules, "space"))
          .then(packageDescription())
          .then(ref(rules, "optional_suffix").repeat(0, 3))
          .as("addenda_package"),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(
            ref(rules, "space").then(ref(rules, "year_digits").as("package_year")).maybe(),
          )
          .then(ref(rules, "additional_copublisher").maybe())
          .then(ref(rules, "suffix").maybe())
          .then(ref(rules, "reaffirmed").maybe())
          .then(colonOrSpace())
          .then(str("Addenda"))
          .then(ref(rules, "space"))
          .then(packageDescription())
          .then(
            ref(rules, "space").then(str("for")).then(ref(rules, "space"))
              .then(ref(rules, "year_digits").as("target_year"))
              .maybe(),
          )
          .then(ref(rules, "optional_suffix").repeat(0, 3))
          .as("addenda_package"),
      ),
  );

  rule("addendum_date_suffix", () =>
    ref(rules, "space")
      .then(ref(rules, "lparen"))
      .then(ref(rules, "month_name"))
      .then(ref(rules, "space"))
      .then(ref(rules, "digit").repeat(1, 2))
      .then(ref(rules, "comma").maybe())
      .then(ref(rules, "space").or(ref(rules, "comma").maybe()))
      .then(ref(rules, "year_digits"))
      .then(ref(rules, "rparen")),
  );

  const addendumTail = () =>
    ref(rules, "additional_copublisher").maybe()
      .then(ref(rules, "addendum_date_suffix").maybe())
      .then(ref(rules, "errata_suffix_on_addendum").maybe())
      .then(ref(rules, "optional_suffix").repeat(0, 2));

  rule("addendum_identifier", () =>
    ref(rules, "publisher").as("publisher")
      .then(ref(rules, "space"))
      .then(str("Addendum"))
      .then(ref(rules, "space"))
      .then(ref(rules, "addendum_code"))
      .then(ref(rules, "space"))
      .then(toFor())
      .then(ref(rules, "type").as("type"))
      .then(ref(rules, "space"))
      .then(ref(rules, "code"))
      .then(codeYearMaybe())
      .then(addendumTail())
      .as("publisher_addendum")
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(str("Addendum"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(ref(rules, "publisher").as("base_publisher"))
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(addendumTail())
          .as("publisher_base_addendum"),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(str("Addendum"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(copublisherToken().as("copublisher"))
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(
            ref(rules, "addendum_date_suffix").maybe()
              .then(ref(rules, "errata_suffix_on_addendum").maybe())
              .then(ref(rules, "optional_suffix").repeat(0, 2)),
          )
          .as("publisher_addendum_copublisher"),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(str("Addendum"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(copublisherToken().as("copublisher"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code_with_year"))
          .then(addendumTail())
          .as("publisher_addendum_copublisher_no_type"),
      )
      .or(
        copublisherToken().as("copublisher")
          .then(ref(rules, "space"))
          .maybe()
          .then(str("Addendum"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(copublisherToken().as("copublisher").then(ref(rules, "space")).maybe())
          .then(ref(rules, "code_with_year"))
          .then(addendumTail())
          .as("addendum_no_type"),
      )
      .or(
        // [ANSI/ASHRAE[/ASHE|/IES]] Addendum X to ASHRAE Standard/Guideline
        // N-YYYY: leading copublisher + publisher-led base.
        copublisherToken().as("copublisher")
          .then(ref(rules, "space"))
          .maybe()
          .then(str("Addendum"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(ref(rules, "publisher").as("base_publisher"))
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(addendumTail())
          .as("publisher_base_addendum"),
      )
      .or(
        copublisherToken().as("copublisher")
          .then(ref(rules, "space"))
          .maybe()
          .then(str("Addendum"))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(ref(rules, "space"))
          .then(toFor())
          .then(copublisherToken().as("copublisher").then(ref(rules, "space")).maybe())
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(codeYearMaybe())
          .then(addendumTail())
          .as("addendum"),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(
            ref(rules, "space").maybe().maybe()
              .then(ref(rules, "dash"))
              .then(ref(rules, "year_digits").as("year"))
              .maybe(),
          )
          .then(ref(rules, "additional_copublisher").maybe())
          .then(ref(rules, "suffix").maybe())
          .then(ref(rules, "reaffirmed").maybe())
          .then(colonOrSpace())
          .then(str("Addendum").or(str("addendum")))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(
            ref(rules, "addendum_date_suffix").maybe()
              .then(ref(rules, "errata_suffix_on_addendum").maybe())
              .then(ref(rules, "optional_suffix").repeat(0, 2)),
          )
          .as("standard_addendum"),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type"))
          .then(ref(rules, "space"))
          .then(ref(rules, "code"))
          .then(
            ref(rules, "space").maybe().maybe()
              .then(ref(rules, "dash"))
              .then(ref(rules, "year_digits").as("year"))
              .maybe(),
          )
          .then(ref(rules, "additional_copublisher").maybe())
          .then(ref(rules, "suffix").maybe())
          .then(ref(rules, "reaffirmed").maybe())
          .then(ref(rules, "space"))
          .then(str("Addendum").or(str("addendum")))
          .then(ref(rules, "space"))
          .then(ref(rules, "addendum_code"))
          .then(
            ref(rules, "addendum_date_suffix").maybe()
              .then(ref(rules, "errata_suffix_on_addendum").maybe())
              .then(ref(rules, "optional_suffix").repeat(0, 2)),
          )
          .as("standard_addendum"),
      ),
  );

  rule("identifier", () =>
    ref(rules, "errata_identifier")
      .or(ref(rules, "interpretation_identifier").as("interpretation_identifier"))
      .or(ref(rules, "combined_addenda_identifier"))
      .or(ref(rules, "year_first_addenda_package_identifier"))
      .or(ref(rules, "addenda_package_identifier"))
      .or(ref(rules, "addendum_identifier"))
      .or(
        str("ANSI").then(ref(rules, "slash")).maybe()
          .then(str("ASHRAE").absent().then(ref(rules, "letter")).repeat(2, 10))
          .as("copublisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "code_with_year"))
          .then(ref(rules, "optional_suffix").repeat(0, 2)),
      )
      .or(
        errataCopublisher().as("copublisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "code_with_year"))
          .then(ref(rules, "space").then(ref(rules, "additional_copublisher")).maybe())
          .then(ref(rules, "suffix").maybe())
          .then(ref(rules, "reaffirmed").maybe())
          .then(ref(rules, "optional_suffix").repeat(0, 2)),
      )
      .or(
        copublisherToken().as("copublisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type").maybe())
          .then(ref(rules, "space").maybe())
          .then(ref(rules, "code"))
          .then(
            ref(rules, "space").maybe().maybe()
              .then(ref(rules, "dash"))
              .then(ref(rules, "year_digits").as("year"))
              .maybe(),
          )
          .then(ref(rules, "space").then(ref(rules, "additional_copublisher")).maybe())
          .then(ref(rules, "suffix").maybe())
          .then(ref(rules, "reaffirmed").maybe())
          .then(ref(rules, "optional_suffix").repeat(0, 2)),
      )
      .or(
        ref(rules, "publisher").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "type").as("type").then(ref(rules, "space")).maybe())
          .then(ref(rules, "code"))
          .then(
            ref(rules, "space").maybe().maybe()
              .then(ref(rules, "dash"))
              .then(ref(rules, "year_digits").as("year"))
              .maybe(),
          )
          .then(ref(rules, "space").then(ref(rules, "additional_copublisher")).maybe())
          .then(ref(rules, "suffix").maybe())
          .then(ref(rules, "reaffirmed").maybe())
          .then(ref(rules, "optional_suffix").repeat(0, 2))
          .as("base"),
      ),
  );

  return rules;
}

export const ashraeGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};
