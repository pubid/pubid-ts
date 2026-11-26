# frozen_string_literal: true

# The ruby-side parity-fixture generator for the bsi_pfs TS port
# (pubid/pubid#706 §4, the module-composition proof flavor; pubid-ts#227).
# The SSOT of the inventory is the Ruby harness itself —
# spec/pubid/bsi_pfs/parity_spec.rb: the FULL bsi corpus gate (the 1,500
# payload rows over every bsi payload file in a pubid-testsuite checkout
# — the harness's own corpus source and row filters), the pinned
# BSI_PFS_LEDGER extracted fail-loud from the spec (843 absorbed /
# 657 unabsorbed / 0 classified), the harness's declared negatives and
# boundary rows lifted straight out of the spec, and the constructed
# composition faces the harness's module-composition block asserts on.
#
# The 657 unabsorbed rows are the CONTRACT, not an omission: the bsi_pfs
# composition refuses what its model cannot represent, and the rows
# leave the surface as parse failures — never wrong classes. This script
# exports exactly that set, plus the reference outputs both RUBY flavors
# produce for it, into the fixture the TS parity test reads
# (test/fixtures/bsi-pfs-parity.json.gz after gen-bsi-pfs-parity).
#
#   ruby scripts/bsi-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>
#
# <pubid-checkout> must be a pubid checkout carrying bsi_pfs at its
# measured boundary (main >= pubid#706 §4, 2.0.41). Regenerate and
# commit whenever the harness's gate moves — the TS test fails on a
# stale fixture (a row the TS set cannot reproduce names itself).
#
# The committed artifact is the GZIP of this output
# (test/fixtures/bsi-pfs-parity.json.gz, node zlib level 9 — the
# gen-cen-pfs-parity.mjs convention), compressed by
# scripts/gen-bsi-pfs-parity.mjs.
require "json"

SPEC_REL = "spec/pubid/bsi_pfs/parity_spec.rb"
CORPUS_REL = "tests/bsi"
CHECKOUT = ARGV[0] or
  raise "usage: ruby scripts/bsi-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"
TESTSUITE = ARGV[1] or
  raise "usage: ruby scripts/bsi-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"
OUT = ARGV[2] or
  raise "usage: ruby scripts/bsi-pfs-parity-ruby-probe.rb <pubid-checkout> <testsuite-checkout> <out.json>"

$LOAD_PATH.unshift File.expand_path("lib", CHECKOUT)
require "pubid"

# Fail-loud identity (the stale-checkout hazard): everything below must
# run against THIS checkout's lib, never an installed gem. Both sides
# go through realpath — macOS /tmp resolves to /private/tmp.
Pubid.eager_load_flavors!
LIB_DIR = File.realpath(File.expand_path("lib", CHECKOUT))
parse_loc = Pubid::BsiPfs::Identifier.method(:parse).source_location.first
raise "loaded #{parse_loc}, not #{LIB_DIR} — the stale-checkout hazard" unless File.realpath(parse_loc).start_with?(LIB_DIR)
version = File.read(File.join(CHECKOUT, "lib/pubid/version.rb"))[/VERSION = "([^"]+)"/, 1]
raise "cannot read the checkout's version" if version.nil?

spec_source = File.read(File.join(CHECKOUT, SPEC_REL))

# The harness's pinned ledger, extracted fail-loud from the spec (a spec
# edit that moves the ledger must move this extractor consciously).
LEDGER = begin
  body = spec_source[/BSI_PFS_LEDGER = \{(.*?)\}\.freeze/m, 1]
  raise "cannot extract BSI_PFS_LEDGER from #{SPEC_REL} — the harness moved, update this extractor" if body.nil?

  eval("{ #{body} }") # rubocop:disable Security/Eval — the spec's own frozen literal
end

# The harness's quoted row blocks, extracted fail-loud: the first is the
# declared negatives (both flavors reject), the second the boundary (the
# coded flavor accepts them from OTHER families; the composition
# refuses).
BLOCKS = spec_source.scan(/^\s*'\n(.*?)^\s*'\.split\("\\n"\)/m).map(&:first)
raise "cannot extract the quoted row blocks from #{SPEC_REL} — the harness moved, update this extractor" if BLOCKS.size != 2

NEGATIVE_INPUTS = BLOCKS[0].split("\n").map(&:strip).reject(&:empty?).freeze
BOUNDARY_INPUTS = BLOCKS[1].split("\n").map(&:strip).reject(&:empty?).freeze

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

    rows << { "file" => fname, "id" => test_case.id, "input" => test_case.representations.human }
  end
end

FLAVORS = { "bsi" => Pubid::Bsi, "bsi_pfs" => Pubid::BsiPfs }.freeze

# The surfaces the coded flavor exposes and the compiled one must match
# (the harness's own list; to_mr_string has no TS counterpart yet, the
# column is recorded so the shared set stays complete for both engines).
SURFACES = %i[to_s to_hash to_urn to_pubid_urn to_mr_string].freeze

safe_call = lambda do |id, meth|
  id.public_send(meth)
rescue StandardError
  "RAISE:#{::Pubid::Errors::InvalidInputError}"
end

def outputs_of(flavor_class, input)
  identifier = flavor_class.parse(input)
  {
    "to_s" => identifier.to_s,
    "to_hash" => Pubid::Conformance.plainify(identifier.to_hash),
    "to_mr_string" => (identifier.to_mr_string rescue "RAISE:#{::Pubid::Errors::InvalidInputError}"),
    "to_urn" => identifier.to_urn,
    "to_pubid_urn" => identifier.to_pubid_urn,
  }
end

# The classification pass, exactly the harness's: absorbed / classified
# (signature → rows) / unabsorbed / coded_error.
measured = Hash.new do |h, k|
  h[k] = { absorbed: [], classified: Hash.new { |hh, kk| hh[kk] = [] },
           unabsorbed: [], coded_error: [] }
end
absorbed_rows = []
rows.each do |row|
  fname = row["file"]
  input = row["input"]
  coded = begin
    Pubid::Bsi.parse(input)
  rescue StandardError => e
    measured[fname][:coded_error] << [row["id"], input, e.class.name.split("::").last]
    next
  end

  pfs = begin
    Pubid::BsiPfs.parse(input)
  rescue ::Pubid::Errors::ParseError
    measured[fname][:unabsorbed] << [row["id"], input].freeze
    next
  rescue StandardError => e
    measured[fname][:unabsorbed] << [row["id"], input,
                                     "NON-PARSE-ERROR:#{e.class.name.split('::').last}"].freeze
    next
  end

  diffs = SURFACES.filter_map do |m|
    safe_call.call(pfs, m) == safe_call.call(coded, m) ? nil : m
  end
  class_diverged = pfs.class.name.split("::").last != coded.class.name.split("::").last

  if diffs.empty? && !class_diverged
    measured[fname][:absorbed] << row
    absorbed_rows << {
      "file" => fname,
      "id" => row["id"],
      "input" => input,
      "ruby" => FLAVORS.transform_values { |klass| outputs_of(klass, input) },
      "agree" => true,
    }
  else
    signature = ([class_diverged ? "class" : nil] + diffs).compact.join("+")
    measured[fname][:classified][signature] << row["id"]
  end
end

# The pinned boundary: the measured absorption must equal the extracted
# ledger exactly — a corpus addition or a regression turns this red and
# forces a conscious ledger update on BOTH sides.
actual_ledger = measured.to_h do |fname, groups|
  [fname,
   { absorbed: groups[:absorbed].size,
     classified: groups[:classified].transform_values(&:size),
     unabsorbed: groups[:unabsorbed].size }]
end
if actual_ledger != LEDGER
  raise "the measured boundary moved off the pinned ledger: " +
        actual_ledger.reject { |k, v| LEDGER[k] == v }.inspect
end
unless measured.values.sum { |g| g[:classified].values.map(&:size).sum }.zero?
  raise "the harness pins zero classified rows — a divergence signature appeared"
end
wrong_class = measured.values.flat_map { |g| g[:unabsorbed] }
                           .select { |r| r[2].to_s.start_with?("NON-PARSE-ERROR") }
raise "an unabsorbed row raised a non-parse error: #{wrong_class.first.inspect}" unless wrong_class.empty?
coded_errors = measured.values.sum { |g| g[:coded_error].size }
raise "the coded flavor failed on #{coded_errors} corpus rows" unless coded_errors.zero?
unless actual_ledger.keys.sort == LEDGER.keys.sort
  raise "the ledger must cover every payload file: #{actual_ledger.keys.sort.inspect}"
end

# The constructed composition faces: the harness's module-composition
# block asserts on these inputs; lifted here so the TS side exercises
# the same constructed set. A spec edit that moves them must move this
# list consciously (they are literal, not extracted — the spec has no
# frozen FACES list to lift).
FACES = [
  # national.prefix over the plain BS face
  "BS 10005:1995",
  # en.overlay over the cen inner
  "BS EN 1073-2:2002",
  # the multi-level chain: BSI wrapper over a CEN adoption over ISO
  "BS EN ISO 105-B06:2020",
  # iso.inner and iec.inner as the adopted inners
  "BS ISO 8601:2019", "BS IEC 60747-8:2000",
  # the national head over the DD designations adopting CEN documents
  "DD CEN ISO/TS 12180-1:2007",
  # the IEC-internal runs stay inside the delegated adoption
  "BS EN IEC 60601-1/FRAG1", "BS EN IEC 61535/AMD1/FRAG1",
  # supplements.core: the consolidated bundles over the composition
  "BS 10125:2014+A1:2016", "BS EN 1005-1:2001+A1:2008",
  # the typed trio (the designation faces)
  "PAS 003:1994", "PD 5730", "DD 136-2:1986", "TS 1:1995",
  # the glued adopted edition face
  "BS HD IEC 60364-8-81 ED1",
  # the glued letter and the part's dash in the URN
  "BS 1000A:1961", "BS 1016-107.2:1991", "BS 5550-1.3.3:1980",
].freeze

faces = FACES.map do |input|
  per_flavor = FLAVORS.transform_values { |klass| outputs_of(klass, input) }
  agree = per_flavor["bsi"].all? do |method, coded_out|
    per_flavor["bsi_pfs"][method] == coded_out
  end
  { "input" => input, "ruby" => per_flavor, "agree" => agree }
end

# The declared negatives: BOTH flavors reject.
negatives = NEGATIVE_INPUTS.map do |input|
  per_flavor = FLAVORS.transform_values do |klass|
    begin
      klass.parse(input)
      "accepted"
    rescue ::Pubid::Errors::ParseError
      "rejected"
    end
  end
  { "input" => input, "ruby" => per_flavor }
end

# The boundary rows: the coded flavor parses them (from OTHER families),
# the composed flavor refuses what its model cannot represent.
boundary = BOUNDARY_INPUTS.map do |input|
  per_flavor = FLAVORS.transform_values do |klass|
    begin
      klass.parse(input)
      "accepted"
    rescue ::Pubid::Errors::ParseError
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

absorbed_total = measured.values.sum { |g| g[:absorbed].size }
unabsorbed_total = measured.values.sum { |g| g[:unabsorbed].size }
fixture = {
  "provenance" => {
    "generator" => "scripts/bsi-pfs-parity-ruby-probe.rb",
    "source_spec" => SPEC_REL,
    "inventory" => CORPUS_REL,
    "pubid_ref" => pubid_ref,
    "pubid_version" => version,
    "pubid_dirty_tree" => pubid_dirty,
    "testsuite_ref" => testsuite_ref,
    "notes" =>
      "to_mr_string has no TS counterpart yet (the TS model surface is " \
      "toString/toHash/toUrn/toPubidUrn); the column is recorded so the " \
      "shared set stays complete for both engines, exactly as the cen_pfs " \
      "fixture records it. The coded flavor here is Pubid::Bsi; the " \
      "compiled flavor carries the same scheme-canonical wire tags, so " \
      "to_pubid_urn rides hash parity through the coded schema. The " \
      "ledger rows are the 657-row unabsorbed boundary, fail-closed " \
      "exactly as the gem pins them: each must stay a parse rejection in " \
      "the TS engine, never a wrong class. The faces are the harness's " \
      "constructed composition inputs (no frozen list in the spec to " \
      "lift); the negatives and boundary rows are extracted fail-loud " \
      "from the spec's quoted blocks.",
  },
  "inventory" => absorbed_rows,
  "faces" => faces,
  "negatives" => negatives,
  "boundary" => boundary,
  "ledger" => measured.values.flat_map { |g| g[:unabsorbed] }
                      .map { |r| { "id" => r[0], "input" => r[1] } },
}
File.write(OUT, JSON.generate(fixture) + "\n")
per_file = actual_ledger.map { |fname, counts| "#{fname}=#{counts[:absorbed]}+#{counts[:unabsorbed]}" }
puts "bsi-pfs-parity: #{absorbed_total} absorbed + #{unabsorbed_total} unabsorbed " \
     "(#{faces.size} faces, #{negatives.size} negatives, #{boundary.size} boundary) -> #{OUT} " \
     "(pubid #{version} @ #{pubid_ref[0, 12]}#{pubid_dirty ? ', DIRTY' : ''}, " \
     "testsuite #{testsuite_ref[0, 12]})"
puts "  ledger: " + per_file.join(", ")
exit 1 unless faces.all? { |f| f["agree"] } &&
               negatives.all? { |r| r["ruby"].values.uniq == ["rejected"] } &&
               boundary.all? { |r| r["ruby"] == { "bsi" => "accepted", "bsi_pfs" => "rejected" } }
