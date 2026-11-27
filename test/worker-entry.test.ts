import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Worker-safe parse for the artifact-backed flavors (pubid-ts#232).
//
// A worker has no disk, so the artifact cannot come from vendor/parg and
// the wasm engine cannot load itself. This file simulates that: the
// disk path points at an EMPTY directory, so every artifact must come
// from the registry, and the engine is parsanol's web build, initialized
// from the wasm bytes the consumer hands over (in a worker: a wasm module
// import of dist/parg/parsanol_bg.wasm).
//
// The env var is set before any pubid module loads (dynamic imports
// below), so no load can reach the vendored artifacts.
process.env["PARG_ARTIFACT_DIR"] = mkdtempSync(join(tmpdir(), "pubid-no-artifacts-"));

const WEB_WASM = "node_modules/parsanol/vendor/parsanol-web/parsanol_bg.wasm";

const SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ["nist", "NIST SP 800-53r5"],
  ["nist", "urn:nist:sp:800-53.r5.supp"],
  ["ieee", "IEEE Std 802.3-2018"],
  // The ANSI-led spelling routes through the ansi artifact (registered
  // by the ieee worker entry) and back.
  ["ieee", "ANSI/IEEE C37.09-1979"],
  ["oiml", "OIML R 60-1:2021"],
  // The co-publisher side parses through the barrel's iso flavor.
  ["oiml", "ISO 4064-1:2024|OIML R 49-1:2024"],
];

interface Rendered {
  human: string;
  urn: string | undefined;
  hash: Record<string, unknown>;
}

interface Renderable {
  toHuman(): string;
  toUrn(): string | undefined;
  toHash(): Record<string, unknown>;
}

function render(id: Renderable): Rendered {
  return { human: id.toHuman(), urn: id.toUrn(), hash: id.toHash() };
}

/** The same samples on the node path (the node engine, vendor/parg), in
 * a child process: this process has no artifact file by design. */
function nodePathRenders(): Rendered[] {
  const barrel = new URL("../src/flavors/index.js", import.meta.url).href;
  const script = `
    const { grammarImplementation } = await import(${JSON.stringify(barrel)});
    const samples = ${JSON.stringify(SAMPLES)};
    const out = samples.map(([flavor, input]) => {
      const id = grammarImplementation(flavor).parse(input);
      return { human: id.toHuman(), urn: id.toUrn(), hash: id.toHash() };
    });
    process.stdout.write(JSON.stringify(out));
  `;
  // vendor/parg, the source of the artifact modules the web side runs —
  // not a sibling checkout that may be ahead of or behind it.
  const env = { ...process.env, PARG_ARTIFACT_DIR: join(process.cwd(), "vendor/parg") };
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env,
    encoding: "utf8",
  });
  return JSON.parse(stdout) as Rendered[];
}

test("a load with no registered artifact and no artifact file fails with PargArtifactUnavailable", async () => {
  const { PubidRuntime, PargArtifactUnavailable } = await import("../src/parg/runtime.js");
  assert.throws(
    () => PubidRuntime.load("nist"),
    (e: unknown) => e instanceof PargArtifactUnavailable && e.grammar === "nist",
  );
});

test("with no process.getBuiltinModule (a worker), an unregistered load fails with PargArtifactUnavailable", () => {
  // A child process, so the stub cannot leak into this file's other tests.
  const runtime = new URL("../src/parg/runtime.js", import.meta.url).href;
  const script = `
    process.getBuiltinModule = undefined;
    const { PubidRuntime, PargArtifactUnavailable, registerArtifact } = await import(${JSON.stringify(runtime)});
    let unavailable = false;
    try { PubidRuntime.load("ccsds"); } catch (e) { unavailable = e instanceof PargArtifactUnavailable && e.grammar === "ccsds"; }
    registerArtifact("ccsds", ${JSON.stringify(readFileSync("vendor/parg/ccsds.json", "utf8"))});
    const loaded = PubidRuntime.load("ccsds").parseShape("CCSDS 133.0-B-2") !== null;
    process.stdout.write(JSON.stringify({ unavailable, loaded }));
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(stdout), { unavailable: true, loaded: true });
});

test("PARG_GRAMMARS lists exactly the grammars the flavors load", async () => {
  const { PARG_GRAMMARS } = await import("../src/worker.js");
  const loaded = new Set<string>();
  for (const flavor of readdirSync("src/flavors")) {
    let source: string;
    try {
      source = readFileSync(join("src/flavors", flavor, "index.ts"), "utf8");
    } catch {
      continue;
    }
    for (const m of source.matchAll(/PubidRuntime\.load\("([a-z_]+)"/g)) loaded.add(m[1]!);
  }
  assert.deepEqual([...PARG_GRAMMARS].sort(), [...loaded].sort());
});

test("each artifact module carries its vendored artifact byte for byte", async () => {
  const { PARG_GRAMMARS } = await import("../src/worker.js");
  for (const grammar of PARG_GRAMMARS) {
    const mod = (await import(`../src/parg/artifacts/${grammar}.js`)) as { default: string };
    assert.equal(
      mod.default,
      readFileSync(join("vendor/parg", `${grammar}.json`), "utf8"),
      `src/parg/artifacts/${grammar}.ts is stale against vendor/parg — run npm run artifact:modules`,
    );
  }
});

test("nist, ieee and oiml parse on the web engine with no artifact file", async () => {
  const { initPargEngine } = await import("../src/worker.js");
  const { PubidRuntime } = await import("../src/parg/runtime.js");
  const { PargRuntime: WebPargRuntime } = await import("parsanol/browser");
  const { nistWorkerImplementation } = await import("../src/flavors/nist/worker.js");
  const { ieeeWorkerImplementation } = await import("../src/flavors/ieee/worker.js");
  const { oimlGrammarImplementation } = await import("../src/flavors/oiml/index.js");

  const wasm = readFileSync(WEB_WASM);
  const nist = await nistWorkerImplementation(wasm);
  const ieee = await ieeeWorkerImplementation(wasm);
  // A second init is a no-op (the cached promise).
  await initPargEngine(wasm);

  // The registry served the artifact, and the web engine runs it.
  assert.ok(PubidRuntime.load("nist") instanceof WebPargRuntime);

  const impls: Record<string, { parse(input: string): Renderable }> = {
    nist,
    ieee,
    oiml: oimlGrammarImplementation(),
  };
  const worker = SAMPLES.map(([flavor, input]) => render(impls[flavor]!.parse(input)));
  assert.equal(worker[0]!.human, "NIST SP 800-53r5");
  assert.equal(worker[1]!.human, "NIST SP 800-53r5");
  // The web engine and the node engine run the same artifact: the same
  // identifier, field for field.
  assert.deepEqual(worker, nodePathRenders());
});
