import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import { oimlGrammar } from "./grammar.js";
import { buildOimlIdentifier, fromHash, toHash, toHuman, toUrn, } from "./model.js";
class GrammarIdentifier {
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
        return new GrammarIdentifier(fromHash(hash));
    }
}
/**
 * Grammar-backed OIML: the parslet grammar ported 1:1 from
 * lib/pubid/oiml/parser.rb, the builder from builder.rb, the renderer
 * from renderer.rb and the URN generator from urn_generator.rb. Wave 1
 * replaces corpus mode for this flavor; the conformance gate enforces
 * parity with the corpus (canonical hash, human form, URN, deserialize).
 */
export function oimlGrammarImplementation() {
    return {
        parse(input) {
            const tree = parseGrammar(oimlGrammar, input);
            return new GrammarIdentifier(buildOimlIdentifier(tree));
        },
    };
}
export { ParseFailed };
