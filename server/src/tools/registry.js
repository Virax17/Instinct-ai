import { z } from "zod";

/**
 * Tool definition:
 *   { name, description, risk: "read" | "write" | "high", untrusted?: boolean,
 *     schema: zod object, handler: async ({ userId }, input) => string | object }
 * `untrusted: true` means the output contains third-party text (e.g. email) and is
 * wrapped in <email_content> tags by the executor.
 */
const tools = new Map();

export function registerTool(def) {
  if (tools.has(def.name)) throw new Error(`Duplicate tool: ${def.name}`);
  tools.set(def.name, def);
}

export function getTool(name) {
  return tools.get(name);
}

/** Tool list in the Anthropic API shape. */
export function toolSchemas() {
  return [...tools.values()].map((t) => {
    const { $schema, ...input_schema } = z.toJSONSchema(t.schema);
    return { name: t.name, description: t.description, input_schema };
  });
}
