# frozen_string_literal: true

# The ruby-side parity-fixture generator for the eu + arxiv TS ports
# (pubid#752 + #753, the gem flavors landed at 2.0.44). The SSOT is the
# gem itself: the generated fixture corpus (spec/fixtures/{eu,arxiv}/,
# full/ classified into pass/ and fail/ by the gem's classify task) plus
# the review-regression rows of spec/pubid/{eu,arxiv}/identifier_spec.rb,
# and the number-order sweep (eu's %w[R L D] x year x number grid) that
# locks the ambiguous <number>/<year> vs <year>/<number> prints.
#
# This script exports every row with the reference outputs the gem at
# THIS checkout produces - to_s, the canonical to_hash, both URN faces,
# the with_publisher:false face, the CELEX/ELI faces, the number-order
# flag - into the JSON the TS parity test reads
# (test/fixtures/eu-arxiv-parity.json.gz after gen-eu-arxiv-parity).
#
#   ruby scripts/eu-arxiv-parity-ruby-probe.rb <pubid-checkout> <out.json>
#
# <pubid-checkout> must be a pubid checkout carrying the eu + arxiv
# flavors (main >= fe08a252, 2.0.44). Regenerate and commit whenever the
# gem's eu/arxiv behavior moves - the TS test fails on a row it cannot
# reproduce.
require "json"

CHECKOUT = ARGV[0] or
  raise "usage: ruby scripts/eu-arxiv-parity-ruby-probe.rb <pubid-checkout> <out.json>"
OUT = ARGV[1] or
  raise "usage: ruby scripts/eu-arxiv-parity-ruby-probe.rb <pubid-checkout> <out.json>"

$LOAD_PATH.unshift File.expand_path("lib", CHECKOUT)
require "pubid"
require "pubid/eu"
require "pubid/arxiv"

# Fail-loud identity (the stale-checkout hazard): everything below must
# run against THIS checkout's lib, never an installed gem.
LIB_DIR = File.realpath(File.expand_path("lib", CHECKOUT))
eu_loc = Pubid::Eu::Identifier.method(:parse).source_location.first
arxiv_loc = Pubid::Arxiv::Identifier.method(:parse).source_location.first
raise "loaded #{eu_loc}, not #{LIB_DIR} - the stale-checkout hazard" unless File.realpath(eu_loc).start_with?(LIB_DIR)
raise "loaded #{arxiv_loc}, not #{LIB_DIR} - the stale-checkout hazard" unless File.realpath(arxiv_loc).start_with?(LIB_DIR)
VERSION = File.read(File.join(CHECKOUT, "lib/pubid/version.rb"))[/VERSION = "([^"]+)"/, 1]
raise "expected the eu/arxiv flavor release (2.0.44), got #{VERSION.inspect}" unless VERSION == "2.0.44"

# --- fixture corpus (the gem's spec/fixtures/{eu,arxiv}) ---------------------

def read_fixture_file(path)
  File.readlines(path).map(&:strip).reject do |line|
    line.empty? || line.start_with?("#")
  end
end

def read_pass_entries(path)
  read_fixture_file(path).map do |line|
    match = line.match(/\A!(.+)!(.+)\z/)
    match ? [match[1], match[2]] : [line, line]
  end
end

def read_fail_inputs(path)
  File.readlines(path).filter_map do |line|
    match = line.strip.match(/\A#(.+)# .+\z/)
    match && match[1]
  end
end

FIXTURE_ROOT = File.join(CHECKOUT, "spec/fixtures")

def flavor_fixtures(flavor)
  root = File.join(FIXTURE_ROOT, flavor, "identifiers")
  pass = Dir[File.join(root, "pass", "*.txt")].sort
    .flat_map { |f| read_pass_entries(f) }
  fail = Dir[File.join(root, "fail", "*.txt")].sort
    .flat_map { |f| read_fail_inputs(f) }
  full = read_fixture_file(File.join(root, "full", "#{flavor == "eu" ? "identifiers" : "eprint"}.txt"))
  classified = pass.map(&:first) + fail
  raise "#{flavor}: pass/fail do not conserve full/" unless classified.sort == full.sort
  [pass, fail]
end

# --- reference faces ----------------------------------------------------------

def face_row(flavor, id, input)
  row = {
    "input" => input,
    "rendered" => id.to_s,
    "to_s" => id.to_s,
    "hash" => id.to_hash,
    "pubid_urn" => id.to_pubid_urn,
    "urn" => id.to_urn,
    "bare" => id.to_s(with_publisher: false),
  }
  if flavor == "eu"
    row["celex"] = id.to_celex
    row["eli"] = id.to_eli
    row["family"] = id.family
    row["number_first"] = id.number_first
  else
    row["root_number"] = id.root.number
  end
  row
end

def face_rows(flavor, entries, extra_inputs: [])
  pass_rows = []
  entries.each do |(input, rendered)|
    id = flavor == "eu" ? Pubid::Eu.parse(input) : Pubid::Arxiv.parse(input)
    row = face_row(flavor, id, input)
    row["rendered"] = rendered
    pass_rows << row
  end
  extra_inputs.each do |input|
    begin
      id = flavor == "eu" ? Pubid::Eu.parse(input) : Pubid::Arxiv.parse(input)
    rescue Pubid::Errors::ParseError
      pass_rows << { "input" => input, "rejects" => true }
      next
    end
    pass_rows << face_row(flavor, id, input)
  end
  pass_rows
end

def fail_rows(flavor, inputs)
  inputs.map do |input|
    begin
      flavor == "eu" ? Pubid::Eu.parse(input) : Pubid::Arxiv.parse(input)
      raise "#{input} unexpectedly parsed"
    rescue Pubid::Errors::ParseError => e
      { "input" => input, "error" => "ParseError", "message" => e.message }
    end
  end
end

# --- the eu number-order sweep (identifier_spec.rb) ---------------------------
#
# Every CELEX row of the R/L/D x year x number grid, with the two human
# prints the act produces (publisher on and off): the TS port must parse
# each print back onto the same identity, in both orders and without the
# publisher - the property that forced the renderer's "No" disambiguation.

def eu_sweep
  rows = []
  %w[R L D].product([1952, 2003, 2014, 2015, 2025],
                    [1, 679, 1952, 2003, 2014, 2015, 2100]) do |letter, year, number|
    id = Pubid::Eu.parse(format("3%<y>d%<l>s%<n>04d", y: year, l: letter, n: number))
    [nil, true, false].each do |order|
      act = Pubid::Eu::Identifier.from_hash(
        id.to_hash.merge("number_first" => order).compact,
      )
      rows << {
        "input" => act.to_s,
        "hash" => act.to_hash,
        "bare" => act.to_s(with_publisher: false),
      }
    end
  end
  rows
end

# --- matching (identifier_spec.rb's matching blocks) --------------------------
#
# `subset` is Ruby ===: the reference states every part it carries; `eq`
# is Ruby ==, exact canonical equality (the equality_ignored flag skips).

def match_rows(flavor, pairs)
  parse = ->(s) { flavor == "eu" ? Pubid::Eu.parse(s) : Pubid::Arxiv.parse(s) }
  pairs.map do |(a, b)|
    { "a" => a, "b" => b,
      "subset" => parse.call(a) === parse.call(b),
      "eq" => parse.call(a) == parse.call(b) }
  end
end

EU_MATCHES = [
  ["EU Regulation 1227/2011", "Regulation (EU) No 1227/2011"],
  ["EU Regulation 1227/2011", "EU Regulation 1227/2012"],
  ["EU Regulation 1227/2011", "EU Decision 1227/2011"],
  ["EU Decision 1082/2013", "32013D1082"],
  ["EU Directive 2016/680", "EU Directive 2016/681"],
].freeze

ARXIV_MATCHES = [
  ["arXiv:2301.00001", "arXiv:2301.00001v1"],
  ["arXiv:2301.00001", "arXiv:2301.00001v2"],
  ["2301.00001v1", "2301.00001v2"],
  ["2301.00001v1", "2401.00001v1"],
  ["hep-th/9901001", "math/9901001"],
  ["math/9901001", "math.GT/9901001"],
  ["arxiv 2301.00001v1", "arXiv:2301.00001v1"],
].freeze

eu_pass, eu_fail = flavor_fixtures("eu")
arxiv_pass, arxiv_fail = flavor_fixtures("arxiv")

doc = {
  "version" => VERSION,
  "eu" => {
    "pass" => face_rows("eu", eu_pass,
                        extra_inputs: ["EU Decision No 2012/2010", "32010D1999"]),
    "fail" => fail_rows("eu", eu_fail + ["nonsense"]),
    "sweep" => eu_sweep,
    "matches" => match_rows("eu", EU_MATCHES),
  },
  "arxiv" => {
    "pass" => face_rows("arxiv", arxiv_pass),
    "fail" => fail_rows("arxiv", arxiv_fail +
                      ["nonsense", "2301.00001 ", "arXiv:2301.00001 "]),
    "matches" => match_rows("arxiv", ARXIV_MATCHES),
  },
}

File.write(OUT, JSON.pretty_generate(doc))
puts "eu: #{doc['eu']['pass'].size} pass + #{doc['eu']['fail'].size} fail + " \
     "#{doc['eu']['sweep'].size} sweep + #{doc['eu']['matches'].size} matches; " \
     "arxiv: #{doc['arxiv']['pass'].size} pass + #{doc['arxiv']['fail'].size} fail + " \
     "#{doc['arxiv']['matches'].size} matches -> #{OUT}"
