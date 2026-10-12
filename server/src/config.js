const env = process.env;

export const config = {
  port: Number(env.PORT) || 5000,
  mongoUri: env.MONGODB_URI || "mongodb://127.0.0.1:27017/instinct-ai",
  clientOrigin: env.CLIENT_ORIGIN || "http://localhost:5173",
  isProd: env.NODE_ENV === "production",

  anthropicApiKey: env.ANTHROPIC_API_KEY,
  model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  maxTokens: 2000,
  historyLimit: 30,

  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI || "http://localhost:5000/auth/google/callback",
    // Step 3 asks for read access only. compose/send are added in step 5.
    scopes: [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
  },

  jwtSecret: env.JWT_SECRET,
  tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
  sessionDays: 7,
};

export function assertConfig() {
  const required = {
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    GOOGLE_CLIENT_ID: config.google.clientId,
    GOOGLE_CLIENT_SECRET: config.google.clientSecret,
    JWT_SECRET: config.jwtSecret,
    TOKEN_ENCRYPTION_KEY: config.tokenEncryptionKey,
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}. See .env.example.`);
    process.exit(1);
  }
}
