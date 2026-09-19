export interface IsoTypedStage {
  /** Owning identifier type key (is, tr, ts, amd, ...). */
  typeKey: string;
  code: string;
  stageCode: string;
  typeCode: string;
  abbr: string[];
  shortAbbr?: string | undefined;
  longAbbr?: string | undefined;
  harmonized?: string[] | undefined;
}

const TS = (typeKey: string, fields: Omit<IsoTypedStage, "typeKey">): IsoTypedStage =>
  ({ typeKey, ...fields });

/** All 129 typed stages dumped from Pubid::Iso.identifier_types (see model.ts). */
export const ISO_TYPED_STAGES: IsoTypedStage[] = [
  TS("amd", {
    code: "pwi_amd", stageCode: "proposal", typeCode: "amd", abbr: ["PWI Amd"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("amd", {
    code: "np_amd", stageCode: "proposal", typeCode: "amd", abbr: ["NP Amd"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("amd", {
    code: "awi_amd", stageCode: "preliminary", typeCode: "amd", abbr: ["AWI Amd"], harmonized: ["10.99", "20.00"]
  }),
  TS("amd", {
    code: "wd_amd", stageCode: "working_draft", typeCode: "amd", abbr: ["WD Amd"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("amd", {
    code: "committee_draft_amd", stageCode: "cd", typeCode: "amd", abbr: ["CD Amd"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("amd", {
    code: "pdam", stageCode: "cd", typeCode: "amd", abbr: ["PDAM"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("amd", {
    code: "damd", stageCode: "damd", typeCode: "amd", abbr: ["DAM", "DAmd"], shortAbbr: "DAM", harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("amd", {
    code: "fdamd", stageCode: "fdamd", typeCode: "amd", abbr: ["FDAM", "FDAmd"], shortAbbr: "FDAM", harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("amd", {
    code: "fpdam", stageCode: "fdamd", typeCode: "amd", abbr: ["FPDAM"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("amd", {
    code: "prf_amd", stageCode: "prf", typeCode: "amd", abbr: ["PRF Amd"], harmonized: ["50.00"]
  }),
  TS("amd", {
    code: "published", stageCode: "published", typeCode: "amd", abbr: ["Amd", "AMD", "Amd."], shortAbbr: "AMD", longAbbr: "Amd", harmonized: ["60.00", "60.60"]
  }),
  TS("cor", {
    code: "pwi_cor", stageCode: "proposal", typeCode: "cor", abbr: ["PWI Cor"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("cor", {
    code: "npcor", stageCode: "proposal", typeCode: "cor", abbr: ["NP Cor"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("cor", {
    code: "awicor", stageCode: "preliminary", typeCode: "cor", abbr: ["AWI Cor"], harmonized: ["10.99", "20.00"]
  }),
  TS("cor", {
    code: "wdcor", stageCode: "working_draft", typeCode: "cor", abbr: ["WD Cor"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("cor", {
    code: "cdcor", stageCode: "cd", typeCode: "cor", abbr: ["CD Cor", "pDCOR"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("cor", {
    code: "dcor", stageCode: "dcor", typeCode: "cor", abbr: ["DCor", "DCOR", "DIS Cor"], shortAbbr: "DCOR", longAbbr: "DCor", harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("cor", {
    code: "fdcor", stageCode: "fdcor", typeCode: "cor", abbr: ["FDCor", "FDCOR", "FCOR", "FDIS Cor"], shortAbbr: "FDCOR", longAbbr: "FDCor", harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("cor", {
    code: "prfcor", stageCode: "prf", typeCode: "cor", abbr: ["PRF Cor"], harmonized: ["50.00"]
  }),
  TS("cor", {
    code: "pubcor", stageCode: "published", typeCode: "cor", abbr: ["Cor", "COR", "Cor."], shortAbbr: "COR", longAbbr: "Cor", harmonized: ["60.00", "60.60"]
  }),
  TS("dir", {
    code: "pubguide", stageCode: "published", typeCode: "dir", abbr: ["DIR", "Directives Part", "Directives, Part", "Directives,", "Directives"], shortAbbr: "DIR", longAbbr: "Directives, Part", harmonized: ["60.00", "60.60"]
  }),
  TS("dir-sup", {
    code: "pubdirsup", stageCode: "published", typeCode: "dir-sup", abbr: ["DIR SUP", "SUP", "Supplement"], harmonized: ["60.00", "60.60"]
  }),
  TS("ext", {
    code: "pubext", stageCode: "published", typeCode: "ext", abbr: ["Ext"], harmonized: ["60.00", "60.60"]
  }),
  TS("guide", {
    code: "pwiis", stageCode: "pwi", typeCode: "guide", abbr: ["PWI Guide"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("guide", {
    code: "npguide", stageCode: "np", typeCode: "guide", abbr: ["NP Guide", "NP GUIDE"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98", "10.99"]
  }),
  TS("guide", {
    code: "awiguide", stageCode: "awi", typeCode: "guide", abbr: ["AWI Guide", "AWI GUIDE"], harmonized: ["10.99", "20.00"]
  }),
  TS("guide", {
    code: "wdguide", stageCode: "wd", typeCode: "guide", abbr: ["WD Guide", "WD GUIDE"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("guide", {
    code: "cdguide", stageCode: "cd", typeCode: "guide", abbr: ["CD Guide", "CD GUIDE"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("guide", {
    code: "dguide", stageCode: "dguide", typeCode: "guide", abbr: ["DGuide", "DGUIDE"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("guide", {
    code: "fdguide", stageCode: "fdguide", typeCode: "guide", abbr: ["FDGuide", "FD Guide", "FD GUIDE"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("guide", {
    code: "prfguide", stageCode: "prf", typeCode: "guide", abbr: ["PRF Guide", "PRF GUIDE"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("guide", {
    code: "pubguide", stageCode: "published", typeCode: "guide", abbr: ["Guide", "GUIDE"], harmonized: ["60.00", "60.60"]
  }),
  TS("is", {
    code: "isdp", stageCode: "dp", typeCode: "is", abbr: ["DP"]
  }),
  TS("is", {
    code: "pwiis", stageCode: "pwi", typeCode: "is", abbr: ["PWI"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("is", {
    code: "isnp", stageCode: "np", typeCode: "is", abbr: ["NP", "NWIP"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("is", {
    code: "awiis", stageCode: "awi", typeCode: "is", abbr: ["AWI"], harmonized: ["10.99", "20.00"]
  }),
  TS("is", {
    code: "wdis", stageCode: "wd", typeCode: "is", abbr: ["WD"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("is", {
    code: "wds", stageCode: "wds", typeCode: "is", abbr: ["WDS"], harmonized: ["20.20", "20.60"]
  }),
  TS("is", {
    code: "pcdis", stageCode: "pcd", typeCode: "is", abbr: ["preCD", "PreCD"], harmonized: ["29.00", "29.20", "29.60", "29.92", "29.93", "29.98", "29.99"]
  }),
  TS("is", {
    code: "cdis", stageCode: "cd", typeCode: "is", abbr: ["CD"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("is", {
    code: "dis", stageCode: "dis", typeCode: "is", abbr: ["DIS", "FPD"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("is", {
    code: "fcdis", stageCode: "fcd", typeCode: "is", abbr: ["FCD"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("is", {
    code: "fdis", stageCode: "fdis", typeCode: "is", abbr: ["FDIS"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("is", {
    code: "prfis", stageCode: "prf", typeCode: "is", abbr: ["PRF", "Fpr"], harmonized: ["60.00"]
  }),
  TS("is", {
    code: "is", stageCode: "published", typeCode: "is", abbr: ["", "IS"], harmonized: ["60.00", "60.60"]
  }),
  TS("is", {
    code: "wdr", stageCode: "wdr", typeCode: "is", abbr: ["WDR"], harmonized: ["90.92"]
  }),
  TS("is", {
    code: "wda", stageCode: "wda", typeCode: "is", abbr: ["WDA"], harmonized: ["90.93"]
  }),
  TS("is", {
    code: "wdar", stageCode: "wdar", typeCode: "is", abbr: ["WDAR"], harmonized: ["95.99"]
  }),
  TS("isp", {
    code: "pwiisp", stageCode: "pwi", typeCode: "isp", abbr: ["PWI ISP"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("isp", {
    code: "npisp", stageCode: "np", typeCode: "isp", abbr: ["NP ISP"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("isp", {
    code: "awiisp", stageCode: "awi", typeCode: "isp", abbr: ["AWI ISP"], harmonized: ["10.99", "20.00"]
  }),
  TS("isp", {
    code: "wdisp", stageCode: "wd", typeCode: "isp", abbr: ["WD ISP"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("isp", {
    code: "cdisp", stageCode: "cd", typeCode: "isp", abbr: ["CD ISP"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("isp", {
    code: "disp", stageCode: "disp", typeCode: "isp", abbr: ["DISP", "DIS ISP"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("isp", {
    code: "fdisp", stageCode: "fdis", typeCode: "isp", abbr: ["FDISP", "FDIS ISP"], harmonized: ["50.00", "50.20", "50.60", "50.92"]
  }),
  TS("isp", {
    code: "prfisp", stageCode: "prf", typeCode: "isp", abbr: ["PRF ISP"], harmonized: ["60.00"]
  }),
  TS("isp", {
    code: "isp", stageCode: "published", typeCode: "isp", abbr: ["ISP"], harmonized: ["60.00", "60.60"]
  }),
  TS("iwa", {
    code: "pwiiwa", stageCode: "pwi", typeCode: "iwa", abbr: ["PWI IWA"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("iwa", {
    code: "npiwa", stageCode: "np", typeCode: "iwa", abbr: ["NP IWA"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("iwa", {
    code: "awiiwa", stageCode: "awi", typeCode: "iwa", abbr: ["AWI IWA"], harmonized: ["10.99", "20.00"]
  }),
  TS("iwa", {
    code: "wdiwa", stageCode: "wd", typeCode: "iwa", abbr: ["WD IWA"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("iwa", {
    code: "cdiwa", stageCode: "cd", typeCode: "iwa", abbr: ["CD IWA"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("iwa", {
    code: "diwa", stageCode: "diwa", typeCode: "iwa", abbr: ["DIWA"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("iwa", {
    code: "prfiwa", stageCode: "prf", typeCode: "iwa", abbr: ["PRF IWA"], harmonized: ["50.00"]
  }),
  TS("iwa", {
    code: "iwa", stageCode: "published", typeCode: "iwa", abbr: ["IWA"], harmonized: ["60.00", "60.60"]
  }),
  TS("pas", {
    code: "pwipas", stageCode: "pwi", typeCode: "pas", abbr: ["PWI PAS"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("pas", {
    code: "nppas", stageCode: "np", typeCode: "pas", abbr: ["NP PAS"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("pas", {
    code: "awipas", stageCode: "awi", typeCode: "pas", abbr: ["AWI PAS"], harmonized: ["10.99", "20.00"]
  }),
  TS("pas", {
    code: "wdpas", stageCode: "wd", typeCode: "pas", abbr: ["WD PAS"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("pas", {
    code: "cdpas", stageCode: "cd", typeCode: "pas", abbr: ["CD PAS"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("pas", {
    code: "dpas", stageCode: "dpas", typeCode: "pas", abbr: ["DPAS"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("pas", {
    code: "fdpas", stageCode: "final_draft", typeCode: "pas", abbr: ["FDPAS"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("pas", {
    code: "prfpas", stageCode: "prf", typeCode: "pas", abbr: ["PRF PAS"], harmonized: ["60.00"]
  }),
  TS("pas", {
    code: "pas", stageCode: "published", typeCode: "pas", abbr: ["PAS"], harmonized: ["60.00", "60.60"]
  }),
  TS("rec", {
    code: "dp", stageCode: "np", typeCode: "rec", abbr: ["DP"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99", "10.00", "10.20", "10.60", "10.92", "10.93", "10.98", "10.99", "20.00", "20.20", "20.60", "20.92", "20.93", "20.98", "20.99", "30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99", "40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("rec", {
    code: "rec", stageCode: "published", typeCode: "rec", abbr: ["R"], harmonized: ["60.00", "60.60"]
  }),
  TS("tr", {
    code: "pwitr", stageCode: "pwi", typeCode: "tr", abbr: ["PWI TR"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("tr", {
    code: "nptr", stageCode: "np", typeCode: "tr", abbr: ["NP TR"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("tr", {
    code: "awitr", stageCode: "awi", typeCode: "tr", abbr: ["AWI TR"], harmonized: ["10.99", "20.00"]
  }),
  TS("tr", {
    code: "wdtr", stageCode: "wd", typeCode: "tr", abbr: ["WD TR"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("tr", {
    code: "cdtr", stageCode: "cd", typeCode: "tr", abbr: ["CD TR"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("tr", {
    code: "pdtr", stageCode: "cd", typeCode: "tr", abbr: ["PDTR"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("tr", {
    code: "dtr", stageCode: "draft", typeCode: "tr", abbr: ["DTR", "DIS TR"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("tr", {
    code: "fdtr", stageCode: "final_draft", typeCode: "tr", abbr: ["FDTR", "FDIS TR"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("tr", {
    code: "prftr", stageCode: "prf", typeCode: "tr", abbr: ["PRF TR"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("tr", {
    code: "pubtr", stageCode: "published", typeCode: "tr", abbr: ["TR"], harmonized: ["60.00", "60.60"]
  }),
  TS("ts", {
    code: "pwits", stageCode: "pwi", typeCode: "ts", abbr: ["PWI TS"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("ts", {
    code: "npts", stageCode: "np", typeCode: "ts", abbr: ["NP TS"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("ts", {
    code: "awits", stageCode: "awi", typeCode: "ts", abbr: ["AWI TS"], harmonized: ["10.99", "20.00"]
  }),
  TS("ts", {
    code: "wdts", stageCode: "wd", typeCode: "ts", abbr: ["WD TS"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("ts", {
    code: "cdts", stageCode: "cd", typeCode: "ts", abbr: ["CDTS", "CD TS"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("ts", {
    code: "pdts", stageCode: "cd", typeCode: "ts", abbr: ["PDTS"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("ts", {
    code: "dts", stageCode: "dts", typeCode: "ts", abbr: ["DTS"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("ts", {
    code: "fdts", stageCode: "fdts", typeCode: "ts", abbr: ["FDTS"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("ts", {
    code: "prfts", stageCode: "prf", typeCode: "ts", abbr: ["PRF TS"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("ts", {
    code: "pubts", stageCode: "published", typeCode: "ts", abbr: ["TS"], harmonized: ["60.00", "60.60"]
  }),
  TS("data", {
    code: "npdata", stageCode: "np", typeCode: "data", abbr: ["NP DATA"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("data", {
    code: "awidata", stageCode: "awi", typeCode: "data", abbr: ["AWI DATA"], harmonized: ["10.99", "20.00"]
  }),
  TS("data", {
    code: "wddata", stageCode: "wd", typeCode: "data", abbr: ["WD DATA"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("data", {
    code: "cddata", stageCode: "cd", typeCode: "data", abbr: ["CD DATA"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("data", {
    code: "ddata", stageCode: "ddata", typeCode: "data", abbr: ["D DATA"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("data", {
    code: "prfdata", stageCode: "prf", typeCode: "data", abbr: ["PRF DATA"], harmonized: ["60.00"]
  }),
  TS("data", {
    code: "pubdata", stageCode: "published", typeCode: "data", abbr: ["DATA"], harmonized: ["60.00", "60.60"]
  }),
  TS("suppl", {
    code: "pwisuppl", stageCode: "pwi", typeCode: "suppl", abbr: ["PWI Suppl"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("suppl", {
    code: "npsuppl", stageCode: "np", typeCode: "suppl", abbr: ["NP Suppl"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("suppl", {
    code: "awisuppl", stageCode: "awi", typeCode: "suppl", abbr: ["AWI Suppl"], harmonized: ["10.99", "20.00"]
  }),
  TS("suppl", {
    code: "wdsuppl", stageCode: "wd", typeCode: "suppl", abbr: ["WD Suppl"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("suppl", {
    code: "cdsuppl", stageCode: "cd", typeCode: "suppl", abbr: ["CD Suppl"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("suppl", {
    code: "dsuppl", stageCode: "dsuppl", typeCode: "suppl", abbr: ["DSuppl", "DIS Suppl"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("suppl", {
    code: "fdsuppl", stageCode: "fdsuppl", typeCode: "suppl", abbr: ["FDSuppl", "FDIS Suppl"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("suppl", {
    code: "prfsuppl", stageCode: "prf", typeCode: "suppl", abbr: ["PRF Suppl"], harmonized: ["50.00"]
  }),
  TS("suppl", {
    code: "pubsuppl", stageCode: "published", typeCode: "suppl", abbr: ["Suppl", "Suppl."], harmonized: ["60.00", "60.60"]
  }),
  TS("tta", {
    code: "pwitta", stageCode: "pwi", typeCode: "tta", abbr: ["PWI TTA"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("tta", {
    code: "nptta", stageCode: "np", typeCode: "tta", abbr: ["NP TTA"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("tta", {
    code: "awitta", stageCode: "awi", typeCode: "tta", abbr: ["AWI TTA"], harmonized: ["10.99", "20.00"]
  }),
  TS("tta", {
    code: "wdtta", stageCode: "wd", typeCode: "tta", abbr: ["WD TTA"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("tta", {
    code: "cdtta", stageCode: "cd", typeCode: "tta", abbr: ["CD TTA"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("tta", {
    code: "dtta", stageCode: "draft", typeCode: "tta", abbr: ["DTTA"], harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("tta", {
    code: "fdtta", stageCode: "final_draft", typeCode: "tta", abbr: ["FDTTA"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("tta", {
    code: "prftta", stageCode: "prf", typeCode: "tta", abbr: ["PRF TTA"], harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("tta", {
    code: "pubtta", stageCode: "published", typeCode: "tta", abbr: ["TTA"], harmonized: ["60.00", "60.60"]
  }),
  TS("add", {
    code: "pwi_add", stageCode: "proposal", typeCode: "add", abbr: ["PWI Add"], harmonized: ["00.00", "00.20", "00.60", "00.92", "00.93", "00.98", "00.99"]
  }),
  TS("add", {
    code: "np_add", stageCode: "proposal", typeCode: "add", abbr: ["NP Add"], harmonized: ["10.00", "10.20", "10.60", "10.92", "10.93", "10.98"]
  }),
  TS("add", {
    code: "awi_add", stageCode: "preliminary", typeCode: "add", abbr: ["AWI Add"], harmonized: ["10.99", "20.00"]
  }),
  TS("add", {
    code: "wd_add", stageCode: "working_draft", typeCode: "add", abbr: ["WD Add"], harmonized: ["20.20", "20.60", "20.92", "20.93", "20.98", "20.99"]
  }),
  TS("add", {
    code: "committee_draft_add", stageCode: "cd", typeCode: "add", abbr: ["CD Add"], harmonized: ["30.00", "30.20", "30.60", "30.92", "30.93", "30.98", "30.99"]
  }),
  TS("add", {
    code: "dad", stageCode: "dad", typeCode: "add", abbr: ["DAD", "DAdd", "D ADD", "Dad", "DIS Add"], shortAbbr: "DAD", harmonized: ["40.00", "40.20", "40.60", "40.92", "40.93", "40.98", "40.99"]
  }),
  TS("add", {
    code: "fdad", stageCode: "fdad", typeCode: "add", abbr: ["FDAD", "FDAdd", "FD ADD", "FDad", "FDIS Add"], shortAbbr: "FDAD", harmonized: ["50.00", "50.20", "50.60", "50.92", "50.98", "50.99"]
  }),
  TS("add", {
    code: "published", stageCode: "published", typeCode: "add", abbr: ["Add", "ADD", "Add.", "Addendum"], shortAbbr: "ADD", longAbbr: "Add", harmonized: ["60.00", "60.60"]
  }),
];
