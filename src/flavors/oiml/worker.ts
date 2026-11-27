//! The worker entry for the oiml flavor (pubid/pubid-ts#232): the same
//! implementation the node entry runs. The oiml grammar is the pure-TS
//! parslet engine (no artifact, no wasm), so this entry is synchronous
//! and its only dependency is the parg-free iso implementation for the
//! co-published side. No node:* module appears in this graph.
//!
//!     import { oimlWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/oiml/worker.js";
//!     const oiml = oimlWorkerGrammarImplementation();
//!     oiml.parse("OIML R 49-1:2024");

import { isoGrammarImplementation } from "../iso/index.js";
import type { FlavorImplementation } from "../../conformance/implementation.js";
import { makeOimlGrammarImplementation } from "./implementation.js";

export function oimlWorkerGrammarImplementation(): FlavorImplementation {
  return makeOimlGrammarImplementation((flavor) =>
    flavor === "iso" ? isoGrammarImplementation() : undefined,
  );
}
