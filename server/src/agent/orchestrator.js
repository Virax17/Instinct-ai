import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { Message, Usage } from "../db/models.js";
import { buildContext, loadHistory } from "./context.js";
import { runTool, toolSchemas } from "../tools/index.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const MAX_ITERATIONS = 8;

/**
 * Channel-agnostic entry point. Input: { userId, text }.
 * Calls emit({ type, ... }) with "status" and "delta" events, then "done" or "error".
 *
 * Tool loop: the model replies with text or tool_use blocks. Tool calls run through the
 * executor (which enforces risk rules), results go back to the model, repeat until a
 * final answer or MAX_ITERATIONS.
 */
export async function handleMessage({ userId, text }, emit) {
  await Message.create({ userId, role: "user", text });

  try {
    const { system, messages } = await buildContext(userId);
    const tools = toolSchemas();
    let reply = "";

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const started = Date.now();
      const stream = anthropic.messages.stream({
        model: config.model,
        max_tokens: config.maxTokens,
        system,
        tools,
        messages,
      });

      let separate = reply.length > 0; // keep text from separate turns apart
      stream.on("text", (delta) => {
        if (separate) {
          emit({ type: "delta", text: "\n\n" });
          reply += "\n\n";
          separate = false;
        }
        reply += delta;
        emit({ type: "delta", text: delta });
      });
      const res = await stream.finalMessage();

      await Usage.create({
        userId,
        model: config.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        latencyMs: Date.now() - started,
      });

      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason !== "tool_use") break;

      const calls = res.content.filter((b) => b.type === "tool_use");
      const results = await Promise.all(calls.map((call) => runTool({ userId, call, emit })));
      messages.push({ role: "user", content: results });

      if (i === MAX_ITERATIONS - 1) {
        const note = "\n\n(I stopped because this took too many steps. Ask me to continue if you want more.)";
        reply += note;
        emit({ type: "delta", text: note });
      }
    }

    const saved = await Message.create({ userId, role: "assistant", text: reply || "(no response)" });
    emit({ type: "done", id: String(saved._id) });
  } catch (err) {
    console.error("agent error:", err);
    emit({ type: "error", message: err.message || "Agent failed" });
  }
}

export { loadHistory };
