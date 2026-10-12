import { ToolRun } from "../db/models.js";
import { getTool } from "./registry.js";

const MAX_OUTPUT_CHARS = 20000;

/** Wraps third-party text so the model treats it as data. Neutralizes tag break-out. */
export function wrapUntrusted(text) {
  const safe = String(text).replace(/<\/?email_content>/gi, "[tag removed]");
  return `<email_content>\n${safe}\n</email_content>`;
}

function describe(call) {
  const i = call.input ?? {};
  if (call.name === "search_emails") return `Searching email: ${i.query ?? ""}`;
  if (call.name === "read_thread") return "Reading email thread";
  return `Running ${call.name}`;
}

/**
 * Runs one tool_use block and returns a tool_result block for the model.
 * Risk is enforced here, in code: read/write tools run, "high" tools never run directly.
 */
export async function runTool({ userId, call, emit }) {
  const started = Date.now();
  const tool = getTool(call.name);
  const result = (content, isError = false) => ({
    type: "tool_result",
    tool_use_id: call.id,
    content,
    ...(isError && { is_error: true }),
  });

  const log = (status, output) =>
    ToolRun.create({
      userId,
      tool: call.name,
      risk: tool?.risk,
      input: call.input,
      output: typeof output === "string" ? output.slice(0, 5000) : output,
      status,
      durationMs: Date.now() - started,
    }).catch((e) => console.error("tool log failed:", e.message));

  if (!tool) {
    await log("error", "unknown tool");
    return result(`Unknown tool: ${call.name}`, true);
  }

  const parsed = tool.schema.safeParse(call.input);
  if (!parsed.success) {
    const msg = `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
    await log("error", msg);
    return result(msg, true);
  }

  if (tool.risk === "high") {
    // Approval flow arrives in step 5. Until then, high-risk tools cannot run.
    await log("blocked", "high-risk tool requires approval");
    return result("This action requires user approval, which is not available yet. Tell the user you cannot do it.", true);
  }

  emit?.({ type: "status", message: describe(call) });
  try {
    const out = await tool.handler({ userId }, parsed.data);
    let text = typeof out === "string" ? out : JSON.stringify(out);
    if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS) + "\n[...output truncated]";
    if (tool.untrusted) text = wrapUntrusted(text);
    await log("ok", text);
    return result(text);
  } catch (err) {
    console.error(`tool ${call.name} failed:`, err.message);
    await log("error", err.message);
    return result(`Tool failed: ${err.message}`, true);
  }
}
