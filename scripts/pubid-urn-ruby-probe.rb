# frozen_string_literal: true

# The ruby-side parity fixture generator for the pubid-ts pubid-scheme URN
# port (pubid-ts#161). Walks a pubid-testsuite tests/ tree, and for every
# corpus case carrying an identifier hash records:
#   - urn:  what the reference codec emits for that hash (Encoder over the
#     hash directly - the same input the TS encoder takes),
#   - rt:   whether the reference round-trips it by to_hash
#     (Decoder -> from_hash -> re-encode == urn),
#   - idem: whether Pubid.from_hash(hash).to_hash == hash.
#
#   ruby scripts/pubid-urn-ruby-probe.rb <tests-dir> <out.json> <pubid-checkout>
#
# <pubid-checkout> is a pubid ruby checkout whose lib/ carries the
# pubid-scheme URN codec (main). scripts/gen-pubid-urn-parity.mjs then
# merges the output into test/fixtures/pubid-urn-parity.json.gz.
require "json"
require "yaml"

TESTS = ARGV[0] or raise "usage: ruby scripts/pubid-urn-ruby-probe.rb <tests-dir> <out.json> <pubid-checkout>"
OUT = ARGV[1] or raise "usage: ruby scripts/pubid-urn-ruby-probe.rb <tests-dir> <out.json> <pubid-checkout>"
PUBID_REF = ARGV[2] or raise "usage: ruby scripts/pubid-urn-ruby-probe.rb <tests-dir> <out.json> <pubid-checkout>"

$LOAD_PATH.unshift File.expand_path("lib", PUBID_REF)
require "pubid"

def deep_equal(a, b)
  # Ruby Hash#== is order-insensitive and recursive; arrays are ordered.
  if a.is_a?(Hash) && b.is_a?(Hash)
    return false unless a.size == b.size
    a.all? { |k, v| b.key?(k) && deep_equal(v, b[k]) }
  elsif a.is_a?(Array) && b.is_a?(Array)
    return false unless a.size == b.size
    a.zip(b).all? { |x, y| deep_equal(x, y) }
  else
    a == b
  end
end

def diff_keys(got, want, path = "")
  out = []
  (want.keys | got.keys).sort.each do |k|
    p = "#{path}/#{k}"
    if !want.key?(k)
      out << "#{p} extra"
    elsif !got.key?(k)
      out << "#{p} missing"
    elsif !deep_equal(got[k], want[k])
      if got[k].is_a?(Hash) && want[k].is_a?(Hash)
        out.concat(diff_keys(got[k], want[k], p))
      else
        out << "#{p} #{want[k].inspect[0, 60]} -> #{got[k].inspect[0, 60]}"
      end
    end
  end
  out
end

def deep_dup(v)
  case v
  when Hash then v.to_h { |k, x| [k, deep_dup(x)] }
  when Array then v.map { |x| deep_dup(x) }
  else v
  end
end

result = {}
Dir.glob(File.join(TESTS, "*")).sort.each do |dir|
  next unless File.directory?(dir)
  flavor = File.basename(dir)
  rows = []
  skipped = 0
  Dir.glob(File.join(dir, "*.yaml")).sort.each do |file|
    next if File.basename(file).start_with?("_")
    doc = YAML.safe_load(File.read(file), permitted_classes: [], aliases: true)
    next unless doc.is_a?(Array)
    doc.each do |row|
      hash = row["identifier"]
      if hash.nil?
        skipped += 1
        next
      end
      entry = { "id" => row["id"] }
      begin
        urn = "#{Pubid::PubidUrn::PREFIX}#{Pubid::PubidUrn::Encoder.new(hash).body}"
        entry["urn"] = urn
      rescue StandardError => e
        entry["urn_error"] = "#{e.class}: #{e.message[0, 160]}"
        rows << entry
        next
      end
      begin
        back = Pubid::PubidUrn::Decoder.new(urn.delete_prefix(Pubid::PubidUrn::PREFIX)).to_identifier_hash
        entry["rt"] = deep_equal(back, hash)
      rescue StandardError => e
        entry["rt_error"] = "#{e.class}: #{e.message[0, 160]}"
      end
      begin
        id = Pubid.from_hash(deep_dup(hash))
        idem = deep_equal(id.to_hash, hash)
        entry["idem"] = idem
        unless idem
          entry["idem_diff"] = diff_keys(id.to_hash, hash)
        end
        canonical = id.to_pubid_urn
        entry["canonical"] = canonical == urn
      rescue StandardError => e
        entry["idem_error"] = "#{e.class}: #{e.message[0, 160]}"
      end
      rows << entry
    end
  end
  result[flavor] = { "rows" => rows, "skipped" => skipped }
  warn "#{flavor}: #{rows.size} rows (#{skipped} skipped)"
end

File.write(OUT, JSON.generate(result))
warn "wrote #{OUT}"
