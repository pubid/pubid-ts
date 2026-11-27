//! The flavor index for oiml (pubid/pubid-ts#232): the co-published
//! side routes through the grammar barrel, exactly as the barrel's
//! oiml entry always has. The implementation (./implementation.js) is
//! environment-agnostic; the worker entry (./worker.js) composes the
//! same code over the parg-free iso implementation.

import { grammarImplementation } from "../index.js";
import type { FlavorImplementation } from "../../conformance/implementation.js";
import { makeOimlGrammarImplementation } from "./implementation.js";

export function oimlGrammarImplementation(): FlavorImplementation {
  return makeOimlGrammarImplementation((flavor) => grammarImplementation(flavor));
}
