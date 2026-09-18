# 04 — Verification, PORTING.md rewrite, shipping

## Gate (must be green after every batch in TODO.unified/03)

1. `npm test` — every wave test unchanged and passing (they pin corpus
   parity, open-ended parsing, and rejections per flavor).
2. `npm run conformance` — `TOTAL flavors=42 implemented=42 gate=pass`,
   zero new failures (ieee's ledgered 15 stay as-is; corpus mode is
   untouched by this refactor).
3. `test/model.test.ts` — core pins against Ruby probes.

Zero behavior change is the contract: identical hashes, humans, URNs for
all ~17.3k grammar-backed corpus rows.

## PORTING.md rewrite

The per-flavor checklist becomes:

1. Read the Ruby flavor (parser/builder/identifier/renderers/urn_*).
2. Declare attributes (`extendAttributes`) + mappings + polymorphicName.
3. Port the grammar 1:1 (engine invariants unchanged).
4. Builder = BaseBuilder subclass (`selectClass`/`cast`).
5. Renderer + URN generator classes mirroring Ruby's (Base generator
   when Ruby has no `urn_generator.rb`).
6. Register in `src/flavors/index.ts`; wave test; gate.

Add a "unified model" section pointing at `src/model/` as the TS mirror
of `Pubid::Identifier` with the TODO.unified/01 semantics table.

## Shipping

- One PR: `unified model + all migrations` on branch
  `unified/model-core` off origin/main.
- Commit sequence: TODO.unified docs → model core + tests → batches A-E
  (one commit each) → PORTING.md.
- Rebase-merge after green CI (established wave flow).
- Memory update after merge.
