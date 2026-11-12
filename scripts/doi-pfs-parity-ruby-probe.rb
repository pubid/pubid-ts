# frozen_string_literal: true

# The ruby-side parity-fixture generator for the doi_pfs TS port
# (pubid/pubid#706's "one conformance set, both engines"). The SSOT of
# the inventory is the Ruby harness itself — spec/pubid/doi_pfs/
# parity_spec.rb's PARITY_INPUTS / PARITY_NEGATIVES — and this script
# exports exactly that list, plus the reference outputs both RUBY
# flavors produce for it, into the committed fixture the TS parity test
# reads (test/fixtures/doi-pfs-parity.json).
#
#   ruby scripts/doi-pfs-parity-ruby-probe.rb <pubid-checkout> <out.json>
#
# <pubid-checkout> must be a pubid checkout carrying the doi_pfs flavor
# (main >= pubid#710). Regenerate and commit whenever the harness's
# inventory moves — the TS test fails on a stale fixture (a row the TS
# set cannot reproduce names itself).
require "json"

SPEC_REL = "spec/pubid/doi_pfs/parity_spec.rb"
CHECKOUT = ARGV[0] or raise "usage: ruby scripts/doi-pfs-parity-ruby-probe.rb <pubid-checkout> <out.json>"
OUT = ARGV[1] or raise "usage: ruby scripts/doi-pfs-parity-ruby-probe.rb <pubid-checkout> <out.json>"

$LOAD_PATH.unshift File.expand_path("lib", CHECKOUT)
require "pubid"

# The inventory IS data: lift the two frozen array literals out of the
# spec (a fail-loud extraction — a reformatted spec must regenerate the
# fixture, not silently pass with a stale list).
def extract_list(source, name)
  literal = source[/^#{name} = \[(.*?)\]\.freeze$/m, 1]
  raise "cannot extract #{name} from #{SPEC_REL} — the harness moved, update this extractor" if literal.nil?
  eval("[#{literal}]")
end

spec_path = File.join(CHECKOUT, SPEC_REL)
source = File.read(spec_path)
positives = extract_list(source, "PARITY_INPUTS")
negatives = extract_list(source, "PARITY_NEGATIVES")

FLAVORS = { "doi" => Pubid::Doi, "doi_pfs" => Pubid::DoiPfs }.freeze
METHODS = %i[to_s to_hash to_urn to_mr_string to_pubid_urn].freeze

def outputs_of(flavor_class, input)
  identifier = flavor_class.parse(input)
  {
    "to_s" => identifier.to_s,
    "to_hash" => identifier.to_hash,
    "to_urn" => identifier.to_urn,
    "to_mr_string" => identifier.to_mr_string,
    "to_pubid_urn" => identifier.to_pubid_urn,
  }
end

rows = positives.map do |input|
  per_flavor = FLAVORS.transform_values { |klass| outputs_of(klass, input) }
  {
    "input" => input,
    "ruby" => per_flavor,
    # The Ruby gate's own assertion: the flavors agree byte-for-byte.
    "agree" => per_flavor["doi"] == per_flavor["doi_pfs"],
  }
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
is_git = File.directory?(File.join(CHECKOUT, ".git"))
pubid_ref = ENV["PUBID_REF"] || (is_git ? `git -C #{CHECKOUT} rev-parse HEAD`.strip : nil)
raise "cannot resolve the pubid ref for #{CHECKOUT} — pass PUBID_REF=<sha>" if pubid_ref.nil? || pubid_ref.empty?
dirty = is_git && !system("git", "-C", CHECKOUT, "diff", "--quiet")

fixture = {
  "provenance" => {
    "generator" => "scripts/doi-pfs-parity-ruby-probe.rb",
    "source_spec" => SPEC_REL,
    "pubid_ref" => pubid_ref,
    "pubid_dirty_tree" => dirty,
    "notes" =>
      "to_mr_string has no TS counterpart yet (the TS model surface is " \
      "toString/toHash/toUrn/toPubidUrn); the column is recorded so the " \
      "shared set stays complete for both engines.",
  },
  "positives" => rows,
  "negatives" => rejected,
}

File.write(OUT, JSON.pretty_generate(fixture) + "\n")
agree = rows.count { |r| r["agree"] }
puts "doi-pfs-parity: #{rows.size} positives (#{agree} ruby-agree), " \
     "#{rejected.size} negatives -> #{OUT} (pubid #{pubid_ref}#{dirty ? ', DIRTY' : ''})"
exit 1 unless agree == rows.size
