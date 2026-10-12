export const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/instinct-ai",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  maxTokens: 2000,
  historyLimit: 30,
};
