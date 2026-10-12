import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { User } from "../db/models.js";
import { newOAuthClient, saveTokens } from "../integrations/gmail.js";
import { COOKIE, requireAuth, setSession } from "./middleware.js";

export const authRouter = Router();
const STATE_COOKIE = "oauth_state";

authRouter.get("/google", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: 10 * 60 * 1000,
  });
  const url = newOAuthClient().generateAuthUrl({
    access_type: "offline", // returns a refresh token
    prompt: "consent", // forces a refresh token on every sign-in
    include_granted_scopes: true,
    scope: config.google.scopes,
    state,
  });
  res.redirect(url);
});

authRouter.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const back = (q) => res.redirect(`${config.clientOrigin}/?${q}`);
  try {
    if (error) return back(`auth_error=${encodeURIComponent(String(error))}`);
    if (!code || !state || state !== req.cookies[STATE_COOKIE]) return back("auth_error=bad_state");
    res.clearCookie(STATE_COOKIE);

    const client = newOAuthClient();
    const { tokens } = await client.getToken(String(code));
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.google.clientId,
    });
    const p = ticket.getPayload();

    const user = await User.findOneAndUpdate(
      { googleId: p.sub },
      { $set: { email: p.email, name: p.name, picture: p.picture } },
      { upsert: true, new: true }
    );
    await saveTokens(user._id, tokens);
    setSession(res, user._id);
    back("signed_in=1");
  } catch (err) {
    console.error("oauth callback failed:", err.message);
    back("auth_error=callback_failed");
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).lean();
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  res.json({ id: String(user._id), email: user.email, name: user.name, picture: user.picture });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});
