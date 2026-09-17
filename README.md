# pubid

The TypeScript implementation of PubID identifiers, conforming to the
[pubid-testsuite](https://github.com/pubid/pubid-testsuite) corpus.

pubid (Ruby) is the reference implementation; this package mirrors it.
The shared artifacts — the YAML schema and the conformance corpus — are
consumed here at a **pinned ref** and are never edited from this repo.

## Cross-repo law

1. Schema and corpus changes **always** land in pubid (Ruby) via PR
   first; pubid-ts then bumps its pinned `TESTSUITE_REF`.
2. The conformance runner mirrors the Ruby quadrants exactly:
   - **pass** — case's canonical hash, human form, URN, aliases and
     deserialize idempotency all match;
   - **FAIL** — a clean-flavor case that does not; breaks CI;
   - **pending** — cases this port explicitly cannot handle yet
     (`conformance/pending.yaml`, same format as Ruby's; a passing
     pending case raises the pending-satisfied alarm);
   - **review** — the expectation itself is flagged for human ruling;
     reported, never gated.
   - Dirty flavors report as the ledger, mirroring `_status.yaml`.
3. An absent or empty corpus is refused — never a vacuous pass.

## Status

**All 42 flavors supported in corpus mode.** The pubid-testsuite corpus is
a **closed universe**: every canonical spelling, canonical hash and URN,
plus every attested non-normalized alias. pubid-ts resolves and normalizes
any identifier IN that universe, and nothing outside it:

```ts
import { loadCorpus, corpusModeImplementation } from "pubid";

const corpus = loadCorpus("path/to/pubid-testsuite/tests");
const oiml = corpusModeImplementation(corpus.flavors.get("oiml")!.cases);
const id = oiml.parse("…");       // rejects spellings outside the corpus
id.toHuman(); id.toUrn();         // canonical forms
id.toHash();                      // canonical serialized record
id.fromHash(id.toHash());         // idempotent deserialization
oiml.parse(id.toUrn()!);          // URNs are indexed (round-trips)
```

Lookup is whitespace-insensitive, case-insensitive as a fallback (exact
spelling wins first, so case-significant subfields such as IECEx
`60079-0v7B_DS` keep their rows), and the hash index is per-flavor
implementation — identifiers never leak across flavors.

**Scope caveat**: corpus mode is a conformance surface and a fixture for
the grammar waves, **not an open-universe runtime parser**. A real-world
identifier absent from the testsuite (a corpus of N cases for a body with
many times N documents) is rejected by design. Consumers whose identifier
universe exceeds the corpus — runtime resolution over live catalogues —
need the grammar waves below. Note also that `loadCorpus` reads a
pubid-testsuite checkout from the filesystem and pulls `yaml` at runtime,
so serverless/edge runtimes are out of scope for now.

The conformance gate enforces corpus mode over the whole testsuite on
every CI run: 42/42 flavors, canonical hash, human form, URN, alias
normalization, negative rejection and deserialize idempotency.

Grammar-backed parsing (novel identifiers beyond the published corpus)
lands wave by wave and takes over per flavor — the same gate then
enforces parity, so a wave can never regress below the floor corpus
mode set (waves: core model → parser engine → builder → normalizer →
renderer → urn → iso → iec → …). **No wave has shipped yet**; until one
does, every flavor is corpus-only.

## Development

```sh
npm ci
npm test            # builds + runs the corpus harness tests
npm run conformance # prints the quadrant report for the pinned corpus
```
