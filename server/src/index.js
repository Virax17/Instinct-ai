import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { assertConfig, config } from "./config.js";
import { router } from "./api/routes.js";
import { authRouter } from "./api/auth.js";

assertConfig();

await mongoose.connect(config.mongoUri);
console.log("MongoDB connected");

const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/auth", authRouter);
app.use("/api", router);

app.listen(config.port, () => console.log(`Server on http://localhost:${config.port}`));
