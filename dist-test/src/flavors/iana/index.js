import { match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
/**
 * 1:1 port of lib/pubid/iana/ — registry slugs. The parser accepts the
 * printed "IANA <slug>[/<sub-slug>]" and the bare index-key slug; the
 * renderer always re-emits the prefix. The top-level slug is stored as
 * `number` (the relaton-index key); `sub_registry` is optional.
 */
function buildRules() {
    const rules = {};
    const rule = (name, build) => {
        rules[name] = build();
    };
    // Ruby: match['a-zA-Z0-9._\-'] (bracket form = character class)
    const slug = match("[a-zA-Z0-9._\\-]").repeat(1, Infinity);
    rule("slug", () => slug);
    rule("iana_prefix", () => str("IANA").then(str(" ")).maybe());
    rule("identifier", () => rules["iana_prefix"]
        .then(slug.as("registry"), str("/").then(slug.as("sub_registry")).maybe()));
    rule("root", () => rules["identifier"]);
    return rules;
}
export const ianaGrammar = { rules: buildRules(), root: "root" };
function isObj(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function buildIanaIdentifier(tree) {
    if (!isObj(tree) || tree["registry"] === undefined) {
        throw new ParseFailed("IANA: unexpected parse tree", 0);
    }
    const id = {
        kind: "registry",
        number: String(tree["registry"]),
    };
    if (tree["sub_registry"] !== undefined && tree["sub_registry"] !== null) {
        id.subRegistry = String(tree["sub_registry"]);
    }
    return id;
}
export function toHash(id) {
    const hash = {
        _type: "pubid:iana:registry",
        number: id.number,
    };
    if (id.subRegistry)
        hash["sub_registry"] = id.subRegistry;
    return hash;
}
export function fromHash(hash) {
    const id = {
        kind: "registry",
        number: String(hash["number"]),
    };
    if (hash["sub_registry"] !== undefined && hash["sub_registry"] !== null) {
        id.subRegistry = String(hash["sub_registry"]);
    }
    return id;
}
export function toHuman(id) {
    return id.subRegistry
        ? `IANA ${id.number}/${id.subRegistry}`
        : `IANA ${id.number}`;
}
export function toUrn(id) {
    const parts = ["urn", "iana", id.number];
    if (id.subRegistry)
        parts.push(id.subRegistry);
    return parts.join(":");
}
class IanaIdentifierImpl {
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
        return new IanaIdentifierImpl(fromHash(hash));
    }
}
export function ianaGrammarImplementation() {
    return {
        parse(input) {
            return new IanaIdentifierImpl(buildIanaIdentifier(parseGrammar(ianaGrammar, input)));
        },
    };
}
