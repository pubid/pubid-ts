import { describe, it, expect } from "vitest";

// The wasm arrives as a CompiledWasm module import — workerd compiles
// it at graph load (wrangler.worker.jsonc's rule) and the import
// yields the WebAssembly.Module the entry passes to `initialize()`.
// Production Workers declare the same rule in their own wrangler
// config (the *.wasm module declaration lives in wasm-module.d.ts).
import parsanolWasm from "../../node_modules/parsanol/vendor/parsanol-web/parsanol_bg.wasm";

import { nistWorkerGrammarImplementation } from "../../src/flavors/nist/worker.js";
import { ieeeWorkerGrammarImplementation } from "../../src/flavors/ieee/worker.js";
import { oimlWorkerGrammarImplementation } from "../../src/flavors/oiml/worker.js";
import { bsiWorkerGrammarImplementation } from "../../src/flavors/bsi/worker.js";
import { cenCenelecWorkerGrammarImplementation } from "../../src/flavors/cen_cenelec/worker.js";
import { csaWorkerGrammarImplementation } from "../../src/flavors/csa/worker.js";
import { gostWorkerGrammarImplementation } from "../../src/flavors/gost/worker.js";
import { evsWorkerGrammarImplementation } from "../../src/flavors/evs/worker.js";

// The issue #232 acceptance: the three flavors blocked on node:fs parse
// inside a worker (no nodejs_compat) through the new entries.

describe("worker parse (pubid-ts#232)", () => {
  it("parses NIST SP 800-53r5 through the nist worker entry", async () => {
    const nist = await nistWorkerGrammarImplementation(parsanolWasm);
    const id = nist.parse("NIST SP 800-53r5");
    expect(id.toHuman()).toBe("NIST SP 800-53r5");
  });

  it("parses IEEE Std 802.3-2022 through the ieee worker entry", async () => {
    const ieee = await ieeeWorkerGrammarImplementation({ wasm: parsanolWasm });
    const id = ieee.parse("IEEE Std 802.3-2022");
    expect(id.toHuman()).toBe("IEEE Std 802.3-2022");
  });

  it("parses OIML R 49-1:2024 through the oiml worker entry (no wasm)", () => {
    const oiml = oimlWorkerGrammarImplementation();
    const id = oiml.parse("OIML R 49-1:2024");
    expect(id.toHuman()).toBe("OIML R 49-1:2024");
  });

  it("routes the co-published ISO side through the parg-free iso entry", () => {
    const oiml = oimlWorkerGrammarImplementation();
    const id = oiml.parse("ISO 4064-1:2024|OIML R 49-1:2024");
    expect(id.toHuman()).toContain("OIML");
    expect(id.toHuman()).toContain("ISO");
  });
});

// The issue #236 acceptance: the shared-builder family (bsi,
// cen_cenelec, csa, gost) and its dependent (evs) — the flavors whose
// node barrel reached parg/runtime.js through the central
// grammarImplementation — parse inside a worker through the
// worker-safe registry. The adopted forms below are the ones that
// route FOREIGN (bsi→iso, cen→iso, csa→iso/iec, gost→iso, evs→cen→iso);
// the examples are attested in pubid-testsuite origin/main 4d185d8.
describe("worker parse, shared builders (pubid-ts#236)", () => {
  it("parses bsi plain and adopted identifiers (no wasm)", () => {
    const bsi = bsiWorkerGrammarImplementation();
    expect(bsi.parse("BS 10005:1995").toHuman()).toBe("BS 10005:1995");
    // The adopted form routes through tryForeign → the worker iso entry.
    expect(bsi.parse("BS EN ISO 105-B06:2020").toHuman())
      .toBe("BS EN ISO 105-B06:2020");
  });

  it("parses cen_cenelec plain and adopted identifiers (no wasm)", () => {
    const cen = cenCenelecWorkerGrammarImplementation();
    expect(cen.parse("EN 10160:1999").toHuman()).toBe("EN 10160:1999");
    expect(cen.parse("EN ISO 11140-3:2009").toHuman())
      .toBe("EN ISO 11140-3:2009");
  });

  it("parses csa plain and adopted identifiers (no wasm)", () => {
    const csa = csaWorkerGrammarImplementation();
    expect(csa.parse("CSA B149.1:20").toHuman()).toBe("CSA B149.1:20");
    expect(csa.parse("CSA ISO/IEC 8824-1:22").toHuman())
      .toBe("CSA ISO/IEC 8824-1:22");
  });

  it("parses gost plain and foreign-adoption identifiers (no wasm)", () => {
    const gost = gostWorkerGrammarImplementation();
    expect(gost.parse("GOST 14946-82").toHuman()).toBe("GOST 14946-82");
    expect(gost.parse("GOST 31425.2-2025/ISO 9902-2:2001").toHuman())
      .toBe("GOST 31425.2-2025/ISO 9902-2:2001");
  });

  it("parses evs national adoption and plain identifiers (no wasm)", () => {
    const evs = evsWorkerGrammarImplementation();
    expect(evs.parse("EVS-EN ISO 14001:2026").toHuman())
      .toBe("EVS-EN ISO 14001:2026");
    expect(evs.parse("EVS 811:2018 et-en").toHuman()).toBe("EVS 811:2018 et-en");
  });
});
