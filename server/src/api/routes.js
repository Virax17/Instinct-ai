import { Router } from "express";
import { addClient, receiveWebMessage } from "../channels/web.js";
import { loadHistory } from "../agent/orchestrator.js";

// Single local user until Google sign-in lands in step 3.
const LOCAL_USER = "local";

export const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true }));

router.get("/history", async (_req, res) => {
  const history = await loadHistory(LOCAL_USER);
  res.json(history.map((m) => ({ role: m.role, text: m.content })));
});

router.post("/messages", (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  receiveWebMessage({ userId: LOCAL_USER, text });
  res.status(202).json({ accepted: true });
});

router.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(": connected\n\n");
  addClient(LOCAL_USER, res);
});
