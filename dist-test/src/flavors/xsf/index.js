import { match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
/**
 * 1:1 port of lib/pubid/xsf/ — the whole flavor in one file. XSF has a
 * single concrete type ("XEP 0001" and the two named documents), so the
 * model is a scalar `number` and every surface is a direct port:
 * parser.rb -> grammar, builder.rb -> build, renderer.rb -> toHuman,
 * urn_generator.rb -> toUrn, identifier.rb's key_value map -> toHash.
 */
// SPECIAL_NUMBERS: the editor README and the xep-xxxx template reach
// pubid as real primary docids ("XEP README", "XEP xxxx").
const SPECIAL_NUMBERS = ["README", "xxxx"];
function buildRules() {
    const rules = {};
    const rule = (name, build) => {
        rules[name] = build();
    };
    const specialNumber = SPECIAL_NUMBERS.map((name) => str(name)).reduce((a, b) => a.or(b));
    rule("special_number", () => specialNumber);
    // Ruby used match["0-9"] (bracket form = character class). The engine's
    // match(x) is parslet's paren form (a full regex), so wrap explicitly.
    const digits = match("[0-9]").repeat(1);
    rule("digits", () => digits);
    rule("identifier", () => str("XEP").then(str(" "), digits.or(specialNumber).as("number")));
    rule("root", () => rules["identifier"]);
    return rules;
}
export const xsfGrammar = {
    rules: buildRules(),
    root: "root",
};
function isObj(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function buildXsfIdentifier(tree) {
    if (!isObj(tree) || tree["number"] === undefined || tree["number"] === null) {
        throw new ParseFailed("XSF: unexpected parse tree", 0);
    }
    return { kind: "xep", number: String(tree["number"]) };
}
export function toHash(id) {
    return { _type: "pubid:xsf:xep", number: id.number };
}
export function fromHash(hash) {
    return { kind: "xep", number: String(hash["number"]) };
}
export function toHuman(id) {
    return `XEP ${id.number}`;
}
export function toUrn(id) {
    return ["urn", "xsf", "xep", id.number].join(":");
}
class XsfIdentifierImpl {
    id;
    constructor(id) {
        this.id = id;
    }
    toHash() {
        return toHash(this.id);
    }
    toHuman() {
        return toHuman(this.id);
    }
    toUrn() {
        return toUrn(this.id);
    }
    fromHash(hash) {
        return new XsfIdentifierImpl(fromHash(hash));
    }
}
export function xsfGrammarImplementation() {
    return {
        parse(input) {
            return new XsfIdentifierImpl(buildXsfIdentifier(parseGrammar(xsfGrammar, input)));
        },
    };
}
