# 03 — Migrate all 17 flavors + port calconnect on the model

Every flavor collapses to: **grammar (unchanged) + attribute/mapping
declarations + renderer + URN generator subclass (only where Ruby has
one) + builder**. The `FlavorImplementation` adapter surface
(`parse` → `Identifier` with toHash/toHuman/toUrn/fromHash) is unchanged,
so `src/conformance/*` and all wave tests stay as-is. The corpus gate is
the no-behavior-change proof after every batch.

## Migration table

| Flavor | Attributes (declarations) | Renderer | URN | Notes |
|---|---|---|---|---|
| doi | prefix, suffix (string) | custom (doi:P/S) | **Base** | base table has no slots → `urn:doi` derived |
| iana | number, subRegistry→`sub_registry` wire | custom | subclass (Ruby has one) | keep `urn:iana:slug[:sub]` |
| un | path (collection), number | custom | subclass per Ruby | year is runtime-only, derived in fromHash |
| xsf | number (string) | custom | subclass | SPECIAL_NUMBERS stays in builder |
| omg | acronym, version, part (string) | custom | **Base** | part slot derives `urn:omg:-PDF` |
| ogc | year, number, revision (string) | custom | subclass | |
| w3c | number, date (string, custom map) | custom | subclass | date is a plain string in Ruby — NOT a PubidDate |
| plateau | number/annex (integer), edition (string) | custom | subclass | integers, %02d formats stay in renderer/generator |
| isbn | raw, hyphenated (string) | custom | **Base** | check-digit math stays in builder |
| easc | series, variant, number, year (string) | custom | subclass | |
| ecma | number, part, edition, volume (string) | custom | subclass | typed core differs (tr/tr_number tree keys → cast) |
| tgpp | number, suffix, parts (collection, initializeEmpty), release, version | custom | subclass | |
| ansi | number, part, year, copublishers (Publisher coll.), languages (Language coll.) | custom | subclass | builder = BaseBuilder + cast (Ruby's shape) |
| oasis | original, number, version, stage, part, label (string) | custom | subclass | decomposition stays in builder |
| iho | number, appendix, part, annex, supplement, version + series→kind dispatch | custom | subclass | 5 concrete classes → 5 polymorphicName declarations |
| oiml | existing model.ts ported onto declarations | custom | custom | biggest; keep grammar/builder, move hash/render onto the model |
| **calconnect** (new) | series, number (string), date (PubidDate) | custom | subclass | flat year/month/day via custom map pair (Ruby's `with:` hooks) |

## Batches (gate after each: `npm test` + `npm run conformance`)

- **A** DONE (base-generator flavors first — they prove the URN
  template): doi, isbn, omg, un, iana, xsf
- **B** DONE: ogc, w3c, plateau, easc
- **C** DONE: ecma, tgpp, ansi (Builder::Base cast pattern)
- **D** DONE: oasis, iho migrated; calconnect ported FRESH on the model
  (the first flavor written declarations-first; corpus 189/189)
- **E** PENDING: oiml — the last hand-rolled flavor. 11 Ruby classes
  (7 typed documents + bulletin + 2 supplements + annex) become 11
  BaseIdentifier subclasses with per-class whitelist mappings;
  supplements hold a nested `base` (serializeValue must delegate
  toHash to nested BaseIdentifier values). Its grammar.ts is unchanged;
  model.ts's discriminated union is replaced. Gate after: oiml 69/69 + open-ended.

## Clean-flavor port campaign (post-model)

- DONE: gb (10/10), jcgm (29/29) — wave 9.
- BLOCKED: **gost** — harmonized/identical-adoption cases embed foreign
  identifiers parsed by OTHER flavors (pubid:iso:*, pubid:astm:*), and
  iso/astm are ledgered upstream. The interstate/national 143 cases
  would pass alone, but the gate requires the whole corpus. Same shape:
  **evs** (embeds the CEN/CENELEC grammar), **idf** (joint ISO/IDF).
- TODO: cie, iala, bipm (self-contained parsers, clean corpora).
- **cie porting notes** (corpus shape survey done, 365 rows / 9 types):
  standard 262 (number[.iteration][-part]:year, `style` wire key =
  legacy dash vs current colon date separator, `s_prefix` S marker,
  d_prefix D-series, language before/after date), conference 45
  (x-prefix, page/conference/variant/amendment_number variants), joint
  ISO/IEC 23+16 identical (iso_reference) + dual-published
  (iec_identifier), proceedings 11, corrigendum 2, bundle 1 (ids[]).
  Parser: ordered code alternation longest-first (part+iteration slash
  then dash, iteration, part slash, part dash with 4-digit-year
  lookahead absent?, simple); language formats /E, (DE), (RU-2021)
  trans-year. Builder 524 lines. START HERE next session: read
  lib/pubid/cie/builder.rb + identifier.rb key_value, port the 9
  classes onto BaseIdentifier (style/s_prefix/part_separator are
  wire keys; the date separator IS the style attribute).

## Rules

1. NO per-flavor `toHash`/`fromHash` bodies. Wire shapes come from
   mappings; only `toWire/fromWire` converter pairs (calconnect date) are
   imperative, mirroring Ruby `map ... with:`.
2. Renderers/URN generators are classes with the same shape as Ruby's
   (constructor takes the model; `render(context?)` / `generate()`), so a
   future diff against Ruby stays 1:1.
3. Builders subclass BaseBuilder: `selectClass`, `cast`, `handleKey`
   overrides only.
4. Where Ruby keeps a value in a CONSTANT (PUBLISHER), TS does the same —
   constants are not attributes and never serialize.
5. Each migrated flavor's wave test must pass UNCHANGED (they pin corpus
   parity + open-ended parsing + rejections).
