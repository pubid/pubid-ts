import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// The worker-execution gate for pubid-ts#232: the worker entries must
// parse inside workerd with NO nodejs_compat. The parsanol wasm rides
// the OFFICIAL CompiledWasm module rule declared in
// wrangler.worker.jsonc — the same rule a production Workers consumer
// declares in its own wrangler config (see the README worker section).
// workerd compiles the module at graph load; the entry's
// `initialize(module)` then instantiates it, no dynamic codegen.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.worker.jsonc" },
    }),
  ],
  test: {
    include: ["test/worker/**/*.test.ts"],
  },
});
