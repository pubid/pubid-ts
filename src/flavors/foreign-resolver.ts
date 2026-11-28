//! The foreign-flavor resolution seam for the shared-builder flavors
//! (pubid/pubid-ts#236): bsi, cen_cenelec, csa, gost and evs route
//! adopted identifiers to other flavors' implementations. The node
//! barrel (src/flavors/index.ts) supplies the full central registry;
//! the worker entries supply the worker-safe subset
//! (src/flavors/worker-registry.ts). The type is dependency-free so
//! both sides — and the flavor modules themselves — can name it
//! without dragging either graph.

import type { FlavorImplementation } from "../conformance/implementation.js";

/** Resolve another flavor's grammar implementation, or undefined when
 * the resolver's flavor set does not cover it (a worker resolver over
 * the worker-available subset answers undefined for the parg-backed
 * flavors it does not carry). */
export type ForeignResolver = (
  flavor: string,
) => FlavorImplementation | undefined;
