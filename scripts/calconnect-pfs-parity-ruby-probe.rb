# frozen_string_literal: true

# The ruby-side parity-fixture generator for the calconnect_pfs TS port
# (pubid/pubid#706 §8's "one conformance set, both engines"). The SSOT of
# the inventory is the Ruby harness itself — spec/pubid/calconnect_pfs/
# parity_spec.rb: every calconnect corpus row (the pubid-testsuite
# payload the harness consumes) with its normalization aliases, plus the
# harness's constructed PARITY_FACES, plus every negative — and this
# script exports exactly that inventory, plus the reference outputs both
# RUBY flavors produce for it, into the committed fixture the TS parity
# test reads (test/fixtures/calconnect-pfs-parity.json).
#
#   ruby scripts/calconnect-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>
#
# <pubid-checkout> must be a pubid checkout carrying the calconnect_pfs
# flavor (main >= pubid#714, 2.0.24+). Regenerate and commit whenever
# the harness's inventory moves — the TS test fails on a stale fixture
# (a row the TS set cannot reproduce names itself).
require "json"

SPEC_REL = "spec/pubid/calconnect_pfs/parity_spec.rb"
CHECKOUT = ARGV[0] or raise "usage: ruby scripts/calconnect-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"
TESTSUITE = ARGV[1] or raise "usage: ruby scripts/calconnect-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"
OUT = ARGV[2] or raise "usage: ruby scripts/calconnect-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"

$LOAD_PATH.unshift File.expand_path("lib", CHECKOUT)
require "pubid"
require "pubid/conformance"

# The constructed faces the harness checks beyond the corpus (the
# optional-segment matrix): lift the frozen array literal out of the
# spec (a fail-loud extraction — a reformatted spec must regenerate the
# fixture, not silently pass with a stale list).
def extract_faces(source)
  literal = source[/^  PARITY_FACES = \[(.*?)\]\.freeze$/m, 1]
  raise "cannot extract PARITY_FACES from #{SPEC_REL} — the harness moved, update this extractor" if literal.nil?
  eval("[#{literal}]")
end

spec_path = File.join(CHECKOUT, SPEC_REL)
faces = extract_faces(File.read(spec_path))

corpus_dir = File.join(TESTSUITE, "tests")
raise "no calconnect corpus under #{corpus_dir}" unless File.directory?(File.join(corpus_dir, "calconnect"))
cases = Pubid::Conformance::Corpus.cases("calconnect", corpus_dir)
negatives = Pubid::Conformance::Corpus.load_file(
  File.join(corpus_dir, "calconnect", "_negative.yaml"),
)

FLAVORS = { "calconnect" => Pubid::Calconnect, "calconnect_pfs" => Pubid::CalconnectPfs }.freeze
METHODS = %i[to_s to_hash to_urn to_mr_string to_pubid_urn].freeze

def outputs_of(flavor_class, input)
  identifier = flavor_class.parse(input)
  {
    "to_s" => identifier.to_s,
    "to_hash" => Pubid::Conformance.plainify(identifier.to_hash),
    "to_urn" => identifier.to_urn,
    "to_mr_string" => identifier.to_mr_string,
    "to_pubid_urn" => identifier.to_pubid_urn,
  }
end

def face_outputs_of(flavor_class, input)
  identifier = flavor_class.parse(input)
  {
    # The internal-form cut: the harness checks the publisher-less face
    # beside the canonical one (to_s(with_publisher: false)).
    "to_s" => identifier.to_s,
    "to_s_without_publisher" => identifier.to_s(with_publisher: false),
    "to_hash" => Pubid::Conformance.plainify(identifier.to_hash),
  }
end

rows = cases.map do |test_case|
  input = test_case.representations.human
  per_flavor = FLAVORS.transform_values { |klass| outputs_of(klass, input) }
  {
    "id" => test_case.id,
    "input" => input,
    # The corpus row's own canonical hash, both sides assert against.
    "canonical_hash" => Pubid::Conformance.plainify(test_case.identifier),
    "aliases" => test_case.non_normalized_aliases.map(&:spelling),
    "ruby" => per_flavor,
    # The Ruby gate's own assertion: the flavors agree byte-for-byte.
    "agree" => per_flavor["calconnect"] == per_flavor["calconnect_pfs"],
  }
end

face_rows = faces.map do |input|
  per_flavor = FLAVORS.transform_values { |klass| face_outputs_of(klass, input) }
  {
    "input" => input,
    "ruby" => per_flavor,
    "agree" => per_flavor["calconnect"] == per_flavor["calconnect_pfs"],
  }
end

rejected = negatives.map do |test_case|
  per_flavor = FLAVORS.transform_values do |klass|
    begin
      klass.parse(test_case.input)
      "accepted"
    rescue Pubid::Errors::ParseError
      "rejected"
    end
  end
  { "id" => test_case.id, "input" => test_case.input, "ruby" => per_flavor }
end

# Provenance: a git checkout names its own HEAD; an exported tree (the
# version-fixed way to run this probe) is the ref it was exported from —
# pass PUBID_REF=<sha> (and TESTSUITE_REF=<sha>) for those.
def ref_of(path, env)
  is_git = File.directory?(File.join(path, ".git"))
  ref = ENV[env] || (is_git ? `git -C #{path} rev-parse HEAD`.strip : nil)
  raise "cannot resolve the ref for #{path} — pass #{env}=<sha>" if ref.nil? || ref.empty?
  [ref, is_git && !system("git", "-C", path, "diff", "--quiet")]
end

pubid_ref, pubid_dirty = ref_of(CHECKOUT, "PUBID_REF")
testsuite_ref, testsuite_dirty = ref_of(TESTSUITE, "TESTSUITE_REF")

fixture = {
  "provenance" => {
    "generator" => "scripts/calconnect-pfs-parity-ruby-probe.rb",
    "source_spec" => SPEC_REL,
    "pubid_ref" => pubid_ref,
    "pubid_dirty_tree" => pubid_dirty,
    "testsuite_ref" => testsuite_ref,
    "testsuite_dirty_tree" => testsuite_dirty,
    "notes" =>
      "to_mr_string and to_s(with_publisher:) have no TS counterpart yet " \
      "(the TS model surface is toString/toHash/toUrn/toPubidUrn); the " \
      "columns are recorded so the shared set stays complete for both " \
      "engines.",
  },
  "corpus" => rows,
  "faces" => face_rows,
  "negatives" => rejected,
}

File.write(OUT, JSON.pretty_generate(fixture) + "\n")
agree = rows.count { |r| r["agree"] } + face_rows.count { |r| r["agree"] }
consistent = rejected.count { |r| r["ruby"].values.uniq.size == 1 }
puts "calconnect-pfs-parity: #{rows.size} corpus + #{face_rows.size} faces " \
     "(#{agree} ruby-agree), #{rejected.size} negatives " \
     "(#{consistent} ruby-consistent) -> #{OUT} " \
     "(pubid #{pubid_ref}#{pubid_dirty ? ', DIRTY' : ''}, " \
     "testsuite #{testsuite_ref}#{testsuite_dirty ? ', DIRTY' : ''})"
exit 1 unless agree == rows.size + face_rows.size && consistent == rejected.size
