//! The worker-safe grammar registry for the shared-builder flavors
//! (pubid/pubid-ts#236): a `ForeignResolver` over the flavors whose
//! implementations carry no `node:*` module — the pure-TS parslet
//! ports plus the worker entries #232 shipped (oiml rides its worker
//! entry; iso and iec are parg-free node entries). This is what the
//! central barrel (`flavors/index.js`) CANNOT be in a worker: it
//! statically imports the parg-backed flavors (nist, ieee, ansi,
//! arxiv, doi_pfs, …), whose implementations reach
//! `parg/runtime.js` — a module scope that walks to a package.json
//! through `node:fs`.
//!
//! The five shared builders (bsi, cen_cenelec, csa, gost, evs) take a
//! `ForeignResolver` parameter for exactly this: the node barrel wires
//! the full central registry, the per-flavor worker entries wire this
//! subset. The gost-style fallback walks then run over the
//! worker-available flavors only — the honest answer for a worker,
//! where the parg-backed flavors have no worker implementation yet
//! (a consumer can inject them via their `*/worker.js` entries with
//! `workerForeignResolverWith`).
//!
//! No `node:*` module and nothing beyond relative imports appears in
//! this graph — pinned by `test/worker-graph.test.ts`.

import type { FlavorImplementation } from "../conformance/implementation.js";
import type { ForeignResolver } from "./foreign-resolver.js";
import { oimlWorkerGrammarImplementation } from "./oiml/worker.js";
import { xsfGrammarImplementation } from "./xsf/index.js";
import { doiGrammarImplementation } from "./doi/index.js";
import { ianaGrammarImplementation } from "./iana/index.js";
import { unGrammarImplementation } from "./un/index.js";
import { plateauGrammarImplementation } from "./plateau/index.js";
import { w3cGrammarImplementation } from "./w3c/index.js";
import { omgGrammarImplementation } from "./omg/index.js";
import { ogcGrammarImplementation } from "./ogc/index.js";
import { isbnGrammarImplementation } from "./isbn/index.js";
import { eascGrammarImplementation } from "./easc/index.js";
import { ecmaGrammarImplementation } from "./ecma/index.js";
import { tgppGrammarImplementation } from "./tgpp/index.js";
import { oasisGrammarImplementation } from "./oasis/index.js";
import { ihoGrammarImplementation } from "./iho/index.js";
import { calconnectGrammarImplementation } from "./calconnect/index.js";
import { gbGrammarImplementation } from "./gb/index.js";
import { jcgmGrammarImplementation } from "./jcgm/index.js";
import { etsiGrammarImplementation } from "./etsi/index.js";
import { jisGrammarImplementation } from "./jis/index.js";
import { iecGrammarImplementation } from "./iec/index.js";
import { cieGrammarImplementation } from "./cie/index.js";
import { bipmGrammarImplementation } from "./bipm/index.js";
import { isoGrammarImplementation } from "./iso/index.js";
import { cenCenelecGrammarImplementation } from "./cen_cenelec/index.js";
import { astmGrammarImplementation } from "./astm/index.js";
import { idfGrammarImplementation } from "./idf/index.js";
import { gostGrammarImplementation } from "./gost/index.js";
import { evsGrammarImplementation } from "./evs/index.js";
import { ashraeGrammarImplementation } from "./ashrae/index.js";
import { bsiGrammarImplementation } from "./bsi/index.js";
import { csaGrammarImplementation } from "./csa/index.js";
import { asmeGrammarImplementation } from "./asme/index.js";
import { amcaGrammarImplementation } from "./amca/index.js";
import { apiGrammarImplementation } from "./api/index.js";
import { ituGrammarImplementation } from "./itu/index.js";
import { ietfGrammarImplementation } from "./ietf/index.js";
import { ialaGrammarImplementation } from "./iala/index.js";

/** The worker-available flavor implementations, wired to each other:
 * every member's foreign lookups run over this same set (so bsi's
 * adopted ISO routing, cen_cenelec's implicit IEC adoption and gost's
 * fallback walk all resolve within the subset). */
export function workerForeignResolver(): ForeignResolver {
  // The self-referencing wire: the resolver closes over the map, the
  // shared builders receive the resolver, resolution happens at parse
  // time.
  const resolve: ForeignResolver = (flavor) => map[flavor];
  const map: Record<string, FlavorImplementation> = {
    oiml: oimlWorkerGrammarImplementation(),
    xsf: xsfGrammarImplementation(),
    doi: doiGrammarImplementation(),
    iana: ianaGrammarImplementation(),
    un: unGrammarImplementation(),
    plateau: plateauGrammarImplementation(),
    w3c: w3cGrammarImplementation(),
    omg: omgGrammarImplementation(),
    ogc: ogcGrammarImplementation(),
    isbn: isbnGrammarImplementation(),
    easc: eascGrammarImplementation(),
    ecma: ecmaGrammarImplementation(),
    tgpp: tgppGrammarImplementation(),
    oasis: oasisGrammarImplementation(),
    iho: ihoGrammarImplementation(),
    calconnect: calconnectGrammarImplementation(),
    gb: gbGrammarImplementation(),
    jcgm: jcgmGrammarImplementation(),
    etsi: etsiGrammarImplementation(),
    jis: jisGrammarImplementation(),
    iec: iecGrammarImplementation(),
    cie: cieGrammarImplementation(),
    bipm: bipmGrammarImplementation(),
    iso: isoGrammarImplementation(),
    cen_cenelec: cenCenelecGrammarImplementation(resolve),
    astm: astmGrammarImplementation(),
    idf: idfGrammarImplementation(),
    gost: gostGrammarImplementation(resolve),
    evs: evsGrammarImplementation(resolve),
    ashrae: ashraeGrammarImplementation(),
    bsi: bsiGrammarImplementation(resolve),
    csa: csaGrammarImplementation(resolve),
    asme: asmeGrammarImplementation(),
    amca: amcaGrammarImplementation(),
    api: apiGrammarImplementation(),
    itu: ituGrammarImplementation(),
    ietf: ietfGrammarImplementation(),
    iala: ialaGrammarImplementation(),
  };
  return resolve;
}

/** A resolver over an extended flavor set: the worker subset with the
 * caller's additions merged over it (e.g. the parg-backed flavors via
 * the worker entries #232 shipped — `nistWorkerGrammarImplementation` /
 * `ieeeWorkerGrammarImplementation` — once the caller has awaited
 * them). */
export function workerForeignResolverWith(
  extra: Record<string, FlavorImplementation>,
): ForeignResolver {
  const base = workerForeignResolver();
  return (flavor) => extra[flavor] ?? base(flavor);
}
