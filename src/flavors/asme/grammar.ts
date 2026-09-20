import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/asme/parser.rb — 1:1. Root: identifier.
 *
 * Branch order: CSA/ASME, API/ASME, ISO/ASME, ASME/ANS, standard.
 */

const alt = (tokens: string[]): P =>
  tokens.map((t) => str(t)).reduce((a, b) => a.or(b));

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };

  rule("space", () => str(" "));
  rule("dash", () => str("-").or(str("–")).or(str("—")));
  rule("slash", () => str("/"));
  rule("dot", () => str("."));
  rule("digit", () => match("[0-9]"));
  rule("digits", () => ref(rules, "digit").repeat(1, Infinity));
  rule("letter", () => match("[A-Z]"));
  rule("letters", () => ref(rules, "letter").repeat(1, Infinity));
  rule("underscore", () => str("_"));

  rule("roman_numeral", () =>
    alt(["XIII", "XII", "XI", "VIII", "VII", "VI", "IV", "IX", "X", "III", "II", "V", "I"]),
  );

  rule("bpvc_letter_code", () =>
    alt(["NCA", "NCD", "SSC", "BPV", "NUC", "NB", "NC", "ND", "NE", "NF", "NG"])
      .or(ref(rules, "letter")),
  );

  rule("bpvc_subdivision", () =>
    str("BPVC")
      .then(
        (
          ref(rules, "space").then(str("COMPLETE CODE BIND")).as("special")
            .or(
              ref(rules, "dash").then(str("CC")).then(ref(rules, "dash"))
                .then(ref(rules, "bpvc_letter_code").as("case_code")),
            )
            .or(
              ref(rules, "dot").then(
                // SSC with complex subdivision: BPVC.SSC.XI.II.V.IX,
                // or the bare catalogue form BPVC.SSC.
                str("SSC")
                  .then(
                    (ref(rules, "dot")
                      .then(
                        ref(rules, "roman_numeral")
                          .then((ref(rules, "dot").then(ref(rules, "roman_numeral"))).repeat(0, Infinity))
                          .as("ssc_sections"),
                      )).maybe(),
                  )
                  .then(ref(rules, "dot").maybe())
                  .as("ssc_code")
                // CC = Case Code: BPVC.CC.BPV or BPVC.CC.NC.XI; the
                // catalogue prints the sub-code with its own leading
                // dot (BPVC.CC.BPV..I)
                .or(
                  str("CC").then(ref(rules, "dot"))
                    .then(ref(rules, "bpvc_letter_code").as("case_code"))
                    .then(
                      (ref(rules, "dot").then(ref(rules, "dot").maybe())
                        .then(ref(rules, "roman_numeral").or(ref(rules, "bpvc_letter_code")).as("case_sub"))).maybe(),
                    ),
                )
                .or(
                  ref(rules, "roman_numeral").as("section")
                    .then(
                      (ref(rules, "dot")
                        .then((ref(rules, "digits").or(ref(rules, "bpvc_letter_code"))).as("subsection"))).maybe(),
                    )
                    .then(
                      (ref(rules, "dot").then(ref(rules, "bpvc_letter_code").as("sub_subsection"))).maybe(),
                    )
                    .then(
                      (ref(rules, "underscore").then(ref(rules, "letters").as("lang_suffix"))).maybe(),
                    ),
                ),
              ).as("subdivision"),
            )
        ).as("bpvc_code"),
      ),
  );

  rule("multi_char_code", () =>
    alt([
      "PVHO", "PASE", "PTC", "PTB", "PDS", "PCC",
      "V&V", "V V", "VVUQ",
      "TDP", "RTP", "RT",
      "RA-S", "RA",
      "QME", "QAI", "QEI",
      "NUM", "NQA", "NML",
      "OM",
      "HST", "HRT",
      "FFS",
      "TES",
      "TR",
      "STS",
      "CSD", "CA",
      "BTH", "BPE",
      "ANDE", "AED",
      "AG",
      "NM",
      "EA",
    ]),
  );

  rule("asme_publisher", () => str("ASME"));
  rule("csa_publisher", () => str("CSA"));
  rule("api_publisher", () => str("API"));
  rule("iso_publisher", () => str("ISO"));
  rule("ans_publisher", () => str("ANS"));

  rule("iso_asme_publisher", () =>
    str("ISO/ASME").as("joint_publisher").then(ref(rules, "space").maybe()),
  );

  rule("asme_ans_publisher", () =>
    str("ASME/ANS").as("joint_publisher").then(ref(rules, "space")),
  );

  rule("csa_asme_publisher", () =>
    ref(rules, "csa_publisher").as("first_publisher")
      .then(ref(rules, "space"))
      .then(match("[A-Z0-9.]").repeat(1, Infinity).as("first_code"))
      .then(ref(rules, "space").maybe())
      .then(ref(rules, "slash"))
      .then(ref(rules, "asme_publisher").as("second_publisher"))
      .then(ref(rules, "space")),
  );

  rule("api_asme_publisher", () =>
    ref(rules, "api_publisher").as("first_publisher")
      .then(ref(rules, "space"))
      .then(match("[0-9-]").repeat(1, Infinity).as("first_code"))
      .then(ref(rules, "space").maybe())
      .then(ref(rules, "slash"))
      .then(ref(rules, "asme_publisher").as("second_publisher"))
      .then(ref(rules, "space")),
  );

  rule("publisher", () => ref(rules, "asme_publisher").then(ref(rules, "space")));

  rule("designator", () =>
    (
      ref(rules, "bpvc_subdivision")
        .or(ref(rules, "multi_char_code"))
        .or(str("ISO"))
        .or(str("CSA"))
        .or(str("API"))
        .or(str("ANS"))
        .or(ref(rules, "letters"))
    ).as("designator"),
  );

  // A trailing edition year ("-2021", "-20XX") and nothing after it.
  // `number_part` must not read it as a dash-separated number: a
  // designator with no number ("BPVC.I-2021", "BPE-2012") then stored
  // the year as its number, and the year itself was lost.
  rule("trailing_year", () =>
    ref(rules, "dash")
      .then(
        str("20XX").or(str("202X"))
          .or(str("20").then(ref(rules, "digit")).then(str("X")))
          .or(ref(rules, "digit").repeat(4, 4)),
      )
      .then(match("[0-9A-Z.]").absent()),
  );

  // Number part - can start with dot (NM.1), be dotted (16.5), OR dash-separated (BTH-1)
  rule("number_part", () =>
    (
      (
        ref(rules, "dot").then(match("[0-9A-Z]").repeat(1, Infinity))
          .then((ref(rules, "dot").then(match("[0-9A-Z]").repeat(1, Infinity))).repeat(0, Infinity))
      )
        .or(
          ref(rules, "trailing_year").absent()
            .then(ref(rules, "dash")).then(match("[0-9A-Z]").repeat(1, Infinity))
            .then((ref(rules, "dot").then(match("[0-9A-Z]").repeat(1, Infinity))).repeat(0, Infinity)),
        )
        .or(
          match("[0-9A-Z]").repeat(1, Infinity)
            .then((ref(rules, "dot").then(match("[0-9A-Z]").repeat(1, Infinity))).repeat(0, Infinity)),
        )
    ).as("number"),
  );

  // PTC special: space-separated number with optional suffix; the
  // renderer glues the designator to the number (PTC 19.3 TW and
  // PTC19.3 TW are the same document)
  rule("ptc_number", () =>
    ref(rules, "space").maybe()
      .then(
        match("[0-9]").repeat(1, Infinity)
          .then((ref(rules, "dot").then(match("[0-9]").repeat(1, Infinity))).repeat(0, Infinity))
          .as("number"),
      )
      .then(
        (ref(rules, "space").then(ref(rules, "letters").as("ptc_suffix"))).maybe(),
      ),
  );

  // TR special: space-separated number (like "ASME TR A17.1-8.4-2013");
  // the rendered form glues the designator (TRA17.1-8.4)
  rule("tr_number", () =>
    ref(rules, "space").maybe()
      .then(
        match("[A-Z0-9]").repeat(1, Infinity)
          .then((ref(rules, "dot").then(match("[0-9A-Z]").repeat(1, Infinity))).repeat(0, Infinity))
          .then(
            (ref(rules, "dash").then(match("[0-9]").repeat(1, Infinity))
              .then((ref(rules, "dot").then(match("[0-9]").repeat(1, Infinity))).repeat(0, Infinity))).maybe(),
          )
          .as("number"),
      ),
  );

  rule("spaced_number_part", () =>
    ref(rules, "space").maybe().then(ref(rules, "number_part")),
  );

  rule("year_4digit", () => ref(rules, "digit").repeat(4, 4).as("year"));

  rule("draft_year", () =>
    str("20XX").or(str("202X"))
      .or(str("20").then(ref(rules, "digit")).then(str("X")))
      .as("draft_year"),
  );

  rule("reaffirmation", () =>
    ref(rules, "space").then(str("(R")).then(ref(rules, "year_4digit").as("reaffirmation")).then(str(")")),
  );

  rule("csa_portion", () =>
    ref(rules, "slash").then(str("CSA")).then(ref(rules, "space"))
      .then((ref(rules, "letter").then(match("[0-9.]").repeat(1, Infinity))).as("csa_number")),
  );

  rule("parenthetical_revision", () =>
    ref(rules, "space").then(str("("))
      .then(str("Proposed revision of").or(str("Revision of")))
      .then(ref(rules, "space"))
      .then(match("[^)]").repeat(1, Infinity).as("ref_standard"))
      .then(str(")")),
  );

  rule("revision_note", () =>
    ref(rules, "space").then(str("["))
      .then(match("[^\\]]").repeat(1, Infinity).as("revision_note"))
      .then(str("]")),
  );

  rule("language", () =>
    ref(rules, "space").then(str("(")).then(ref(rules, "letters").as("language")).then(str(")")),
  );

  rule("handbook_keyword", () =>
    (ref(rules, "space").then(str("Handbook"))).as("handbook"),
  );

  const yearSuffix = () =>
    (ref(rules, "dash").then(ref(rules, "draft_year").or(ref(rules, "year_4digit")))).maybe();
  const trailingTails = () =>
    ref(rules, "language").maybe()
      .then(ref(rules, "reaffirmation").maybe());

  rule("csa_asme_identifier", () =>
    ref(rules, "csa_asme_publisher")
      .then(ref(rules, "designator"))
      .then(ref(rules, "number_part").maybe())
      .then(yearSuffix())
      .then(trailingTails()),
  );

  rule("api_asme_identifier", () =>
    ref(rules, "api_asme_publisher")
      .then(ref(rules, "designator"))
      .then(ref(rules, "number_part").maybe())
      .then(yearSuffix())
      .then(trailingTails()),
  );

  rule("iso_asme_identifier", () =>
    ref(rules, "iso_asme_publisher")
      .then(ref(rules, "number_part").maybe())
      .then(yearSuffix())
      .then(trailingTails()),
  );

  rule("asme_ans_identifier", () =>
    ref(rules, "asme_ans_publisher")
      .then(ref(rules, "designator"))
      .then(ref(rules, "number_part").maybe())
      .then(yearSuffix())
      .then(trailingTails()),
  );

  rule("standard", () =>
    ref(rules, "publisher")
      .then(
        str("PTC").as("designator")
          .then(ref(rules, "ptc_number"))
          .then(yearSuffix())
          .or(
            str("TR").as("designator")
              .then(ref(rules, "tr_number"))
              .then(yearSuffix()),
          )
          .or(
            ref(rules, "designator")
              .then(ref(rules, "spaced_number_part").maybe())
              .then(
                (
                  ref(rules, "csa_portion").then(ref(rules, "handbook_keyword").maybe())
                    .or(ref(rules, "handbook_keyword"))
                ).maybe(),
              )
              .then(ref(rules, "language").maybe())
              .then(yearSuffix())
              .then(ref(rules, "language").maybe()),
          ),
      )
      .then(ref(rules, "parenthetical_revision").maybe())
      .then(ref(rules, "reaffirmation").maybe())
      .then(ref(rules, "revision_note").maybe()),
  );

  rule("identifier", () =>
    ref(rules, "csa_asme_identifier")
      .or(ref(rules, "api_asme_identifier"))
      .or(ref(rules, "iso_asme_identifier"))
      .or(ref(rules, "asme_ans_identifier"))
      .or(ref(rules, "standard")),
  );

  return rules;
}

export const asmeGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};
