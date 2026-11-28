//! The worker entry for the bsi flavor (pubid/pubid-ts#236): the same
//! implementation the node entry runs, with the foreign-flavor
//! resolution (the adopted ISO/IEC/CEN routing) wired to the
//! worker-safe registry instead of the node barrel. No `node:*` module
//! appears in this graph and no wasm loads — the bsi grammar is the
//! pure-TS parslet port, so the entry is synchronous.
//!
//!     import { bsiWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/bsi/worker.js";
//!     const bsi = bsiWorkerGrammarImplementation();
//!     bsi.parse("BS EN ISO 105-B06:2020"); // adopted routing → worker iso
//!
//! Pass a resolver to widen or narrow the foreign set (e.g. merged with
//! the parg worker entries via `workerForeignResolverWith`).

import type { FlavorImplementation } from "../../conformance/implementation.js";
import type { ForeignResolver } from "../foreign-resolver.js";
import { workerForeignResolver } from "../worker-registry.js";
import { bsiGrammarImplementation } from "./index.js";

export function bsiWorkerGrammarImplementation(
  foreign?: ForeignResolver,
): FlavorImplementation {
  return bsiGrammarImplementation(foreign ?? workerForeignResolver());
}
