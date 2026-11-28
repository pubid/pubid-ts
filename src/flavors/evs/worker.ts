//! The worker entry for the evs flavor (pubid/pubid-ts#236): the same
//! implementation the node entry runs — the EVS builder composes the
//! CEN/CENELEC one for the national adoptions — with the foreign
//! resolution wired to the worker-safe registry instead of the node
//! barrel. No `node:*` module appears in this graph and no wasm loads
//! — the evs grammar is the pure-TS parslet port, so the entry is
//! synchronous.
//!
//!     import { evsWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/evs/worker.js";
//!     const evs = evsWorkerGrammarImplementation();
//!     evs.parse("EVS-EN ISO 14001:2026"); // adoption → worker cen → worker iso
//!
//! Pass a resolver to widen or narrow the foreign set.

import type { FlavorImplementation } from "../../conformance/implementation.js";
import type { ForeignResolver } from "../foreign-resolver.js";
import { workerForeignResolver } from "../worker-registry.js";
import { evsGrammarImplementation } from "./index.js";

export function evsWorkerGrammarImplementation(
  foreign?: ForeignResolver,
): FlavorImplementation {
  return evsGrammarImplementation(foreign ?? workerForeignResolver());
}
