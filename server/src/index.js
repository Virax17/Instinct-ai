import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { config } from "./config.js";
import { router } from "./api/routes.js";

if (!config.anthropicApiKey) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

await mongoose.connect(config.mongoUri);
console.log("MongoDB connected");

const app = express();
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());
app.use("/api", router);

app.listen(config.port, () => console.log(`Server on http://localhost:${config.port}`));
