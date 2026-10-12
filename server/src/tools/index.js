import { registerTool } from "./registry.js";
import { searchEmails } from "./searchEmails.js";
import { readThread } from "./readThread.js";

registerTool(searchEmails);
registerTool(readThread);

export { toolSchemas } from "./registry.js";
export { runTool } from "./executor.js";
