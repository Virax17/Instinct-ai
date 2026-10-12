import { z } from "zod";
import { getGmail } from "../integrations/gmail.js";

const MAX_LIMIT = 20;

function header(headers, name) {
  return headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
}

export const searchEmails = {
  name: "search_emails",
  description:
    "Search the user's Gmail using native Gmail search syntax (e.g. 'from:ahmed newer_than:7d', 'is:unread has:attachment', 'subject:invoice after:2026/01/01'). " +
    "Returns up to `limit` matching threads with sender, subject, date and a snippet. Use read_thread to read the full content.",
  risk: "read",
  untrusted: true,
  schema: z.object({
    query: z.string().min(1).describe("Gmail search query"),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe("Max threads to return (default 10)"),
  }),
  async handler({ userId }, { query, limit = 10 }) {
    const client = await getGmail(userId);
    const list = await client.run((gmail) =>
      gmail.users.messages.list({ userId: "me", q: query, maxResults: Math.min(limit * 2, 50) })
    );

    // One row per thread (newest message first).
    const seen = new Set();
    const ids = [];
    for (const m of list.data.messages ?? []) {
      if (seen.has(m.threadId)) continue;
      seen.add(m.threadId);
      ids.push(m.id);
      if (ids.length >= limit) break;
    }
    if (ids.length === 0) return "No emails matched this query.";

    const rows = await Promise.all(
      ids.map(async (id) => {
        const { data } = await client.run((gmail) =>
          gmail.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
          })
        );
        const h = data.payload?.headers;
        return {
          threadId: data.threadId,
          from: header(h, "from"),
          subject: header(h, "subject"),
          date: header(h, "date"),
          unread: data.labelIds?.includes("UNREAD") ?? false,
          snippet: data.snippet ?? "",
        };
      })
    );
    return rows;
  },
};
