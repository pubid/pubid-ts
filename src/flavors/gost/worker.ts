//! The worker entry for the gost flavor (pubid/pubid-ts#236): the same
//! implementation the node entry runs, with the adopted-identifier
//! resolution wired to the worker-safe registry instead of the node
//! barrel. No `node:*` module appears in this graph and no wasm loads
//! — the gost grammar is the pure-TS parslet port, so the entry is
//! synchronous.
//!
//!     import { gostWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/gost/worker.js";
//!     const gost = gostWorkerGrammarImplementation();
//!     gost.parse("GOST 31425.2-2025/ISO 9902-2:2001"); // adoption → worker iso
//!
//! The FOREIGN_FALLBACK_ORDER walk runs over the worker-available
//! flavors only — the honest answer in a worker, where the parg-backed
//! flavors have no worker implementation. Widen it by merging the parg
//! worker entries in: `workerForeignResolverWith({ ieee: await
//! ieeeWorkerGrammarImplementation(wasm) })` passed as the resolver.

import type { FlavorImplementation } from "../../conformance/implementation.js";
import type { ForeignResolver } from "../foreign-resolver.js";
import { workerForeignResolver } from "../worker-registry.js";
import { gostGrammarImplementation } from "./index.js";

export function gostWorkerGrammarImplementation(
  foreign?: ForeignResolver,
): FlavorImplementation {
  return gostGrammarImplementation(foreign ?? workerForeignResolver());
}
