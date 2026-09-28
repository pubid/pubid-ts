//! T3: external *.pgtest suites run through the wasm runtime. The suite
//! syntax matches the Ruby loader (Parsanol::PG::Suite): a
//! `suite <name> [for <entry>] { ... }` header with accept / reject /
//! example lines. Green means Ruby and TypeScript agree on the contract.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PgRuntime } from "./runtime.js";

export type TestKind = "accept" | "reject" | "example";

export interface SuiteTest {
  kind: TestKind;
  input: string;
  expect?: Record<string, string>;
}

export interface Suite {
  name: string;
  entry?: string;
  tests: SuiteTest[];
}

const LINE = /^\s*(accept|reject|example)\s+"((?:[^"\\]|\\.)*)"(?:\s*\{([^}]*)\})?\s*$/;
const HEADER = /suite\s+(\w+)(?:\s+for\s+entry\s+(\w+))?\s*\{/;

/** Parse one *.pgtest file (same grammar as Parsanol::PG::Suite#read_file). */
export function readSuite(text: string, name: string): Suite {
  const body = text.replace(/^#[^\n]*\n/gm, "");
  const header = HEADER.exec(body);
  if (!header) {
    throw new Error(`${name}: expected 'suite <name> [for <entry>] { ... }'`);
  }
  const tests: SuiteTest[] = [];
  for (const line of body.slice((header.index ?? 0) + header[0].length).split("\n")) {
    if (line.trim() === "}") break;
    const match = LINE.exec(line);
    if (!match) continue;
    const kind = match[1] as TestKind;
    const rawInput = match[2] ?? "";
    const input = JSON.parse(`"${rawInput}"`) as string;
    const expect: Record<string, string> = {};
    if (match[3]) {
      for (const pair of match[3].split(",")) {
        const kv = /(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(pair);
        const key = kv?.[1];
        const raw = kv?.[2];
        if (key && raw !== undefined) expect[key] = JSON.parse(`"${raw}"`) as string;
      }
    }
    tests.push(kind === "example" ? { kind, input, expect } : { kind, input });
  }
  const entry = header[2];
  return entry === undefined
    ? { name: header[1] ?? "suite", tests }
    : { name: header[1] ?? "suite", entry, tests };
}

/** Load every *.pgtest file in a directory. */
export function loadSuites(dir: string): Suite[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".pgtest"))
    .map((file) => readSuite(readFileSync(join(dir, file), "utf8"), file.replace(/\.pgtest$/, "")));
}

/** Run a suite against a runtime; returns failure descriptions. */
export function runSuite(runtime: PgRuntime, suite: Suite): string[] {
  const failures: string[] = [];
  const entry = suite.entry ?? runtime.entry;
  for (const test of suite.tests) {
    // The wasm runtime throws on parse failure; that is the reject signal.
    let bound: string | null = null;
    try {
      bound = runtime.artifact.parseAndBind(entry, test.input) as string;
    } catch {
      bound = null;
    }
    if (test.kind === "reject") {
      if (bound !== null) {
        failures.push(`test ${JSON.stringify(test.input)}: expected the input to be rejected`);
      }
      continue;
    }
    if (bound === null) {
      failures.push(`test ${JSON.stringify(test.input)}: expected the input to parse`);
      continue;
    }
    if (test.kind === "example") {
      const parsed = JSON.parse(bound) as Record<string, unknown>;
      for (const [key, value] of Object.entries(test.expect ?? {})) {
        if (parsed[key] !== value) {
          failures.push(
            `test ${JSON.stringify(test.input)}: expected captures ${key}: ${JSON.stringify(value)}, got ${JSON.stringify(parsed[key])}`,
          );
        }
      }
    }
  }
  return failures;
}

/** The default suites directory (the pubid-grammar checkout). */
export function suitesDir(): string {
  const env = process.env.PG_SUITES_DIR;
  if (env) return env;
  return join(PgRuntime.artifactsDir(), "..", "suites");
}
