# frozen_string_literal: true

# The ruby-side parity-fixture generator for the cen_pfs TS port
# (pubid/pubid#706; the cen_pfs full absorption is pubid-grammar#121 +
# pubid#721's regeneration). The SSOT of the inventory is the Ruby
# harness itself — spec/pubid/cen_pfs/parity_spec.rb: the FULL corpus
# gate (189 pass rows over every cen_cenelec payload file in a
# pubid-testsuite checkout — the harness's own corpus source and row
# filters, fail-loud on the 189-row ledger), the harness's declared
# negatives lifted straight out of the spec (fail-loud extraction), and
# the constructed feature faces the harness's former-gaps block asserts
# on. This script exports exactly that set, plus the reference outputs
# both RUBY flavors produce for it, into the fixture the TS parity test
# reads (test/fixtures/cen-pfs-parity.json.gz after gen-cen-pfs-parity).
#
#   ruby scripts/cen-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>
#
# <pubid-checkout> must be a pubid checkout carrying cen_pfs at full
# byte parity (main >= pubid#721, 2.0.28). Regenerate and commit
# whenever the harness's gate moves — the TS test fails on a stale
# fixture (a row the TS set cannot reproduce names itself).
#
# The committed artifact is the GZIP of this output
# (test/fixtures/cen-pfs-parity.json.gz, node zlib level 9 — the
# gen-pubid-urn-parity.mjs convention), compressed by
# scripts/gen-cen-pfs-parity.mjs.
require "json"

SPEC_REL = "spec/pubid/cen_pfs/parity_spec.rb"
CORPUS_REL = "tests/cen_cenelec"
LEDGER_ROWS = 189
CHECKOUT = ARGV[0] or
  raise "usage: ruby scripts/cen-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"
TESTSUITE = ARGV[1] or
  raise "usage: ruby scripts/cen-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"
OUT = ARGV[2] or
  raise "usage: ruby scripts/cen-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"

$LOAD_PATH.unshift File.expand_path("lib", CHECKOUT)
require "pubid"

# Fail-loud identity (the stale-checkout hazard): everything below must
# run against THIS checkout's lib, never an installed gem. Both sides
# go through realpath — macOS /tmp resolves to /private/tmp.
Pubid.eager_load_flavors!
LIB_DIR = File.realpath(File.expand_path("lib", CHECKOUT))
parse_loc = Pubid::CenPfs::Identifier.method(:parse).source_location.first
raise "loaded #{parse_loc}, not #{LIB_DIR} — the stale-checkout hazard" unless File.realpath(parse_loc).start_with?(LIB_DIR)
version = File.read(File.join(CHECKOUT, "lib/pubid/version.rb"))[/VERSION = "([^"]+)"/, 1]
raise "cannot read the checkout's version" if version.nil?

# The corpus rows: the harness's own source and filters (the payload
# files, review/quarantined/error skipped), grouped per file so the
# per-file ledger stays visible in the summary.
corpus_dir = File.join(TESTSUITE, CORPUS_REL)
raise "no corpus at #{corpus_dir}" unless File.directory?(corpus_dir)
rows = []
Dir[File.join(corpus_dir, "*.yaml")].reject { |p| File.basename(p).start_with?("_") }.sort.each do |path|
  fname = File.basename(path, ".yaml")
  Pubid::Conformance::Corpus.load_file(path).each do |test_case|
    next if test_case.review? || test_case.quarantined? || test_case.error_case?

    rows << { "file" => fname, "input" => test_case.representations.human }
  end
end
raise "the inventory moved (#{rows.size} rows, the harness ledger pins #{LEDGER_ROWS}) — regenerate against the moved gate" if rows.size != LEDGER_ROWS

FLAVORS = { "cen_cenelec" => Pubid::CenCenelec, "cen_pfs" => Pubid::CenPfs }.freeze

def outputs_of(flavor_class, input)
  identifier = flavor_class.parse(input)
  {
    "to_s" => identifier.to_s,
    "to_hash" => Pubid::Conformance.plainify(identifier.to_hash),
    "to_mr_string" => identifier.to_mr_string,
    "to_urn" => identifier.to_urn,
    "to_pubid_urn" => identifier.to_pubid_urn,
  }
end

def row_of(input, file: nil)
  per_flavor = FLAVORS.transform_values { |klass| outputs_of(klass, input) }
  # The Ruby gate's own assertion: the flavors agree byte-for-byte on
  # every surface (the compiled flavor absorbed the row).
  agree = per_flavor["cen_cenelec"].all? do |method, coded_out|
    per_flavor["cen_pfs"][method] == coded_out
  end
  { "input" => input, "ruby" => per_flavor, "agree" => agree }.tap do |row|
    row["file"] = file if file
  end
end

inventory = rows.map { |row| row_of(row["input"], file: row["file"]) }

# The constructed faces: the harness's former-gaps block (the six
# #121 declared-emission features) asserts on these inputs; lifted here
# so the TS side exercises the same constructed set. A spec edit that
# moves them must move this list consciously (they are literal, not
# extracted — the spec has no frozen PARITY_INPUTS list to lift).
FACES = [
  # multi-type emission
  "CEN/TR 12101-5:2005", "CEN/TS 17638:2021", "CR 10313:2000",
  "CWA 14050-21:2000", "ES 59008-1:2000", "ENV 1613:1995",
  "HD 1215-2:1988", "CEN Guide 414:2017", "EN 1325",
  # draft-stage serialization
  "prEN 12464-1:2019", "FprEN 50600-2-4",
  # wrapper shapes
  "EN 13250:2000/A1:2005", "EN 285:2015+A1", "EN 13254:2000/AC:2003",
  "EN 61375-2-3:2015/AC:2016-11",
  # adopted-base dispatch
  "EN ISO 12100:2010", "EN IEC 62115:2020", "ENV ISO 11079:1999",
  # fused URN segments
  "CEN/CLC/ETSI/TR 101551:2026", "CEN ISO/TS 21003-7:2008",
  "EN ISO 10077-1:2006+AC:2009+AC2:2009", "EN 60038/A1 FRAG2",
  # the version face (the definition's live example)
  "EN 302 326-2 V2.2.1:2026",
].freeze

faces = FACES.map { |input| row_of(input) }

# The declared negatives, extracted fail-loud from the harness (the
# "the declared negatives (both flavors reject)" block's literal).
spec_source = File.read(File.join(CHECKOUT, SPEC_REL))
block = spec_source[/^\s*'\n(.*?)^\s*'\.split\("\\n"\)/m, 1]
raise "cannot extract the declared negatives from #{SPEC_REL} — the harness moved, update this extractor" if block.nil?
negatives = block.split("\n").map(&:strip).reject(&:empty?)

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

# Provenance: a git checkout names its own HEAD (a worktree resolves
# too); an exported tree is the ref it was exported from — pass
# PUBID_REF=<sha> for those.
def ref_of(path, env)
  is_git = File.directory?(File.join(path, ".git")) || File.exist?(File.join(path, ".git"))
  ref = ENV[env] || (is_git ? `git -C #{path} rev-parse HEAD`.strip : nil)
  raise "cannot resolve the ref for #{path} — pass #{env}=<sha>" if ref.nil? || ref.empty?

  [ref, is_git && !system("git", "-C", path, "diff", "--quiet")]
end

pubid_ref, pubid_dirty = ref_of(CHECKOUT, "PUBID_REF")
testsuite_ref, = ref_of(TESTSUITE, "TESTSUITE_REF")

agree_count = inventory.count { |r| r["agree"] } + faces.count { |r| r["agree"] }
consistent = rejected.count { |r| r["ruby"].values.uniq.size == 1 }
fixture = {
  "provenance" => {
    "generator" => "scripts/cen-pfs-parity-ruby-probe.rb",
    "source_spec" => SPEC_REL,
    "inventory" => CORPUS_REL,
    "pubid_ref" => pubid_ref,
    "pubid_version" => version,
    "pubid_dirty_tree" => pubid_dirty,
    "testsuite_ref" => testsuite_ref,
    "notes" =>
      "to_mr_string has no TS counterpart yet (the TS model surface is " \
      "toString/toHash/toUrn/toPubidUrn); the column is recorded so the " \
      "shared set stays complete for both engines, exactly as the etsi_pfs " \
      "fixture records it. The coded flavor here is Pubid::CenCenelec; the " \
      "compiled flavor carries the same scheme-canonical wire tags, so " \
      "to_pubid_urn rides hash parity through the coded schema. The faces " \
      "are the harness's constructed former-gaps inputs (no frozen list in " \
      "the spec to lift); the negatives are extracted fail-loud from it.",
  },
  "inventory" => inventory,
  "faces" => faces,
  "negatives" => rejected,
}
File.write(OUT, JSON.generate(fixture) + "\n")
per_file = inventory.group_by { |r| r["file"] }
                    .transform_values { |rs| rs.count { |r| r["agree"] } }
puts "cen-pfs-parity: #{inventory.size} inventory + #{faces.size} faces " \
     "(#{agree_count} ruby-agree) #{rejected.size} negatives " \
     "(#{consistent} ruby-consistent) -> #{OUT} " \
     "(pubid #{version} @ #{pubid_ref[0, 12]}#{pubid_dirty ? ', DIRTY' : ''}, " \
     "testsuite #{testsuite_ref[0, 12]})"
puts "  ledger: " + per_file.map { |fname, count| "#{fname}=#{count}" }.join(", ")
exit 1 unless agree_count == inventory.size + faces.size && consistent == rejected.size
