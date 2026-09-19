import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/csa/parser.rb — 1:1. Root: identifier.
 *
 * Branch order: ISO/IEC adoption, series, CEC, bundled (+), combined
 * slash, combined comma, single, code-only.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };

  rule("space", () => str(" "));
  rule("dash", () => str("-"));
  rule("slash", () => str("/"));
  rule("colon", () => str(":"));
  rule("comma", () => str(","));
  rule("dot", () => str("."));
  rule("ampersand", () => str("&"));
  rule("plus", () => str(" + "));
  rule("digit", () => match("[0-9]"));
  rule("digits", () => ref(rules, "digit").repeat(1, Infinity));
  rule("letter", () => match("[A-Z]"));
  rule("letters", () => ref(rules, "letter").repeat(1, Infinity));

  rule("publisher", () =>
    str("CSA").then(ref(rules, "space"))
      .then(str("").as("has_publisher").or(str("0").as("has_publisher"))),
  );

  rule("code_pattern", () =>
    // Pattern 1: pure dotted numbers (12.4, 2.15) + optional single
    // dash-part + optional letter suffix.
    match("[0-9]").repeat(1, Infinity)
      .then(ref(rules, "dot"))
      .then(match("[0-9]").repeat(1, Infinity))
      .then((ref(rules, "dash").then(match("[0-9]").repeat(1, Infinity))).repeat(0, 1))
      .then(ref(rules, "letter").repeat(2, 6).maybe())
      .as("code")
      .or(
        // Pattern 2: pure numbers with HB-style suffix (15189HB)
        match("[0-9]").repeat(1, Infinity)
          .then(ref(rules, "letter").repeat(2, 6))
          .as("code"),
      )
      .or(
        // Pattern 3: letter + numbers with dots then dashes
        ref(rules, "letter")
          .then(match("[0-9]").repeat(1, Infinity))
          .then((ref(rules, "dot").then(match("[0-9]").repeat(1, Infinity))).repeat(0, Infinity))
          .then(
            (ref(rules, "dash").then(
              match("[0-9]").then(match("[0-9]").absent())
                .or(match("[0-9]").repeat(3, Infinity))
                .or(match("[0-9]").repeat(1, Infinity).then(ref(rules, "letter").repeat(1, 1))),
            )).repeat(0, Infinity),
          )
          .then(ref(rules, "letter").repeat(2, 6).maybe())
          .as("code"),
      )
      .or(
        // Pattern 4: letter + number + dot + optional number
        ref(rules, "letter")
          .then(match("[0-9]").repeat(1, Infinity))
          .then(ref(rules, "dot"))
          .then(match("[0-9]").repeat(1, Infinity).maybe())
          .as("code"),
      )
      .or(
        // Pattern 5: letter + multi-digit number (Z240, A220)
        ref(rules, "letter")
          .then(match("[0-9]").repeat(2, Infinity))
          .as("code"),
      ),
  );

  rule("no_notation", () =>
    ref(rules, "space")
      .then(str("NO.").or(str("No.")).as("no_notation"))
      .then(ref(rules, "space")),
  );

  rule("no_number", () =>
    (
      match("[0-9]").repeat(1, Infinity)
        .then((ref(rules, "dash").then(match("[0-9]").repeat(1, Infinity))).repeat(2, 10))
        .or(match("[0-9]").repeat(5, Infinity).then(ref(rules, "dash")).then(match("[0-9]").repeat(1, Infinity)))
        .or(
          match("[0-9]").repeat(3, 4)
            .then(ref(rules, "dash"))
            .then(
              match("[0-9]").then(match("[0-9]").absent())
                .or(match("[0-9]").repeat(3, Infinity)),
            ),
        )
        .or(
          match("[0-9]").repeat(1, Infinity)
            .then((ref(rules, "dot").then(match("[0-9]").repeat(1, Infinity))).repeat(1, 3)),
        )
        .or(match("[0-9]").repeat(1, Infinity))
    ).as("no_number"),
  );

  rule("year_prefix", () => str("F").or(str("M")).as("year_prefix").maybe());
  rule("year_2digit", () => ref(rules, "digit").repeat(2, 2));
  rule("year_4digit", () => ref(rules, "digit").repeat(4, 4));

  const yearBody = () =>
    ref(rules, "year_prefix")
      .then(ref(rules, "year_4digit").or(ref(rules, "year_2digit")).as("year"))
      .or(ref(rules, "year_4digit").or(ref(rules, "year_2digit")).as("year"));

  rule("colon_year", () =>
    str("").as("colon_format")
      .then(ref(rules, "colon"))
      .then(yearBody()),
  );

  rule("dash_year", () =>
    str("").as("dash_format")
      .then(ref(rules, "dash"))
      .then(yearBody()),
  );

  rule("reaffirmation", () =>
    ref(rules, "space")
      .then(str("(R"))
      .then(
        ref(rules, "year_4digit").as("reaffirmation_4digit")
          .or(ref(rules, "year_2digit").as("reaffirmation_2digit")),
      )
      .then(str(")")),
  );

  rule("amendment_slash", () =>
    ref(rules, "slash")
      .then((str("Amd").then(ref(rules, "space"))).maybe())
      .then(str("A").maybe())
      .then(ref(rules, "digits").as("amendment_number"))
      .then(
        (ref(rules, "colon").then(ref(rules, "year_2digit").as("amendment_year"))).maybe(),
      ),
  );

  rule("package_keyword", () =>
    str("Code").or(str("Handbook")).or(str("Training Package")).or(str("Package")),
  );

  rule("package_portion", () =>
    ref(rules, "space")
      .then(ref(rules, "package_keyword"))
      .then(
        (
          ref(rules, "comma").then(ref(rules, "space")).then(ref(rules, "package_keyword"))
            .or(
              ref(rules, "space").then(ref(rules, "ampersand")).then(ref(rules, "space"))
                .then(ref(rules, "package_keyword")),
            )
        ).repeat(0, Infinity),
      ),
  );

  rule("series_prefix", () => ref(rules, "letter").repeat(2, 3).as("series_prefix"));

  rule("series_keyword", () => str("SERIES"));

  rule("series_identifier", () =>
    ref(rules, "publisher")
      .then(
        ref(rules, "code_pattern")
          .or(
            ref(rules, "letter").then(match("[0-9]").repeat(2, Infinity)).as("code"),
          )
          .or(
            match("[0-9]").repeat(1, Infinity).then(ref(rules, "dot"))
              .then(match("[0-9]").repeat(1, Infinity)).as("code"),
          ),
      )
      .then(ref(rules, "space"))
      .then((ref(rules, "series_prefix").then(ref(rules, "space"))).maybe())
      .then(ref(rules, "series_keyword").as("series_type"))
      .then(ref(rules, "colon_year").or(ref(rules, "dash_year")).maybe())
      .then(ref(rules, "reaffirmation").maybe()),
  );

  rule("cec_identifier", () =>
    ref(rules, "publisher")
      .then(
        str("C22.2").or(str("C22.3")).or(str("C22.4")).or(str("C22.6")).as("cec_part"),
      )
      .then(ref(rules, "no_notation"))
      .then(ref(rules, "no_number"))
      .then(ref(rules, "colon_year").or(ref(rules, "dash_year")).maybe())
      .then(ref(rules, "reaffirmation").maybe()),
  );

  const adoptionNumber = () =>
    str("ISO/IEC").as("adoption_org")
      .then(ref(rules, "space"))
      .then(str("TR").or(str("TS")).as("iso_type"))
      .then(ref(rules, "space"))
      .then(match("[0-9-]").repeat(1, Infinity).as("adoption_number"))
      .or(
        str("ISO/IEC").as("adoption_org_with_type")
          .then(ref(rules, "space"))
          .then(match("[0-9-]").repeat(1, Infinity).as("adoption_number")),
      )
      .or(
        str("ISO").as("adoption_org")
          .then(ref(rules, "space"))
          .then(match("[0-9-]").repeat(1, Infinity).as("adoption_number")),
      )
      .or(
        str("IEC").as("adoption_org")
          .then(ref(rules, "space"))
          .then(match("[0-9-]").repeat(1, Infinity).as("adoption_number")),
      )
      .or(
        str("CEI/IEC").as("adoption_org")
          .then(ref(rules, "space"))
          .then(match("[0-9-]").repeat(1, Infinity).as("adoption_number")),
      )
      .or(
        str("CISPR").as("adoption_org")
          .then(ref(rules, "space"))
          .then(match("[0-9-]").repeat(1, Infinity).as("adoption_number")),
      );

  rule("adoption_identifier", () =>
    ref(rules, "publisher").as("adoption_pub")
      .then(adoptionNumber())
      .then(ref(rules, "colon").or(ref(rules, "dash")).as("adoption_year_sep"))
      .then(ref(rules, "year_4digit").or(ref(rules, "year_2digit")).as("adoption_year"))
      .then(
        (
          ref(rules, "slash").then(str("A")).then(ref(rules, "digit").as("adoption_amendment"))
            .then(ref(rules, "colon").or(ref(rules, "dash")))
            .then(ref(rules, "year_4digit").or(ref(rules, "year_2digit")).as("adoption_amendment_year"))
        ).maybe(),
      )
      .then(ref(rules, "reaffirmation").maybe()),
  );

  rule("iso_iec_adoption", () => ref(rules, "adoption_identifier"));

  const codeTail = () =>
    (
      ref(rules, "no_notation").then(ref(rules, "no_number"))
        .then(ref(rules, "colon_year").or(ref(rules, "dash_year")))
        .or(
          ref(rules, "space").then(ref(rules, "series_prefix")).then(ref(rules, "space"))
            .then(ref(rules, "series_keyword").as("series"))
            .then(ref(rules, "colon_year").or(ref(rules, "dash_year"))),
        )
        .or(
          ref(rules, "space").then(ref(rules, "series_keyword").as("series"))
            .then(ref(rules, "colon_year").or(ref(rules, "dash_year"))),
        )
        .or(ref(rules, "colon_year").or(ref(rules, "dash_year")))
    ).maybe();

  rule("csa_code", () =>
    ref(rules, "publisher")
      .then(ref(rules, "code_pattern"))
      .then(codeTail())
      .then(ref(rules, "amendment_slash").maybe()),
  );

  rule("base_csa_code", () =>
    ref(rules, "publisher")
      .then(ref(rules, "code_pattern"))
      .then(codeTail()),
  );

  rule("continuation_code", () =>
    ref(rules, "publisher").as("has_publisher").maybe()
      .then(ref(rules, "code_pattern"))
      .then(codeTail())
      .then(ref(rules, "amendment_slash").maybe()),
  );

  rule("bundled_portion", () =>
    ref(rules, "code_pattern")
      .then(
        (
          ref(rules, "no_notation").then(ref(rules, "no_number"))
            .then(ref(rules, "colon_year").or(ref(rules, "dash_year")).maybe())
            .or(ref(rules, "colon_year").or(ref(rules, "dash_year")).maybe())
        ),
      ),
  );

  rule("bundled_identifier", () =>
    ref(rules, "csa_code").as("base")
      .then(ref(rules, "plus"))
      .then(ref(rules, "bundled_portion").as("bundled_first"))
      .then(
        (ref(rules, "plus").then(ref(rules, "bundled_portion"))).repeat(0, Infinity).as("bundled_rest"),
      )
      .then(ref(rules, "reaffirmation").maybe()),
  );

  rule("combined_slash", () =>
    ref(rules, "base_csa_code").as("first")
      .then(ref(rules, "slash"))
      .then(ref(rules, "continuation_code").as("second"))
      .then(
        (ref(rules, "slash").then(ref(rules, "continuation_code").as("third"))).maybe(),
      )
      .then(ref(rules, "reaffirmation").maybe())
      .then(ref(rules, "package_portion").maybe()),
  );

  rule("combined_comma", () =>
    ref(rules, "csa_code").as("first")
      .then(ref(rules, "comma"))
      .then(ref(rules, "space"))
      .then(ref(rules, "csa_code").as("second"))
      .then(ref(rules, "reaffirmation").maybe())
      .then(
        (
          ref(rules, "space").then(ref(rules, "ampersand")).then(ref(rules, "package_portion"))
            .or(ref(rules, "package_portion"))
        ).as("package_portion").maybe(),
      )
      .then(str("").as("comma_separator")),
  );

  rule("single_identifier", () =>
    ref(rules, "csa_code")
      .then(ref(rules, "reaffirmation").maybe())
      .then(ref(rules, "package_portion").as("package_portion").maybe()),
  );

  rule("code_only_identifier", () =>
    ref(rules, "code_pattern")
      .then(
        (
          ref(rules, "space").then(ref(rules, "series_prefix")).then(ref(rules, "space"))
            .then(ref(rules, "series_keyword").as("series"))
            .then(ref(rules, "colon_year").or(ref(rules, "dash_year")))
            .or(
              ref(rules, "space").then(ref(rules, "series_keyword").as("series"))
                .then(ref(rules, "colon_year").or(ref(rules, "dash_year"))),
            )
            .or(ref(rules, "colon_year").or(ref(rules, "dash_year")))
        ).maybe(),
      )
      .then(
        (ref(rules, "space").then(str("PACKAGE"))).as("package_portion").maybe(),
      ),
  );

  rule("identifier", () =>
    ref(rules, "iso_iec_adoption")
      .or(ref(rules, "series_identifier"))
      .or(ref(rules, "cec_identifier"))
      .or(ref(rules, "bundled_identifier"))
      .or(ref(rules, "combined_slash"))
      .or(ref(rules, "combined_comma"))
      .or(ref(rules, "single_identifier"))
      .or(ref(rules, "code_only_identifier")),
  );

  return rules;
}

export const csaGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};

/** Parser#parse normalization (parser.rb): CONSOLIDATED, (R spacing, CEI. */
export function normalizeCsa(input: string): string {
  let normalized = input.replaceAll(/\s*\(\s*CONSOLIDATED\s*\)\s*/g, " ");
  normalized = normalized.replaceAll(/\s*\bCONSOLIDATED\b\s*/g, " ");
  normalized = normalized.replaceAll(/(\S)\(R(\d{2,4})\)/g, "$1 (R$2)");
  normalized = normalized.replaceAll("CEI/IEC", "IEC");
  normalized = normalized.replaceAll(/\bCEI\b/g, "IEC");
  normalized = normalized.replaceAll("CAN/CSA-", "CSA ");
  normalized = normalized.replaceAll("CAN3-", "CSA ");
  normalized = normalized.replaceAll(/\s+/g, " ").trim();
  return normalized;
}

/** The original publisher prefix the normalized input printed. */
export function csaPublisherPrefix(normalized: string): string | undefined {
  if (normalized.startsWith("CAN/CSA-")) return "CAN/CSA-";
  if (normalized.startsWith("CAN3-")) return "CAN3-";
  if (normalized.startsWith("CSA ")) return "CSA";
  return undefined;
}
