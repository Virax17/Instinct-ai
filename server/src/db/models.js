import mongoose from "mongoose";

const encryptedSchema = new mongoose.Schema(
  { iv: String, tag: String, data: String },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: String,
    picture: String,
    timezone: { type: String, default: "UTC" },
  },
  { timestamps: true }
);

const integrationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: String, default: "gmail" },
    scopes: [String],
    refreshTokenEnc: encryptedSchema,
    accessTokenEnc: encryptedSchema,
    expiresAt: Date,
    status: { type: String, enum: ["active", "needs_reauth"], default: "active" },
  },
  { timestamps: true }
);
integrationSchema.index({ userId: 1, provider: 1 }, { unique: true });

const messageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: { type: String, required: true },
  },
  { timestamps: true }
);

const memoryDocSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    path: { type: String, required: true },
    content: { type: String, default: "" },
  },
  { timestamps: true }
);
memoryDocSchema.index({ userId: 1, path: 1 }, { unique: true });

const usageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    model: String,
    purpose: { type: String, default: "agent" },
    inputTokens: Number,
    outputTokens: Number,
    latencyMs: Number,
  },
  { timestamps: true }
);

const toolRunSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    tool: String,
    risk: String,
    input: mongoose.Schema.Types.Mixed,
    output: mongoose.Schema.Types.Mixed,
    status: { type: String, enum: ["ok", "error", "blocked"] },
    durationMs: Number,
  },
  { timestamps: true }
);

export const ToolRun = mongoose.model("ToolRun", toolRunSchema);
export const User =mongoose.model("User", userSchema);
export const Integration = mongoose.model("Integration", integrationSchema);
export const Message = mongoose.model("Message", messageSchema);
export const MemoryDoc = mongoose.model("MemoryDoc", memoryDocSchema);
export const Usage = mongoose.model("Usage", usageSchema);
