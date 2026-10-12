import { google } from "googleapis";
import { config } from "../config.js";
import { Integration } from "../db/models.js";
import { decrypt, encrypt } from "../services/crypto.js";

export function newOAuthClient() {
  const { clientId, clientSecret, redirectUri } = config.google;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Saves tokens from the OAuth exchange. Keeps the old refresh token if Google omits a new one. */
export async function saveTokens(userId, tokens) {
  const update = { status: "active" };
  if (tokens.scope) update.scopes = tokens.scope.split(" ").filter(Boolean);
  if (tokens.expiry_date) update.expiresAt = new Date(tokens.expiry_date);
  if (tokens.access_token) update.accessTokenEnc = encrypt(tokens.access_token);
  if (tokens.refresh_token) update.refreshTokenEnc = encrypt(tokens.refresh_token);
  await Integration.updateOne({ userId, provider: "gmail" }, { $set: update }, { upsert: true });
}

export class ReauthRequired extends Error {
  constructor() {
    super("Gmail access expired. Please sign in with Google again.");
    this.code = "needs_reauth";
  }
}

/** Returns an authorized Gmail client. Refreshed access tokens are persisted automatically. */
export async function getGmail(userId) {
  const integ = await Integration.findOne({ userId, provider: "gmail" });
  if (!integ || integ.status !== "active" || !integ.refreshTokenEnc) throw new ReauthRequired();

  const auth = newOAuthClient();
  auth.setCredentials({
    refresh_token: decrypt(integ.refreshTokenEnc),
    access_token: integ.accessTokenEnc ? decrypt(integ.accessTokenEnc) : undefined,
    expiry_date: integ.expiresAt?.getTime(),
  });
  auth.on("tokens", (t) => saveTokens(userId, t).catch((e) => console.error("token save failed", e)));

  const gmail = google.gmail({ version: "v1", auth });
  return {
    gmail,
    /** Runs a Gmail call; maps a revoked/expired grant to ReauthRequired and flags the integration. */
    async run(fn) {
      try {
        return await fn(gmail);
      } catch (err) {
        const revoked = err?.response?.data?.error === "invalid_grant" || String(err?.message).includes("invalid_grant");
        if (revoked) {
          await Integration.updateOne({ userId, provider: "gmail" }, { $set: { status: "needs_reauth" } });
          throw new ReauthRequired();
        }
        throw err;
      }
    },
  };
}

export async function getGmailProfile(userId) {
  const client = await getGmail(userId);
  const { data } = await client.run((gmail) => gmail.users.getProfile({ userId: "me" }));
  return { email: data.emailAddress, messagesTotal: data.messagesTotal, threadsTotal: data.threadsTotal };
}
