// Web channel adapter: tracks SSE clients per user and converts web requests
// into the standard { userId, text } shape the agent core accepts.
import { handleMessage } from "../agent/orchestrator.js";

const clients = new Map(); // userId -> Set<res>

export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  res.on("close", () => clients.get(userId)?.delete(res));
}

function broadcast(userId, event) {
  for (const res of clients.get(userId) ?? []) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

export function receiveWebMessage({ userId, text }) {
  // Fire and forget: replies arrive over the SSE stream.
  handleMessage({ userId, text }, (event) => broadcast(userId, event));
}
