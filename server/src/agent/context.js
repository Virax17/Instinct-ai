import { config } from "../config.js";
import { Message, User } from "../db/models.js";
import { readNote } from "../services/memory.js";
import { SYSTEM_PROMPT } from "./prompts.js";

async function loadHistory(userId) {
  const rows = await Message.find({ userId })
    .sort({ createdAt: -1 })
    .limit(config.historyLimit)
    .lean();
  return rows.reverse().map((m) => ({ role: m.role, content: m.text }));
}

/** Assembles the system prompt (static rules + user facts + preferences) and recent messages. */
export async function buildContext(userId) {
  const [user, preferences, messages] = await Promise.all([
    User.findById(userId).lean(),
    readNote(userId, "preferences.md"),
    loadHistory(userId),
  ]);

  const tz = user?.timezone || "UTC";
  const now = new Date().toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" });

  const sections = [
    SYSTEM_PROMPT,
    `# Current context\n- User: ${user?.name ?? "unknown"} <${user?.email ?? "unknown"}>\n- Now: ${now} (${tz})`,
  ];
  if (preferences) sections.push(`# User preferences\n${preferences}`);

  return { system: sections.join("\n\n"), messages };
}

export { loadHistory };
