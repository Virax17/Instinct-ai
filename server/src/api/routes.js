import { Router } from "express";
import { addClient, receiveWebMessage } from "../channels/web.js";
import { loadHistory } from "../agent/context.js";
import { getGmailProfile } from "../integrations/gmail.js";
import { requireAuth } from "./middleware.js";

export const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true }));

router.use(requireAuth);

router.get("/history", async (req, res) => {
  const history = await loadHistory(req.userId);
  res.json(history.map((m) => ({ role: m.role, text: m.content })));
});

// Verifies the backend can reach the user's inbox (step 3 "done when").
router.get("/gmail/status", async (req, res) => {
  try {
    res.json({ connected: true, ...(await getGmailProfile(req.userId)) });
  } catch (err) {
    res.json({
      connected: false,
      reason: err.code === "needs_reauth" ? "needs_reauth" : "error",
      message: err.message,
    });
  }
});

router.post("/messages", (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  receiveWebMessage({ userId: req.userId, text });
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
  addClient(req.userId, res);
});
