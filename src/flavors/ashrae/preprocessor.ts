/**
 * Port of the ashrae parser's self.parse normalization — strip, the
 * !original!canonical fixture format, whitespace/RA/dash normalization,
 * trailing punctuation cleanup, paren balancing, and the "and"-in-
 * addenda-code-list preprocessing.
 */
export function preprocessAshrae(input: string): string {
  let cleaned = input.trim();

  if (cleaned.startsWith("!")) {
    const parts = cleaned.split("!");
    if (parts.length >= 3) cleaned = parts[1]!;
  }

  cleaned = cleaned.replaceAll(/\s+/g, " ");

  cleaned = cleaned.replaceAll(/\(RA\s+(\d{4})\)/g, "(RA $1)");
  cleaned = cleaned.replaceAll(/RA\s+(\d{4})/g, "RA $1");

  cleaned = cleaned.replace(/[,.]$/, "");
  cleaned = cleaned.replaceAll("))", ")");

  const open = (cleaned.match(/\(/g) ?? []).length;
  const close = (cleaned.match(/\)/g) ?? []).length;
  if (open > close) cleaned = cleaned + ")".repeat(open - close);

  cleaned = cleaned.replaceAll(/-\s+/g, "-");
  cleaned = cleaned.replaceAll(/\s+/g, " ");

  if (/\bAddenda\s+/.test(cleaned) || /\bAddendum\s+/.test(cleaned)) {
    const boundary = /\s+(?:to|for|\()/;
    const match = cleaned.match(boundary);
    if (match !== null && match.index !== undefined) {
      const pos = cleaned.indexOf(match[0]);
      const before = cleaned.slice(0, pos);
      const after = cleaned.slice(pos);
      cleaned =
        before.replaceAll(/,\s+and\s+/gi, ", ").replaceAll(/\s+and\s+/gi, ", ") +
        after;
    } else {
      cleaned = cleaned
        .replaceAll(/,\s+and\s+/gi, ", ")
        .replaceAll(/\s+and\s+/gi, ", ");
    }

    cleaned = cleaned.replaceAll(
      /\bAddendum\s+([a-z]+)\s*,\s*/gi,
      (_m, code: string) => `Addenda ${code}, `,
    );
  }

  return cleaned;
}
