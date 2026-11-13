/**
 * The registry of all 47 flavor pubid-urn schema tables — the TS mirror
 * of lib/pubid.rb's autoloaded Pubid::<Flavor>::PubidUrnSchema chain.
 * Declared tables only: importing this module has no side effects; the
 * pubid-urn module builds its flavor lookup lazily from this array.
 */

import type { FlavorSchema } from "../schema.js";
import { adobeSchema } from "./adobe.js";
import { amcaSchema } from "./amca.js";
import { ansiSchema } from "./ansi.js";
import { apiSchema } from "./api.js";
import { ashraeSchema } from "./ashrae.js";
import { asmeSchema } from "./asme.js";
import { astmSchema } from "./astm.js";
import { bipmSchema } from "./bipm.js";
import { bsiSchema } from "./bsi.js";
import { calconnectSchema } from "./calconnect.js";
import { calconnectPfsSchema } from "./calconnect_pfs.js";
import { ccsdsSchema } from "./ccsds.js";
import { cencenelecSchema } from "./cencenelec.js";
import { cieSchema } from "./cie.js";
import { csaSchema } from "./csa.js";
import { doiSchema } from "./doi.js";
import { doiPfsSchema } from "./doi_pfs.js";
import { eascSchema } from "./easc.js";
import { ecmaSchema } from "./ecma.js";
import { etsiSchema } from "./etsi.js";
import { etsiPfsSchema } from "./etsi_pfs.js";
import { evsSchema } from "./evs.js";
import { gbSchema } from "./gb.js";
import { gostSchema } from "./gost.js";
import { ialaSchema } from "./iala.js";
import { ianaSchema } from "./iana.js";
import { idfSchema } from "./idf.js";
import { iecSchema } from "./iec.js";
import { ieeeSchema } from "./ieee.js";
import { ietfSchema } from "./ietf.js";
import { ihoSchema } from "./iho.js";
import { isbnSchema } from "./isbn.js";
import { isoSchema } from "./iso.js";
import { ituSchema } from "./itu.js";
import { jcgmSchema } from "./jcgm.js";
import { jisSchema } from "./jis.js";
import { nistSchema } from "./nist.js";
import { oasisSchema } from "./oasis.js";
import { ogcSchema } from "./ogc.js";
import { oimlSchema } from "./oiml.js";
import { omgSchema } from "./omg.js";
import { plateauSchema } from "./plateau.js";
import { saeSchema } from "./sae.js";
import { tgppSchema } from "./tgpp.js";
import { unSchema } from "./un.js";
import { w3cSchema } from "./w3c.js";
import { xsfSchema } from "./xsf.js";

/** All flavor schemas, in the ruby registry order (alphabetical by module). */
export const PUBID_URN_SCHEMAS: FlavorSchema[] = [
  adobeSchema,
  amcaSchema,
  ansiSchema,
  apiSchema,
  ashraeSchema,
  asmeSchema,
  astmSchema,
  bipmSchema,
  bsiSchema,
  calconnectSchema,
  calconnectPfsSchema,
  ccsdsSchema,
  cencenelecSchema,
  cieSchema,
  csaSchema,
  doiSchema,
  doiPfsSchema,
  eascSchema,
  ecmaSchema,
  etsiSchema,
  etsiPfsSchema,
  evsSchema,
  gbSchema,
  gostSchema,
  ialaSchema,
  ianaSchema,
  idfSchema,
  iecSchema,
  ieeeSchema,
  ietfSchema,
  ihoSchema,
  isbnSchema,
  isoSchema,
  ituSchema,
  jcgmSchema,
  jisSchema,
  nistSchema,
  oasisSchema,
  ogcSchema,
  oimlSchema,
  omgSchema,
  plateauSchema,
  saeSchema,
  tgppSchema,
  unSchema,
  w3cSchema,
  xsfSchema,
];

