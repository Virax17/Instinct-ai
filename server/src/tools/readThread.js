import { z } from "zod";
import { getGmail } from "../integrations/gmail.js";
import { cleanText, htmlToPlain } from "../integrations/emailCleaner.js";

const MAX_MESSAGES = 15;

function header(headers, name) {
  return headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
}

function decode(data) {
  return Buffer.from(data, "base64url").toString("utf8");
}

/** Finds the best body: text/plain preferred, else text/html converted to text. */
function extractBody(payload) {
  const plain = [];
  const html = [];
  (function walk(part) {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) plain.push(decode(part.body.data));
    else if (part.mimeType === "text/html" && part.body?.data) html.push(decode(part.body.data));
    (part.parts ?? []).forEach(walk);
  })(payload);
  if (plain.length) return plain.join("\n");
  if (html.length) return htmlToPlain(html.join("\n"));
  return "";
}

export const readThread = {
  name: "read_thread",
  description:
    "Read a Gmail thread by threadId (from search_emails). Returns each message with sender, recipients, date and cleaned body text (quoted replies and signatures removed).",
  risk: "read",
  untrusted: true,
  schema: z.object({ threadId: z.string().min(1).describe("Thread id from search_emails") }),
  async handler({ userId }, { threadId }) {
    const client = await getGmail(userId);
    const { data } = await client.run((gmail) =>
      gmail.users.threads.get({ userId: "me", id: threadId, format: "full" })
    );

    const all = data.messages ?? [];
    const messages = all.slice(-MAX_MESSAGES); // keep the most recent
    const out = messages.map((m, i) => {
      const h = m.payload?.headers;
      const body = cleanText(extractBody(m.payload)) || m.snippet || "(no text content)";
      return [
        `--- Message ${all.length - messages.length + i + 1} of ${all.length} ---`,
        `From: ${header(h, "from")}`,
        `To: ${header(h, "to")}`,
        header(h, "cc") && `Cc: ${header(h, "cc")}`,
        `Date: ${header(h, "date")}`,
        `Subject: ${header(h, "subject")}`,
        "",
        body,
      ]
        .filter((l) => l !== false)
        .join("\n");
    });
    const note = all.length > messages.length ? `(Showing last ${messages.length} of ${all.length} messages)\n\n` : "";
    return note + out.join("\n\n");
  },
};
