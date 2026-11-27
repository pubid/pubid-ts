/**
 * The worker-safe entry (pubid/pubid-ts#169): one import registers
 * every flavor's identifier types and exposes the pubid-scheme URN
 * codec — with no node-only module in the import graph.
 *
 * `dist/pubid-urn/index.js` alone decodes nothing on a worker ("unknown
 * identifier type …"), because the type registry lives in
 * {@linkcode import("./model/identifier.js").resolveType} and is
 * populated by importing flavor modules; every existing path to those
 * modules (the grammar barrel `dist/flavors/index.js`, or the root
 * `dist/index.js`) drags `dist/parg/runtime.js`, whose module scope
 * walks up to a package.json through node:fs — impossible in a worker
 * bundle. This entry composes the parg-free registration manifest
 * (./flavors/register-types.js) with the codec, so
 *
 *     import { PubidUrn } from "@pubid/pubid/register-types.js";
 *
 * covers every flavor in a worker. Since pubid-ts#232 the parg runtime
 * itself is worker-safe, so the barrel loads in a worker too; this entry
 * stays the light path (no parsanol, no parse grammars). The grammar-backed
 * `grammarImplementation` (open-ended parse routing) has its own worker
 * entry, `dist/worker.js` (src/worker.ts).
 */
import "./flavors/register-types.js";

export * as PubidUrn from "./pubid-urn/index.js";
