import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { Message, Usage } from "../db/models.js";
import { SYSTEM_PROMPT } from "./prompts.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

async function loadHistory(userId) {
  const rows = await Message.find({ userId })
    .sort({ createdAt: -1 })
    .limit(config.historyLimit)
    .lean();
  return rows.reverse().map((m) => ({ role: m.role, content: m.text }));
}

/**
 * Channel-agnostic entry point. Input: { userId, text }.
 * Calls emit({ type, ... }) with "delta" events, then "done" or "error".
 */
export async function handleMessage({ userId, text }, emit) {
  await Message.create({ userId, role: "user", text });
  const messages = await loadHistory(userId);
  const started = Date.now();

  try {
    const stream = anthropic.messages.stream({
      model: config.model,
      max_tokens: config.maxTokens,
      system: SYSTEM_PROMPT,
      messages,
    });
    stream.on("text", (delta) => emit({ type: "delta", text: delta }));
    const final = await stream.finalMessage();

    const reply = final.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const saved = await Message.create({ userId, role: "assistant", text: reply });
    await Usage.create({
      userId,
      model: config.model,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      latencyMs: Date.now() - started,
    });
    emit({ type: "done", id: String(saved._id) });
  } catch (err) {
    console.error("agent error:", err);
    emit({ type: "error", message: err.message || "Agent failed" });
  }
}

export { loadHistory };
