export * from "./corpus/types.js";
export { loadCorpus } from "./corpus/loader.js";
export type { FlavorPayloads, Corpus } from "./corpus/loader.js";
export {
  buildArtifact,
  loadBundledCorpus,
  parseArtifact,
} from "./corpus/artifact.js";
export type { FlavorImplementation, Identifier, ImplementationRegistry } from "./conformance/implementation.js";
export { PendingRegistry } from "./conformance/pending.js";
export { checkCase, runFlavor, runCorpus } from "./conformance/runner.js";
export { corpusModeImplementation, CorpusBackedIdentifier } from "./implementations/corpus-mode.js";
// Root re-export so consumers needn't deep-import flavor modules
// (pubid/pubid-ts#63 - the estate serving codec).
export { grammarImplementation } from "./flavors/index.js";
export { subsetMatch, valueMatch, exactMatch } from "./model/subset-match.js";
// The parse surface: structured components, canonical render, the lane
// keys and the parse_ok verdict (pubid/pubid-ts#226).
export {
  parse,
  parseOk,
  render,
  laneKeys,
  norm,
  undatedNorm,
  allPartsNorm,
  ParseError,
} from "./parse-surface.js";
export type { ParseResult, LaneKeys } from "./parse-surface.js";
// The pubid-scheme URN codec and the slug form (pubid-ts#161).
export * as PubidUrn from "./pubid-urn/index.js";
