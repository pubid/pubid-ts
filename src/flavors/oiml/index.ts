/**
 * The oiml flavor entry (pubid-ts#232), the dist/flavors/<flavor>/index.js
 * shape the other flavors have. oiml is a TypeScript grammar: it needs no
 * wasm engine and no artifact. It imports the grammar barrel to parse the
 * co-publisher side of "ISO …|OIML R …", and the barrel is worker-safe.
 */
export { oimlGrammarImplementation, ParseFailed } from "./implementation.js";
