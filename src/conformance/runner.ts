import type { CorpusCase } from "../corpus/types.js";
import { isErrorCase, isQuarantined, isReview } from "../corpus/types.js";
import type { FlavorPayloads } from "../corpus/loader.js";
import type { ImplementationRegistry, FlavorImplementation } from "./implementation.js";
import type { PendingRegistry } from "./pending.js";

export interface FlavorReport {
  flavor: string;
  outcome:
    | "pass"
    | "fail"
    | "unimplemented"
    | "ledger";
  cases: number;
  errors: number;
  quarantined: number;
  failures: string[];
  pending: number;
  pendingSatisfied: string[];
  reclassified: number;
  review: number;
}

export interface RunReport {
  flavors: FlavorReport[];
  /** FAIL on any clean flavor; unimplemented flavors report, never gate. */
  gate: "pass" | "fail";
}

/**
 * One corpus case -> its mismatch list (empty == passing). List-shaped
 * for the same reason as the Ruby core: control flow must not depend on
 * exception mechanics to know whether a case passed.
 */
export function checkCase(
  testCase: CorpusCase,
  impl: FlavorImplementation,
): string[] {
  const label = testCase.id;
  let identifier;
  try {
    identifier = impl.parse(testCase.representations.human);
  } catch (error) {
    return [`${label} raised ${(error as Error).name}`];
  }

  const mismatches: string[] = [];
  if (!deepEqual(identifier.toHash(), testCase.identifier)) {
    mismatches.push(`${label} canonical hash`);
  }
  if (identifier.toHuman() !== testCase.representations.human) {
    mismatches.push(`${label} human`);
  }
  if (testCase.representations.urn !== undefined) {
    const urn = identifier.toUrn();
    if (urn !== testCase.representations.urn) mismatches.push(`${label} urn`);
  }
  for (const alias of testCase.nonNormalizedAliases ?? []) {
    try {
      const aliased = impl.parse(alias.spelling);
      if (aliased.toHuman() !== testCase.representations.human) {
        mismatches.push(`${label} alias ${alias.spelling}`);
      }
    } catch {
      mismatches.push(`${label} alias ${alias.spelling} raised`);
    }
  }
  try {
    const hash = identifier.toHash();
    if (!deepEqual(identifier.fromHash(hash).toHash(), hash)) {
      mismatches.push(`${label} deserialize`);
    }
  } catch {
    mismatches.push(`${label} deserialize raised`);
  }
  return mismatches;
}

/** Negatives: expect-error rows must be rejected; the rest are the exporter's reclassify alarms. */
export function checkNegatives(
  payloads: FlavorPayloads,
  impl: FlavorImplementation,
): { failures: string[]; reclassified: number } {
  const failures: string[] = [];
  let reclassified = 0;
  for (const row of payloads.negatives) {
    if (!isErrorCase(row)) {
      reclassified += 1;
      continue;
    }
    if (row.input === undefined) continue;

    try {
      impl.parse(row.input);
      failures.push(`${row.id} unexpectedly parsed`);
    } catch {
      // rejected as expected
    }
  }
  return { failures, reclassified };
}

export function runFlavor(
  flavor: string,
  payloads: FlavorPayloads,
  impl: FlavorImplementation | undefined,
  pending: PendingRegistry,
): FlavorReport {
  const report: FlavorReport = {
    flavor,
    outcome: "pass",
    cases: 0,
    errors: 0,
    quarantined: 0,
    failures: [],
    pending: 0,
    pendingSatisfied: [],
    reclassified: 0,
    review: 0,
  };

  if (impl === undefined) {
    // Unimplemented flavors still report their full corpus footprint so
    // the report proves corpus-wide operability of the harness itself;
    // they never gate (waves activate the gate per flavor).
    report.cases = payloads.cases.filter((c) => c.representations !== undefined).length;
    report.errors = payloads.negatives.filter(isErrorCase).length;
    report.reclassified = payloads.negatives.length - report.errors;
    report.review = payloads.cases.filter(isReview).length;
    report.outcome = "unimplemented";
    return report;
  }

  for (const testCase of payloads.cases) {
    if (isReview(testCase)) {
      report.review += 1;
      continue;
    }
    if (isErrorCase(testCase)) {
      report.errors += 1;
      if (testCase.input !== undefined) {
        try {
          impl.parse(testCase.input);
          report.failures.push(`${testCase.id} unexpectedly parsed`);
        } catch {
          // rejected as expected
        }
      }
      continue;
    }
    if (isQuarantined(testCase)) {
      report.quarantined += 1;
      continue;
    }

    const mismatches = checkCase(testCase, impl);
    if (pending.has(testCase.id)) {
      report.pending += 1;
      if (mismatches.length === 0) report.pendingSatisfied.push(testCase.id);
    } else {
      report.cases += 1;
      report.failures.push(...mismatches);
    }
  }

  const negativeRun = checkNegatives(payloads, impl);
  report.failures.push(...negativeRun.failures);
  report.reclassified = negativeRun.reclassified;

  // Dirty flavors report as the ledger; only their pass/fail shape is
  // recorded - the clean gate below never consults them.
  report.outcome = payloads.status.clean
    ? report.failures.length === 0
      ? "pass"
      : "fail"
    : "ledger";
  return report;
}

export function runCorpus(
  corpus: { flavors: Map<string, FlavorPayloads> },
  implementations: ImplementationRegistry,
  pending: PendingRegistry,
): RunReport {
  const flavors: FlavorReport[] = [];
  let gate: "pass" | "fail" = "pass";
  for (const [flavor, payloads] of corpus.flavors) {
    const report = runFlavor(flavor, payloads, implementations.get(flavor), pending);
    if (report.outcome === "fail") gate = "fail";
    flavors.push(report);
  }
  return { flavors, gate };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}
