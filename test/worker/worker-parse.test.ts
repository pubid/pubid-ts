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
