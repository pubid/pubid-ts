# 01 — Study: the pubid Ruby unified model (the porting contract)

Everything below was read from `../pubid/lib` and/or pinned by running the
gem. This file is the SOURCE OF TRUTH for the TypeScript port; when TS and
Ruby disagree, Ruby wins and this doc gets updated.

## Inventory (what "the unified model" is)

| Ruby | Role |
|---|---|
| `Pubid::Identifier` (lib/pubid/identifier.rb, 1229 lines) | base class: attribute DSL, canonical `to_hash`/`from_hash`, `render`, `to_urn`, polymorphic `_type` |
| `Pubid::Components::*` (lib/pubid/components/) | typed value objects: Date, Publisher, Language, Edition, Code, Stage, TypedStage, Iteration, … |
| `Pubid::Renderers::Base` | human-render base: `render_component(value, context)` helper, annotation (not needed in TS) |
| `Pubid::UrnGenerator::Base` | URN template with overridable hooks (see §4) |
| `Pubid::UrnParser::Base` | strip_namespace / split_parts / flavor_parse (TS: not yet ported; corpus-mode URN lookup covers it) |
| `Pubid::Builder::Base` | shared build loop: flatten tree → select_class → cast → assign (see §5) |
| `Pubid::Parser::Grammar` + CommonParseRules | parslet base + shared rules (`year_digits` = (19|20)+2 digits + digits.absent?) |

## 1. Attribute declarations (identifier.rb:503-525)

Base `Pubid::Identifier` declares:

```ruby
attribute :_type, :string, polymorphic_class: true
attribute :number, :string          # retyped per flavor (Components::Code in ISO)
attribute :part, :string
attribute :subpart, :string
attribute :stage_iteration, Components::Iteration
attribute :date, Components::Date
attribute :edition, Components::Edition
attribute :languages, Components::Language, collection: true
attribute :publisher, Components::Publisher
attribute :copublishers, Components::Publisher, collection: true
attribute :type, Components::Type
attribute :stage, Components::Stage
attribute :locality, Components::Locality
attribute :typed_stage, Components::TypedStage
attribute :all_parts, Boolean, default: false
```

Semantics that matter to TS:

- **Inheritance is a snapshot**: a subclass deep-dups the parent's
  attribute table at class-definition time (lutaml). Overrides
  (`attribute :number, :string` in a flavor over the base's Code) are
  safe ONLY when the whole base body ran first — hence Ruby's "one file,
  never reopened" rule. TS mirrors with an explicit
  `extendAttributes(Parent, defs)` composition.
- `default:` may be a value or a thunk; `collection: true` makes it an
  array; `initialize_empty: true` (tgpp parts) materializes `[]` when the
  hash carries no key.

## 2. `to_hash` — the canonical serialization (identifier.rb:556-746)

Pipeline (in order):

1. **Map** each declared attribute to its wire key (lutaml `key_value`
   mappings; default wire key = attribute name; `_type` first).
2. **canonicalize_hash** — for every declared attribute EXCEPT `_type`,
   drop the key when the value is empty OR equals the attribute default
   (`default_valued?`); recurse into nested components and collections
   (each canonicalized against its own sub-hash). This is what makes
   `to_hash` a pure function of the identifier's values.
3. **flatten_scalar_components** — a component carrying ONLY its single
   significant field serializes as that scalar:
   - `edition: {number: "2"}` → `edition: "2"`
   - `date: {year: "2024"}` → **renamed** `year: "2024"` (flat_key ≠ attr)
   - `stage_iteration` → its `:string`
   - a COLLECTION of degenerate components (`copublishers`) → list of
     scalars (`["ASME"]`), same key, only when every element degenerates.
   Guards: never overwrite a wire key the flavor already emits; never
   rename onto a name the flavor declares as its own attribute (~20
     flavors have their own `year` attr).
   Tables: `FLAT_SCALAR_COMPONENTS = {edition: "edition", date: "year",
   stage_iteration: "stage_iteration"}` / `FLAT_SCALAR_FIELDS = {edition:
   :number, date: :year, stage_iteration: :number}`; flavors can extend.
4. **compact_hash(model, hash)** — per-class hook for shorter wire forms
   (default: no-op). A class using it must invert in
   `inflate_scalar_components`.

## 3. `from_hash` — dispatch + inflation (identifier.rb:96-160)

- `concrete_class_for(data)` reads `_type` and dispatches through the
  flavor's `*_TYPE_MAP` (polymorphic_map), delegating cross-flavor to
  TypeResolver.
- `inflate_scalar_components` re-nests the flat scalars of §2.3 back into
  component hashes (`year: "2024"` → `date: {year: "2024"}`) before lutaml
  casts, EXCEPT when the flavor has its own converter for that key, and
  never when the flat key is a declared attribute of the class.
- Hash values cast into components; plain strings pass through; integers
  stay integers.

`polymorphic_name` (identifier.rb:761): `"pubid:#{flavor_down}:#{TypeKebab}"`
e.g. `Pubid::W3c::Identifiers::CandidateRecommendationDraft` →
`pubid:w3c:candidate-recommendation-draft` (CamelCase → kebab; tgpp
overrides `tgpp` → `3gpp`).

## 4. `UrnGenerator::Base` template (urn_generator/base.rb)

```ruby
def generate
  parts = ["urn", urn_namespace]           # namespace = flavor name downcase
  parts << urn_publisher  if urn_publisher  # Publisher render(urn) = downcase body
  parts << urn_type       if urn_type       # nil by default
  parts << urn_number     if urn_number     # maybe(:number) || maybe(:code)
  parts << urn_part       if urn_part       # "-#{part}"
  parts << urn_subpart    if urn_subpart    # "-#{subpart}"
  parts << urn_year       if urn_year       # Date render(urn) = year only; string date verbatim
  parts << urn_edition    if urn_edition    # "ed.#{number}"
  parts << urn_language   if urn_language   # codes joined ","
  parts.join(":")
end
```

- `maybe(name)` returns nil unless the class DECLARES the attribute — a
  flavor keeping its publisher in a constant (most small flavors) gets no
  publisher segment.
- `to_urn` resolves `Pubid::<Flavor>::UrnGenerator`, falling back to Base
  (NameError rescue).
- Flavors with their own generator: w3c, ogc, oasis, iho, plateau, tgpp,
  ecma, ansi, easc, calconnect, … Flavors on the BASE generator: **doi,
  isbn, omg, un, gb** (verified by directory listing). Pinned outputs:
  - doi → `urn:doi` (no attributes hit template slots)
  - isbn → `urn:isbn`
  - omg → `urn:omg` / `urn:omg:-PDF` (part slot)
- `urn_type_code` / `urn_supplement_type` instance hooks default nil.

## 5. `Builder::Base` (builder/base.rb)

```ruby
def build(data)                       # data = parslet tree hash (or array of hashes)
  data = flatten_array(data)          # array-of-hashes → merged hash
  identifier = select_class(data).new # override for type dispatch
  assign_attributes(identifier, data)
end
```

`assign_attributes`: for each (key, value): `cast(key, value)` →
- nil → skip; Hash → assign each sub-k that is a declared attribute;
  single value → assign if `key` is a declared attribute, else SILENTLY
  skip (unknown tree keys never reach the model).

Shared helpers to mirror: `parse_date` ("YYYY[-MM[-DD]]" or "YYYY" → Date),
`parse_languages` (splits on ",|/", single chars via CHAR_MAP
R/F/E/A/S/D → ru/fr/en/ar/es/de), `parse_number_with_part`
("1234-1-2" → number/part/subpart, roman→int, legacy-year hook),
`convert_roman_to_integer`.

## 6. Components (lib/pubid/components/)

- **Date**: attrs year/month/day (strings) + `undated` (bool, default
  false). `render(urn:)` = year only. `to_s` = "YYYY" / "YYYY-MM" /
  "YYYY-MM-DD" with pad2 month/day; "--" when undated without year.
  `present?` = undated || year non-empty.
- **Publisher**: `body`; render(urn) = downcase.
- **Language**: `code` (+`original_code`); CHAR_MAP single-char codes;
  render(urn) = downcase code.
- **Edition**: `number` (+phase); degenerates to its number.
- **Code**: `value` (+ suffix); degenerate → value.
- **Iteration**: `string` field; degenerate by construction.

## 7. Render contexts

`render(context:)` threads a RenderingContext; the two that matter:
human (default) and urn (`.urn?` → downcase/year-only behavior above).
TS: a `RenderContext = "human" | "urn"` discriminated argument.

## Open items deliberately NOT ported now (recorded, not lost)

SubsetMatch/`===`/`exclude`/`matches?` (relaton query semantics),
Renderers::Annotator (HTML spans), MR-string/to_slug machinery,
TypedStage/Stage/HarmonizedStage resolution, UrnParser::Base,
relationships/adoption components. None are exercised by the corpus
gate's hash/human/urn contract; they get their own TODO when a flavor
needs them.
