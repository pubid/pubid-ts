/**
 * The value escape of the pubid-scheme URN — the TS mirror of
 * Pubid::PubidUrn::Escape (lib/pubid/pubid_urn/escape.rb).
 *
 * The URN is also an HTTP path slug (relaton/relaton#441), so it cannot
 * use "%": servers and proxies decode "%2F" before they route, or they
 * refuse it. "~XX" (uppercase hex of one UTF-8 byte) has no meaning in a
 * path, and "~" is an RFC 3986 unreserved character. Every byte outside
 * SAFE is escaped, so ":" "," "(" ")" "~" never occur raw in a value and
 * stay free for the structure of the URN.
 */

import { UrnParseError } from "./errors.js";

const SAFE = /^[A-Za-z0-9._-]$/;
const RAW_TOKEN = /^(?:[A-Za-z0-9._-]|~[0-9A-F]{2})*$/;
const ESCAPE = /~([0-9A-F]{2})/g;

export function encode(value: string): string {
  let out = "";
  // ruby each_char walks code points, not UTF-16 units.
  for (const char of String(value)) {
    out += SAFE.test(char) ? char : force(char);
  }
  return out;
}

/** Escape every byte of `char`. The codec uses it on the first character
 *  of a core value that would otherwise read as structure ("amd" -> "~61md"). */
export function force(char: string): string {
  const bytes = new TextEncoder().encode(char);
  let out = "";
  for (const byte of bytes) {
    out += `~${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function decode(token: string): string {
  const raw = RAW_TOKEN.exec(token);
  if (raw === null || raw[0].length !== token.length) {
    throw new UrnParseError(
      `bad character or escape in pubid URN value ${JSON.stringify(token)}`,
    );
  }
  const bytes: number[] = [];
  let i = 0;
  while (i < token.length) {
    if (token[i] === "~") {
      bytes.push(parseInt(token.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      bytes.push(token.charCodeAt(i));
      i += 1;
    }
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    throw new UrnParseError(
      `escape in pubid URN value ${JSON.stringify(token)} is not UTF-8`,
    );
  }
  return decoded;
}

/** A pattern whose ruby twin ends in \z: the match must cover the whole
 *  string (JS `$` alone would also match before one trailing "\n"). */
export function exactMatch(re: RegExp, token: string): RegExpExecArray | null {
  const m = re.exec(token);
  return m !== null && m[0].length === token.length ? m : null;
}
