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
 * covers every flavor in a worker. The grammar-backed
 * `grammarImplementation` (open-ended parse routing) deliberately stays
 * behind the node-only barrel: it cannot load in a worker today.
 */
import "./flavors/register-types.js";

export * as PubidUrn from "./pubid-urn/index.js";
