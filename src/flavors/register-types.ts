/**
 * The identifier-type registration manifest (pubid/pubid-ts#169): the
 * parg-free subset of the flavor graph, as side-effect imports only.
 *
 * Every flavor registers its model classes into the global type
 * registry ({@linkcode import("../model/identifier.js").registerType},
 * the *_TYPE_MAP role) from exactly one of its modules: the model
 * module when the flavor has one, the implementation entry otherwise.
 * The grammar barrel (`./index.js`) reaches the same modules
 * transitively — but it also statically imports the nist, ieee and
 * doi_pfs implementations, which pull `../parg/runtime.js`, whose
 * module scope walks up to a package.json through node:fs. That is
 * impossible in a worker bundle, so a worker cannot import the barrel
 * to populate the registry.
 *
 * This manifest imports the registration modules DIRECTLY, bypassing
 * every parg-tainted path:
 *
 * - model-registrant flavors: `<flavor>/model.js` — pure model
 *   declarations, no grammar wiring. (cen_cenelec, csa, gost, bsi and
 *   oiml entry modules import the barrel for co-publisher routing, so
 *   their model module is the only clean registration path.)
 * - index-registrant flavors: `<flavor>/index.js` — the class lives on
 *   the implementation entry; none of these statically reaches the
 *   parg runtime (the conformance gate is
 *   test/register-types.test.ts's import-graph walk).
 *
 * doi_pfs registers nothing by design ("one scheme, one `_type`, one
 * global resolution" — its canonical tag routes to the coded doi
 * class), so it has no entry here.
 *
 * The worker entry is dist/register-types.js (src/register-types.ts):
 * one import registers every flavor and exposes the pubid-scheme URN
 * codec with no node-only module in the graph.
 */

// Model-registrant flavors: registration lives in <flavor>/model.js.
import "./amca/model.js";
import "./api/model.js";
import "./ashrae/model.js";
import "./asme/model.js";
import "./astm/model.js";
import "./bsi/model.js";
import "./cen_cenelec/model.js";
import "./cie/model.js";
import "./csa/model.js";
import "./evs/model.js";
import "./gost/model.js";
import "./idf/model.js";
import "./iec/model.js";
import "./ieee/model.js";
import "./iso/model.js";
import "./itu/model.js";
import "./nist/model.js";
import "./oiml/model.js";

// Index-registrant flavors: registration lives in <flavor>/index.js.
import "./ansi/index.js";
import "./bipm/index.js";
import "./calconnect/index.js";
// ccsds (pubid-ts#178): the registration classes live on ccsds/model.js
// (parg-free); the index re-exports them beside the artifact-backed
// parse entry — but the index itself reaches parg/runtime.js, so the
// manifest imports the MODEL module like the model-registrant flavors.
import "./ccsds/model.js";
import "./doi/index.js";
import "./easc/index.js";
import "./ecma/index.js";
import "./etsi/index.js";
import "./gb/index.js";
import "./iala/index.js";
import "./iana/index.js";
import "./ietf/index.js";
import "./iho/index.js";
import "./isbn/index.js";
import "./jcgm/index.js";
import "./jis/index.js";
import "./ogc/index.js";
import "./oasis/index.js";
import "./omg/index.js";
import "./plateau/index.js";
import "./tgpp/index.js";
import "./un/index.js";
import "./w3c/index.js";
import "./xsf/index.js";
