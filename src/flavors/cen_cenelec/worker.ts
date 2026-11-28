//! The worker entry for the cen_cenelec flavor (pubid/pubid-ts#236):
//! the same implementation the node entry runs, with the adopted
//! ISO/IEC resolution wired to the worker-safe registry instead of the
//! node barrel. No `node:*` module appears in this graph and no wasm
//! loads — the CEN/CENELEC grammar is the pure-TS parslet port, so the
//! entry is synchronous.
//!
//!     import { cenCenelecWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/cen_cenelec/worker.js";
//!     const cen = cenCenelecWorkerGrammarImplementation();
//!     cen.parse("EN ISO 11140-3:2009"); // adopted routing → worker iso
//!
//! Pass a resolver to widen or narrow the foreign set.

import type { FlavorImplementation } from "../../conformance/implementation.js";
import type { ForeignResolver } from "../foreign-resolver.js";
import { workerForeignResolver } from "../worker-registry.js";
import { cenCenelecGrammarImplementation } from "./index.js";

export function cenCenelecWorkerGrammarImplementation(
  foreign?: ForeignResolver,
): FlavorImplementation {
  return cenCenelecGrammarImplementation(foreign ?? workerForeignResolver());
}
