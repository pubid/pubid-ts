#!/usr/bin/env node
// Copies parsanol's web-target engine (the pinned parsanol version) to
// dist/parg/parsanol_bg.wasm. A worker imports it as a wasm module and
// hands it to initPargEngine (dist/worker.js): parsanol's exports map
// does not expose the file, so the copy is the importable path until
// parsanol-ts exports it.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const browserEntry = require.resolve("parsanol/browser");
const wasm = join(dirname(browserEntry), "..", "vendor", "parsanol-web", "parsanol_bg.wasm");
mkdirSync("dist/parg", { recursive: true });
copyFileSync(wasm, "dist/parg/parsanol_bg.wasm");
