import { match, ref, str, } from "../../grammar/engine.js";
/**
 * 1:1 port of lib/pubid/oiml/parser.rb (including CommonParseRules).
 * Rule names match the Ruby rule names so the two files can be diffed
 * side by side while porting.
 */
function buildRules() {
    const rules = {};
    const rule = (name, build) => {
        rules[name] = build();
    };
    // --- CommonParseRules ---
    rule("space", () => str(" "));
    rule("space?", () => ref(rules, "space").maybe());
    rule("digits", () => match("\\d").repeat(1));
    rule("year", () => match("\\d").repeat(4, 4).as("year"));
    rule("comma", () => str(", "));
    rule("comma?", () => ref(rules, "comma").maybe());
    rule("comma_space", () => ref(rules, "comma").or(ref(rules, "space")));
    rule("dash", () => str("-"));
    rule("dot", () => str("."));
    rule("words_digits", () => match("[\\dA-Za-z]").repeat(1));
    rule("words", () => match("[A-Za-z]").repeat(1));
    rule("words?", () => ref(rules, "words").maybe());
    rule("year_digits", () => str("19").or(str("20")).then(match("\\d").repeat(2, 2), ref(rules, "digits").absent()));
    rule("month_digits", () => match("\\d").repeat(2, 2));
    rule("day_digits", () => match("\\d").repeat(2, 2));
    rule("originator", () => ref(rules, "organization")
        .as("publisher")
        .then(ref(rules, "space?")
        .then(str("/"), ref(rules, "organization").as("copublisher"))
        .repeat(0)));
    rule("comma_month_year", () => ref(rules, "comma").then(ref(rules, "words").as("month"), str(" "), ref(rules, "year_digits").as("year")));
    rule("year_month", () => ref(rules, "year_digits").then(ref(rules, "dash"), ref(rules, "month_digits")));
    // organization: OIML's parser never uses it (publisher is the literal
    // "OIML"); provide a minimal definition so refs resolve.
    rule("organization", () => str("OIML"));
    // --- Additional basic rules not in CommonParseRules ---
    rule("colon", () => str(":"));
    rule("lparen", () => str("("));
    rule("rparen", () => str(")"));
    rule("slash", () => str("/"));
    // Main identifier pattern - check supplements first
    rule("identifier", () => ref(rules, "amendment_identifier")
        .or(ref(rules, "amendment_short"))
        .or(ref(rules, "annex_letter_identifier"))
        .or(ref(rules, "annex_identifier"))
        .or(ref(rules, "plus_supplement_identifier"))
        .or(ref(rules, "trailing_supplement_identifier"))
        .or(ref(rules, "bulletin_identifier"))
        .or(ref(rules, "base")));
    // Publisher - always "OIML"
    rule("publisher", () => str("OIML").as("publisher").then(ref(rules, "space")));
    // Document type - single letter
    rule("doc_type", () => match("[BDEGRSVX]").as("type").then(ref(rules, "space")));
    // Bulletin locator - structured YYYY[-II[-SS]]
    rule("bulletin_date", () => ref(rules, "space")
        .then(ref(rules, "year_digits").as("year"))
        .then(ref(rules, "dash").then(ref(rules, "two_digits").as("issue")).maybe())
        .then(ref(rules, "dash").then(ref(rules, "two_digits").as("sequence")).maybe()));
    rule("two_digits", () => match("\\d").repeat(2, 2));
    rule("roman_numeral", () => match("[IVXLCDM]").repeat(1).as("volume_roman"));
    // Citation form: LXVII(2) 20260211
    rule("bulletin_citation", () => ref(rules, "space")
        .then(ref(rules, "roman_numeral"))
        .then(ref(rules, "lparen"), ref(rules, "digits").as("issue_arabic"), ref(rules, "rparen"))
        .then(str(" "), match("\\d").repeat(8, 8).as("article_id")));
    rule("bulletin_identifier", () => ref(rules, "publisher")
        .then(str("Bulletin").as("type"))
        .then(ref(rules, "bulletin_citation").or(ref(rules, "bulletin_date")).maybe())
        .then(ref(rules, "language_portion").maybe().as("language")));
    rule("number_only", () => ref(rules, "digits").as("number"));
    rule("part_number", () => ref(rules, "dash").then(ref(rules, "digits")
        .then(ref(rules, "slash").then(ref(rules, "dash"), ref(rules, "digits")).repeat(0))
        .as("part")));
    rule("subpart_number", () => ref(rules, "dash").then(ref(rules, "digits").as("subpart")));
    rule("named_suffix", () => ref(rules, "dash")
        .then(str("GUM")
        .then(ref(rules, "space"), ref(rules, "digits"))
        .or(match("[A-Za-z]").repeat(1).then(str("_").maybe(), ref(rules, "digits")).repeat(0))
        .as("code_suffix"))
        .or(str(" ").then(str("Brochure").as("code_suffix"), str("").as("space_suffix"))));
    rule("full_number", () => ref(rules, "number_only")
        .then(ref(rules, "part_number"), ref(rules, "subpart_number"), ref(rules, "named_suffix").maybe())
        .or(ref(rules, "number_only").then(ref(rules, "part_number"), ref(rules, "named_suffix").maybe()))
        .or(ref(rules, "number_only").then(ref(rules, "named_suffix").maybe())));
    rule("edition_number", () => str("6th")
        .or(str("5th"))
        .or(str("4th"))
        .or(str("3rd"))
        .or(str("2nd"))
        .or(str("1st"))
        .or(match("\\d").repeat(1).then(str("th").or(str("nd")).or(str("rd")).or(str("st"))))
        .as("edition"));
    rule("edition_text", () => str("Edition").or(str("edition")));
    rule("edition_portion", () => str(", ")
        .or(ref(rules, "space"))
        .then(ref(rules, "edition_number").maybe(), ref(rules, "space?"), ref(rules, "edition_text"), ref(rules, "space?"), ref(rules, "year_digits").as("year"))
        .as("edition_format"));
    rule("date", () => ref(rules, "edition_portion")
        .or(ref(rules, "colon").then(ref(rules, "space?"), ref(rules, "year_digits").as("year")))
        .or(ref(rules, "space?").then(ref(rules, "lparen"), ref(rules, "year_digits").as("year"), ref(rules, "rparen"))));
    rule("stage_iteration", () => match("\\d").repeat(1).then(str("."), match("\\d").repeat(1)).or(match("\\d").repeat(1)).as("iteration"));
    rule("stage_abbr", () => str("WD").or(str("CD")).as("stage"));
    rule("draft_stage", () => ref(rules, "space").then(ref(rules, "stage_iteration").maybe(), ref(rules, "stage_abbr")));
    // Language codes: two-letter OIML codes before the single letters
    rule("lang_single", () => match("[EFRXDSCAU]"));
    rule("lang_multi_oiml", () => str("PO").or(str("PT")).or(str("PE")).or(str("SR")));
    rule("lang_multi", () => match("[a-z]").repeat(2, 2));
    rule("language_code", () => ref(rules, "lang_single")
        .then(ref(rules, "slash"), ref(rules, "lang_single"))
        .or(ref(rules, "lang_multi_oiml"))
        .or(ref(rules, "lang_single"))
        .or(ref(rules, "lang_multi"))
        .as("language"));
    rule("language_with_space", () => ref(rules, "space")
        .then(ref(rules, "lparen"), ref(rules, "language_code"), ref(rules, "rparen"))
        .then(str("").as("space_before_lang")));
    rule("language_without_space", () => ref(rules, "lparen").then(ref(rules, "language_code"), ref(rules, "rparen")));
    rule("language_portion", () => ref(rules, "language_with_space").or(ref(rules, "language_without_space")));
    // Amendment identifier - "Amendment (YYYY) to BASE"
    rule("amendment_identifier", () => str("Amendment")
        .then(ref(rules, "space"), ref(rules, "lparen"), ref(rules, "year_digits").as("year"), ref(rules, "rparen"))
        .then(str(" "), str("to"), str(" "))
        .then(ref(rules, "base_without_language").as("base"))
        .then(ref(rules, "language_portion").maybe().as("language")));
    rule("amendment_short", () => ref(rules, "publisher")
        .then(ref(rules, "doc_type"))
        .then(ref(rules, "full_number").as("base_code"))
        .then(str(" "), str("Amendment").as("amd_marker"))
        .then(str(" ")
        .then(ref(rules, "edition_text"), ref(rules, "space?"), ref(rules, "year_digits").as("year"))
        .as("edition_format")
        .or(ref(rules, "colon").then(ref(rules, "space?"), ref(rules, "year_digits").as("year"))))
        .then(ref(rules, "language_portion").maybe().as("language")));
    rule("trailing_supplement_identifier", () => ref(rules, "base_without_language")
        .as("base")
        .then(str(" "), str("Amendment").or(str("Errata")).as("trailing_marker"))
        .then(ref(rules, "language_portion").maybe().as("language")));
    rule("plus_supplement_identifier", () => ref(rules, "base_without_language")
        .as("base")
        .then(str("+"), str("Amendment").or(str("Errata")).as("plus_marker"))
        .then(ref(rules, "colon").then(ref(rules, "year_digits").as("year")).maybe())
        .then(ref(rules, "language_portion").maybe().as("language")));
    rule("annex_identifier", () => ref(rules, "base_without_language")
        .as("base")
        .then(str(" "), str("Annexes").as("annex_marker"))
        .then(str(" ")
        .then(ref(rules, "edition_text"), str(" "), ref(rules, "year_digits").as("year"))
        .as("edition_format")
        .or(ref(rules, "colon").then(ref(rules, "year_digits").as("year")))
        .maybe())
        .then(ref(rules, "language_portion").maybe().as("language")));
    rule("annex_letter_value", () => match("[A-Z]").then(ref(rules, "dash").then(match("[A-Z]")).maybe()).as("annex_letter"));
    rule("annex_letter_identifier", () => ref(rules, "base_without_language")
        .as("base")
        .then(str(" "), str("Annex"), str(" "), ref(rules, "annex_letter_value"))
        .then(str(" ")
        .then(ref(rules, "edition_text"), str(" "), ref(rules, "year_digits").as("year"))
        .or(ref(rules, "colon").then(ref(rules, "year_digits").as("year")))
        .maybe())
        .then(ref(rules, "language_portion").maybe().as("language")));
    rule("base_without_language", () => ref(rules, "publisher")
        .then(ref(rules, "doc_type"))
        .then(ref(rules, "full_number"))
        .then(ref(rules, "date").maybe())
        .then(ref(rules, "draft_stage").maybe()));
    rule("base", () => ref(rules, "publisher")
        .then(ref(rules, "doc_type"))
        .then(ref(rules, "full_number"))
        .then(ref(rules, "date").maybe())
        .then(ref(rules, "draft_stage").maybe())
        .then(ref(rules, "language_portion").maybe()));
    return rules;
}
export const oimlGrammar = {
    rules: buildRules(),
    root: "identifier",
};
