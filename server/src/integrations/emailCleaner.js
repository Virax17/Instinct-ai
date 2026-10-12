import { convert } from "html-to-text";

const HTML_OPTIONS = {
  wordwrap: false,
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
    { selector: "style", format: "skip" },
    { selector: "script", format: "skip" },
  ],
};

// Lines that start the quoted history of a reply; everything after is dropped.
const QUOTE_START = [
  /^On .{5,200}wrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^_{5,}\s*$/,
  /^From:\s.+/i, // Outlook-style header block (only honored after some content)
  /^Le .{5,200}a écrit\s*:\s*$/i,
];
const SIGNATURE_START = [/^-- ?$/, /^Sent from my /i, /^Get Outlook for /i];
const FOOTER_NOISE = [/unsubscribe/i, /view (this email )?in (your )?browser/i, /^you are receiving this/i];

export function htmlToPlain(html) {
  return convert(html, HTML_OPTIONS);
}

/** Strips quoted replies, signatures, tracking/footers and extra whitespace. */
export function cleanText(raw, { maxChars = 4000 } = {}) {
  const lines = String(raw ?? "").replace(/\r\n/g, "\n").split("\n");
  const kept = [];

  for (const line of lines) {
    const t = line.trim();
    if (SIGNATURE_START.some((re) => re.test(t))) break;
    if (kept.length > 0 && QUOTE_START.some((re) => re.test(t))) break;
    if (t.startsWith(">")) continue;
    if (FOOTER_NOISE.some((re) => re.test(t)) && t.length < 200) continue;
    kept.push(line.replace(/\s+$/, ""));
  }

  let text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > maxChars) text = text.slice(0, maxChars).trimEnd() + "\n[...truncated]";
  return text;
}
