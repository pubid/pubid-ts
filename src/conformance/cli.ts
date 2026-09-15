import { loadCorpus } from "../corpus/loader.js";
import { PendingRegistry } from "./pending.js";
import { runCorpus } from "./runner.js";
import type { ImplementationRegistry } from "./implementation.js";

/**
 * The conformance entry point. TESTSUITE_DIR points at a pubid-testsuite
 * checkout's tests/ directory (CI checks it out at the pinned ref).
 *
 * Bootstrap semantics: flavors without an implementation REPORT as
 * unimplemented - the clean gate activates per flavor as the waves land,
 * exactly like the Ruby runner treats registered vs unknown flavors.
 */
export function main(argv: string[]): number {
  const testsDir = argv[2] ?? process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";
  const pendingPath = argv[3] ?? process.env["PENDING_PATH"] ?? "conformance/pending.yaml";

  const corpus = loadCorpus(testsDir);
  const implementations: ImplementationRegistry = new Map(); // waves land here
  const pending = PendingRegistry.load(pendingPath);

  const report = runCorpus(corpus, implementations, pending);
  for (const flavor of report.flavors) {
    const line = [
      flavor.flavor.padEnd(12),
      flavor.outcome.padEnd(14),
      `cases=${String(flavor.cases).padStart(5)}`,
      `fail=${String(flavor.failures.length).padStart(4)}`,
      `pend=${String(flavor.pending).padStart(3)}`,
      `reclass=${String(flavor.reclassified).padStart(4)}`,
      `review=${String(flavor.review).padStart(3)}`,
    ].join(" ");
    console.log(line);
    for (const failure of flavor.failures.slice(0, 5)) console.log(`  FAIL ${failure}`);
    for (const id of flavor.pendingSatisfied.slice(0, 5)) {
      console.log(`  PENDING-SATISFIED ${id} - remove the marker`);
    }
  }
  const implemented = report.flavors.filter((f) => f.outcome !== "unimplemented").length;
  console.log(
    `TOTAL flavors=${report.flavors.length} implemented=${implemented} gate=${report.gate}`,
  );
  return report.gate === "pass" ? 0 : 1;
}

if (process.argv[1]?.endsWith("cli.js")) {
  process.exit(main(process.argv));
}
