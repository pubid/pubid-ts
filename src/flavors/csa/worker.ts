//! The worker entry for the csa flavor (pubid/pubid-ts#236): the same
//! implementation the node entry runs, with the adopted ISO/IEC
//! resolution wired to the worker-safe registry instead of the node
//! barrel. No `node:*` module appears in this graph and no wasm loads
//! — the csa grammar is the pure-TS parslet port, so the entry is
//! synchronous.
//!
//!     import { csaWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/csa/worker.js";
//!     const csa = csaWorkerGrammarImplementation();
//!     csa.parse("CSA ISO/IEC 8824-1:22"); // adopted routing → worker iso/iec
//!
//! Pass a resolver to widen or narrow the foreign set.

import type { FlavorImplementation } from "../../conformance/implementation.js";
import type { ForeignResolver } from "../foreign-resolver.js";
import { workerForeignResolver } from "../worker-registry.js";
import { csaGrammarImplementation } from "./index.js";

export function csaWorkerGrammarImplementation(
  foreign?: ForeignResolver,
): FlavorImplementation {
  return csaGrammarImplementation(foreign ?? workerForeignResolver());
}
