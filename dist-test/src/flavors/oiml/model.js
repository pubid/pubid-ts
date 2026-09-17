import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
const KIND_BY_TYPE = {
    B: "basic-publication",
    D: "document",
    E: "expert-report",
    G: "guide",
    R: "recommendation",
    S: "seminar-report",
    V: "vocabulary",
};
const SUPPLEMENT_KINDS = {
    Amendment: "amendment",
    Errata: "errata",
};
function isObj(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v) {
    if (v === undefined || v === null)
        return undefined;
    return String(v);
}
/** Ruby Builder#extract_language: the tree value is {language: code} | null. */
function extractLanguage(langData) {
    if (isObj(langData)) {
        const code = str(langData["language"]);
        return code;
    }
    return str(langData);
}
/** Ruby Identifiers::CodeNumber#code: compose the printed code. */
function composedCode(id) {
    if (id.number === undefined)
        return undefined;
    let result = id.number;
    if (id.part)
        result += `-${id.part}`;
    if (id.subpart)
        result += `-${id.subpart}`;
    if (id.suffix)
        result += `${id.spaceSuffix ? " " : "-"}${id.suffix}`;
    return result;
}
export function buildOimlIdentifier(tree) {
    if (!isObj(tree))
        throw new ParseFailed("OIML: unexpected parse tree", 0);
    if (tree["amd_marker"] !== undefined)
        return buildShortAmendment(tree);
    if (tree["base"] !== undefined)
        return buildSupplement(tree);
    return buildBaseDocument(tree);
}
function buildShortAmendment(tree) {
    const baseCode = isObj(tree["base_code"]) ? tree["base_code"] : undefined;
    const base = buildBaseDocument({
        publisher: tree["publisher"],
        type: tree["type"],
        number: baseCode?.["number"],
        part: baseCode?.["part"],
        subpart: baseCode?.["subpart"],
    });
    const editionFormat = isObj(tree["edition_format"]) ? tree["edition_format"] : undefined;
    const yearValue = editionFormat ? editionFormat["year"] : tree["year"];
    const id = {
        kind: "amendment",
        publisher: "OIML",
        base,
        parsedFormat: editionFormat ? "long" : "short",
    };
    const suppYear = str(yearValue);
    if (suppYear !== undefined)
        id.suppYear = suppYear;
    const language = extractLanguage(tree["language"]);
    if (language !== undefined)
        id.language = language;
    for (const key of Object.keys(id)) {
        if (id[key] === undefined)
            delete id[key];
    }
    return id;
}
function buildSupplement(tree) {
    const marker = str(tree["trailing_marker"]);
    const plusMarker = str(tree["plus_marker"]);
    let kind;
    if (tree["annex_letter"] !== undefined || tree["annex_marker"] !== undefined) {
        kind = "annex";
    }
    else if (marker === "Errata" || plusMarker === "Errata") {
        kind = "errata";
    }
    else {
        kind = "amendment";
    }
    const base = buildOimlIdentifier(tree["base"]);
    const editionFormat = isObj(tree["edition_format"]) ? tree["edition_format"] : undefined;
    const yearValue = editionFormat ? editionFormat["year"] : tree["year"];
    const id = {
        kind,
        publisher: "OIML",
        base,
        parsedFormat: editionFormat ? "long" : "short",
    };
    const suppYear = str(yearValue);
    if (suppYear !== undefined)
        id.suppYear = suppYear;
    const language = extractLanguage(tree["language"]);
    if (language !== undefined)
        id.language = language;
    if (marker !== undefined)
        id.trailing = true;
    if (plusMarker !== undefined)
        id.joined = true;
    const letter = str(tree["annex_letter"]);
    if (letter !== undefined)
        id.letter = letter;
    // Annex with no year of its own but a dated base: the year belongs to
    // the base and must render glued to it.
    if (kind === "annex" && !yearValue && base.year)
        id.yearOnBase = true;
    return id;
}
function buildBaseDocument(tree) {
    const type = str(tree["type"]);
    const kind = type === "Bulletin" ? "bulletin" : KIND_BY_TYPE[type ?? ""] ?? "recommendation";
    const id = {
        kind,
        publisher: str(tree["publisher"]) ?? "OIML",
    };
    const number = str(tree["number"]);
    if (number !== undefined)
        id.number = number;
    const part = str(tree["part"]);
    if (part !== undefined)
        id.part = part;
    const subpart = str(tree["subpart"]);
    if (subpart !== undefined)
        id.subpart = subpart;
    const codeSuffix = str(tree["code_suffix"]);
    if (codeSuffix !== undefined)
        id.suffix = codeSuffix;
    if ("space_suffix" in tree)
        id.spaceSuffix = true;
    const editionFormat = isObj(tree["edition_format"]) ? tree["edition_format"] : undefined;
    let yearValue;
    if (editionFormat) {
        yearValue = editionFormat["year"];
        const edition = str(editionFormat["edition"]);
        if (edition !== undefined)
            id.edition = edition;
    }
    else {
        yearValue = tree["year"];
    }
    const year = str(yearValue);
    if (year !== undefined)
        id.year = year;
    if (kind === "bulletin")
        applyBulletinLocator(id, tree);
    id.parsedFormat = editionFormat
        ? "long"
        : tree["space_before_lang"] !== undefined
            ? "short_with_space"
            : tree["article_id"] !== undefined
                ? "citation"
                : "short";
    const stage = str(tree["stage"]);
    if (stage !== undefined)
        id.stage = stage;
    const iteration = str(tree["iteration"]);
    if (iteration !== undefined)
        id.iteration = iteration;
    const language = extractLanguage(tree["language"]);
    if (language !== undefined)
        id.language = language;
    // drop undefined fields for a clean object
    for (const key of Object.keys(id)) {
        if (id[key] === undefined)
            delete id[key];
    }
    return id;
}
function applyBulletinLocator(id, tree) {
    const articleId = str(tree["article_id"]);
    if (articleId) {
        id.year = articleId.slice(0, 4);
        id.number = articleId.slice(4, 6);
        id.sequence = articleId.slice(6, 8);
        return;
    }
    const issue = str(tree["issue"]);
    if (issue !== undefined)
        id.number = issue;
    const sequence = str(tree["sequence"]);
    if (sequence !== undefined)
        id.sequence = sequence;
}
/** ---- human rendering: port of lib/pubid/oiml/renderer.rb ---- */
function effectiveFormat(id) {
    return id.parsedFormat === "long" ? "long" : "short";
}
function stripLanguage(s) {
    return s.replace(/\s*\([^)]+\)\s*$/, "").trim();
}
function renderDateYear(id) {
    return id.year ?? "";
}
function renderSingle(id) {
    const format = effectiveFormat(id);
    let result = `${id.publisher} ${typeString(id)} ${composedCode(id)}`;
    let usingEditionFormat = false;
    if (id.edition && id.year) {
        result += ` ${id.edition} Edition ${renderDateYear(id)}`;
        usingEditionFormat = true;
    }
    else if (id.edition) {
        result += ` ${id.edition}`;
        usingEditionFormat = true;
    }
    else if (id.year) {
        if (format === "long") {
            result += ` Edition ${renderDateYear(id)}`;
            usingEditionFormat = true;
        }
        else {
            result += `:${renderDateYear(id)}`;
        }
    }
    if (id.stage || id.iteration) {
        result += " ";
        if (id.iteration)
            result += id.iteration;
        if (id.stage)
            result += id.stage;
    }
    if (id.language) {
        result +=
            usingEditionFormat || id.parsedFormat === "short_with_space"
                ? ` (${id.language})`
                : `(${id.language})`;
    }
    return result;
}
function renderSupplement(id) {
    const format = effectiveFormat(id);
    if (id.joined) {
        let result = `${stripLanguage(toHuman(id.base))}+${supplementType(id)}`;
        if (id.suppYear)
            result += `:${id.suppYear}`;
        if (id.language)
            result += ` (${id.language})`;
        return result;
    }
    if (id.trailing) {
        let result = `${stripLanguage(toHuman(id.base))} ${supplementType(id)}`;
        if (id.language)
            result += ` (${id.language})`;
        return result;
    }
    const baseFormat = format && format !== "short"
        ? format
        : id.base.parsedFormat === "long"
            ? "long"
            : "short";
    const baseStr = stripLanguage(toHuman(id.base, baseFormat));
    let result = `${supplementType(id)} (${id.suppYear}) to ${baseStr}`;
    if (id.language)
        result += ` (${id.language})`;
    return result;
}
function renderAnnex(id) {
    const format = effectiveFormat(id);
    if (id.yearOnBase) {
        const baseStr = stripLanguage(toHuman(id.base));
        const marker = id.letter ? `Annex ${id.letter}` : "Annexes";
        let result = `${baseStr} ${marker}`;
        if (id.language)
            result += ` (${id.language})`;
        return result;
    }
    const baseFormat = id.base.parsedFormat === "long" ? "long" : "short";
    const annexFormat = format ?? (id.parsedFormat === "long" ? "long" : "short");
    let baseStr = toHuman(id.base, baseFormat);
    baseStr = baseStr
        .replace(/:.*/, "")
        .replace(/\s+Edition\s+\d{4}/, "")
        .replace(/\(.*\)/, "")
        .trim();
    let result = baseStr;
    if (id.letter) {
        result += ` Annex ${id.letter}`;
        if (id.suppYear)
            result += ` Edition ${id.suppYear}`;
    }
    else {
        result += " Annexes";
        if (id.suppYear) {
            if (annexFormat === "long") {
                result += ` Edition ${id.suppYear}`;
            }
            else {
                result += `:${id.suppYear}`;
            }
        }
    }
    if (id.language)
        result += ` (${id.language})`;
    return result;
}
function renderBulletin(id) {
    const citation = id.parsedFormat === "citation" && id.year && id.number && id.sequence;
    if (citation) {
        return `${id.publisher} Bulletin ${toRoman(Number(id.year) - 1959)}(${Number(id.number)}) ${id.year}${id.number}${id.sequence}`;
    }
    let result = `${id.publisher} Bulletin`;
    if (id.year) {
        result += ` ${id.year}`;
        if (id.number)
            result += `-${id.number}`;
        if (id.sequence)
            result += `-${id.sequence}`;
    }
    if (id.language)
        result += ` (${id.language})`;
    return result;
}
function toRoman(n) {
    const table = [
        [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"],
        [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"],
        [5, "V"], [4, "IV"], [1, "I"],
    ];
    let out = "";
    for (const [value, sym] of table) {
        while (n >= value) {
            out += sym;
            n -= value;
        }
    }
    return out;
}
function typeString(id) {
    const map = {
        "basic-publication": "B",
        document: "D",
        "expert-report": "E",
        guide: "G",
        recommendation: "R",
        "seminar-report": "S",
        vocabulary: "V",
    };
    return map[id.kind] ?? id.kind;
}
function supplementType(id) {
    if (id.kind === "annex")
        return id.letter ? `Annex ${id.letter}` : "Annexes";
    return id.kind === "errata" ? "Errata" : "Amendment";
}
export function toHuman(id, format) {
    switch (id.kind) {
        case "annex":
            return renderAnnex(id);
        case "bulletin":
            return format === "citation" ? renderBulletin(id) : renderBulletin(id);
        case "amendment":
        case "errata":
            return renderSupplement(id);
        default:
            return renderSingle({ ...id, parsedFormat: format ?? id.parsedFormat ?? "short" });
    }
}
/** ---- canonical hash: the key_value maps under no-defaults ---- */
export function toHash(id) {
    const hash = {
        _type: `pubid:oiml:${id.kind}`,
    };
    if (id.language)
        hash["language"] = id.language;
    if (id.parsedFormat && id.parsedFormat !== "short") {
        hash["parsed_format"] = id.parsedFormat;
    }
    if (id.kind === "amendment" || id.kind === "errata" || id.kind === "annex") {
        hash["base"] = toHash(id.base);
        if (id.suppYear)
            hash["year"] = id.suppYear;
        if (id.trailing)
            hash["trailing"] = true;
        if (id.joined)
            hash["joined"] = true;
        if (id.kind === "annex") {
            if (id.letter)
                hash["letter"] = id.letter;
            if (id.yearOnBase)
                hash["year_on_base"] = true;
        }
        return hash;
    }
    hash["publisher"] = id.publisher;
    if (id.number)
        hash["number"] = id.number;
    if (id.part)
        hash["part"] = id.part;
    if (id.subpart)
        hash["subpart"] = id.subpart;
    if (id.suffix)
        hash["suffix"] = id.suffix;
    if (id.spaceSuffix)
        hash["space_suffix"] = true;
    if (id.year)
        hash["year"] = id.year;
    if (id.edition)
        hash["edition"] = id.edition;
    if (id.stage)
        hash["stage"] = id.stage;
    if (id.iteration)
        hash["iteration"] = id.iteration;
    if (id.kind === "bulletin" && id.sequence)
        hash["sequence"] = id.sequence;
    return hash;
}
export function fromHash(hash) {
    const kind = String(hash["_type"]).split(":").pop();
    const id = { kind, publisher: "OIML" };
    const s = (key) => hash[key] === undefined || hash[key] === null ? undefined : String(hash[key]);
    const assign = (key, value) => {
        if (value !== undefined)
            id[key] = value;
    };
    if (kind === "amendment" || kind === "errata" || kind === "annex") {
        id.base = fromHash(hash["base"]);
        assign("suppYear", s("year"));
        if (hash["trailing"] === true)
            id.trailing = true;
        if (hash["joined"] === true)
            id.joined = true;
        assign("letter", s("letter"));
        if (hash["year_on_base"] === true)
            id.yearOnBase = true;
    }
    else {
        assign("number", s("number"));
        assign("part", s("part"));
        assign("subpart", s("subpart"));
        assign("suffix", s("suffix"));
        if (hash["space_suffix"] === true)
            id.spaceSuffix = true;
        assign("year", s("year"));
        assign("edition", s("edition"));
        assign("stage", s("stage"));
        assign("iteration", s("iteration"));
        if (kind === "bulletin")
            assign("sequence", s("sequence"));
    }
    const language = s("language");
    if (language !== undefined)
        id.language = language;
    const pf = s("parsed_format");
    if (pf !== undefined)
        id.parsedFormat = pf;
    for (const key of Object.keys(id)) {
        if (id[key] === undefined)
            delete id[key];
    }
    return id;
}
/** ---- URN: port of lib/pubid/oiml/urn_generator.rb ---- */
export function toUrn(id) {
    if (id.kind === "bulletin") {
        const parts = ["urn", "oiml", "bulletin"];
        if (id.year) {
            let locator = id.year;
            if (id.number)
                locator += `-${id.number}`;
            if (id.sequence)
                locator += `-${id.sequence}`;
            parts.push(locator);
        }
        if (id.language)
            parts.push(id.language.toLowerCase());
        return parts.join(":");
    }
    const parts = ["urn", "oiml"];
    // Ruby: `return "r" unless identifier.type` - a supplement has no type
    // letter, so its URN carries the default "r" (corpus-recorded quirk).
    parts.push(id.kind === "amendment" || id.kind === "errata" || id.kind === "annex"
        ? "r"
        : typeString(id).toLowerCase());
    // Ruby SupplementIdentifier#code delegates to the wrapped standard.
    const code = id.kind === "amendment" || id.kind === "errata" || id.kind === "annex"
        ? composedCode(id.base)
        : composedCode(id);
    if (code)
        parts.push(code);
    const year = id.year ?? id.suppYear;
    if (year)
        parts.push(year);
    if (id.stage)
        parts.push(id.stage.toLowerCase());
    if (id.iteration)
        parts.push(id.iteration);
    if (id.language)
        parts.push(id.language.toLowerCase());
    return parts.join(":");
}
export { parseGrammar };
