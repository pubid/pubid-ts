import { loadCorpus } from "../dist/corpus/loader.js";
import { PendingRegistry } from "../dist/conformance/pending.js";
import { runCorpus } from "../dist/conformance/runner.js";
import { corpusModeImplementation } from "../dist/implementations/corpus-mode.js";
import { grammarImplementation } from "../dist/flavors/index.js";

const testsDir = process.argv[2] ?? "/Users/mulgogi/src/pubid/pubid-testsuite/tests";
const corpus = loadCorpus(testsDir);
const implementations = new Map([...corpus.flavors].map(([flavor, payloads]) => [
  flavor,
  grammarImplementation(flavor) ?? corpusModeImplementation(payloads.cases),
]));
const pending = PendingRegistry.load("conformance/pending.yaml");
const report = runCorpus(corpus, implementations, pending);
for (const flavor of report.flavors) {
  for (const f of flavor.failures) console.log(f);
}
