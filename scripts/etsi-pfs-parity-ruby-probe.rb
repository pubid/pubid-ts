# frozen_string_literal: true

# The ruby-side parity-fixture generator for the etsi_pfs TS port
# (pubid/pubid#706 phase 3's "one conformance set, both engines"). The
# SSOT of the inventory is the Ruby harness itself — spec/pubid/etsi_pfs/
# parity_spec.rb: the FULL 24,718-row inventory (spec/fixtures/etsi/
# identifiers/full/technical_specification.txt — the largest corpus a
# compiled flavor has been bracketed against) with the harness's
# constructed PARITY_INPUTS and PARITY_NEGATIVES lifted straight out of
# the spec, and this script exports exactly that inventory, plus the
# reference outputs both RUBY flavors produce for it, into the fixture
# the TS parity test reads (test/fixtures/etsi-pfs-parity.json).
#
#   ruby scripts/etsi-pfs-parity-ruby-probe.rb <pubid-checkout> <out.json>
#
# <pubid-checkout> must be a pubid checkout carrying the etsi_pfs flavor
# (main >= pubid#717). Regenerate and commit whenever the harness's
# inventory moves — the TS test fails on a stale fixture (a row the TS
# set cannot reproduce names itself).
#
# The committed artifact is the GZIP of this output
# (test/fixtures/etsi-pfs-parity.json.gz, node zlib level 9 — the
# gen-pubid-urn-parity.mjs convention), compressed by
# scripts/gen-etsi-pfs-parity.mjs.
require "json"

SPEC_REL = "spec/pubid/etsi_pfs/parity_spec.rb"
INVENTORY_REL = "spec/fixtures/etsi/identifiers/full/technical_specification.txt"
CHECKOUT = ARGV[0] or raise "usage: ruby scripts/etsi-pfs-parity-ruby-probe.rb <pubid-checkout> <out.json>"
OUT = ARGV[1] or raise "usage: ruby scripts/etsi-pfs-parity-ruby-probe.rb <pubid-checkout> <out.json>"

$LOAD_PATH.unshift File.expand_path("lib", CHECKOUT)
require "pubid"

# Fail-loud extractions — a reformatted spec must regenerate the fixture,
# not silently pass with a stale list.
def extract_list(source, name)
  literal = source[/^#{name} = \[(.*?)\]\.freeze$/m, 1]
  raise "cannot extract #{name} from #{SPEC_REL} — the harness moved, update this extractor" if literal.nil?
  eval("[#{literal}]")
end

spec_source = File.read(File.join(CHECKOUT, SPEC_REL))
inputs = extract_list(spec_source, "PARITY_INPUTS")
negatives = extract_list(spec_source, "PARITY_NEGATIVES")

inventory_path = File.join(CHECKOUT, INVENTORY_REL)
inventory = File.readlines(inventory_path).map(&:strip)
              .reject { |line| line.empty? || line.start_with?("#") }
raise "the inventory moved (#{inventory.size} rows, the harness pins 24_718) — regenerate against the moved gate" if inventory.size != 24_718

FLAVORS = { "etsi" => Pubid::Etsi, "etsi_pfs" => Pubid::EtsiPfs }.freeze

def outputs_of(flavor_class, input)
  identifier = flavor_class.parse(input)
  base = {
    "to_s" => identifier.to_s,
    "to_hash" => Pubid::Conformance.plainify(identifier.to_hash),
    "to_mr_string" => identifier.to_mr_string,
    "to_pubid_urn" => identifier.to_pubid_urn,
  }
  begin
    base["to_urn"] = identifier.to_urn
  rescue ArgumentError => e
    base["to_urn"] = nil
    base["to_urn_quirk"] = "#{e.class}: #{e.message}"
  end
  base
end

rows = inventory.map do |input|
  per_flavor = FLAVORS.transform_values { |klass| outputs_of(klass, input) }
  # The Ruby gate's own assertion: the flavors agree byte-for-byte on
  # every surface the coded one renders (the month-08/09 to_urn quirk
  # rows compare on the compiled basis).
  agree = per_flavor["etsi"].all? do |method, coded_out|
    next true if method == "to_urn_quirk"
    compiled_out = per_flavor["etsi_pfs"][method]
    next true if method == "to_urn" && coded_out.nil?
    compiled_out == coded_out
  end
  { "input" => input, "ruby" => per_flavor, "agree" => agree }
end

face_rows = inputs.map do |input|
  per_flavor = FLAVORS.transform_values { |klass| outputs_of(klass, input) }
  agree = per_flavor["etsi"].all? do |method, coded_out|
    next true if method == "to_urn_quirk"
    next true if method == "to_urn" && coded_out.nil?
    per_flavor["etsi_pfs"][method] == coded_out
  end
  { "input" => input, "ruby" => per_flavor, "agree" => agree }
end

rejected = negatives.map do |input|
  per_flavor = FLAVORS.transform_values do |klass|
    begin
      klass.parse(input)
      "accepted"
    rescue Pubid::Errors::ParseError
      "rejected"
    end
  end
  { "input" => input, "ruby" => per_flavor }
end

# Provenance: a git checkout names its own HEAD; an exported tree (the
# version-fixed way to run this probe) is the ref it was exported from —
# pass PUBID_REF=<sha> for those.
def ref_of(path, env)
  is_git = File.directory?(File.join(path, ".git"))
  ref = ENV[env] || (is_git ? `git -C #{path} rev-parse HEAD`.strip : nil)
  raise "cannot resolve the ref for #{path} — pass #{env}=<sha>" if ref.nil? || ref.empty?
  [ref, is_git && !system("git", "-C", path, "diff", "--quiet")]
end

pubid_ref, pubid_dirty = ref_of(CHECKOUT, "PUBID_REF")

quirk_rows = rows.count { |r| r["ruby"]["etsi"]["to_urn_quirk"] }
fixture = {
  "provenance" => {
    "generator" => "scripts/etsi-pfs-parity-ruby-probe.rb",
    "source_spec" => SPEC_REL,
    "inventory" => INVENTORY_REL,
    "pubid_ref" => pubid_ref,
    "pubid_dirty_tree" => pubid_dirty,
    "notes" =>
      "to_mr_string has no TS counterpart yet (the TS model surface is " \
      "toString/toHash/toUrn/toPubidUrn); the column is recorded so the " \
      "shared set stays complete for both engines. The coded flavor's " \
      "month-08/09 to_urn ArgumentError is the pre-existing defect the " \
      "harness documents: those #{quirk_rows} rows record a nil " \
      "coded to_urn plus the raise, and the TS comparison basis is the " \
      "COMPILED output (the compiled generator renders the captured " \
      "month verbatim).",
  },
  "inventory" => rows,
  "faces" => face_rows,
  "negatives" => rejected,
}

File.write(OUT, JSON.generate(fixture) + "\n")
agree = rows.count { |r| r["agree"] } + face_rows.count { |r| r["agree"] }
consistent = rejected.count { |r| r["ruby"].values.uniq.size == 1 }
puts "etsi-pfs-parity: #{rows.size} inventory + #{face_rows.size} faces " \
     "(#{agree} ruby-agree, #{quirk_rows} coded to_urn quirk rows) " \
     "#{rejected.size} negatives (#{consistent} ruby-consistent) -> #{OUT} " \
     "(pubid #{pubid_ref}#{pubid_dirty ? ', DIRTY' : ''})"
exit 1 unless agree == rows.size + face_rows.size && consistent == rejected.size
