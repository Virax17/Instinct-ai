import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: { type: String, required: true },
  },
  { timestamps: true }
);

const usageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    model: String,
    inputTokens: Number,
    outputTokens: Number,
    latencyMs: Number,
  },
  { timestamps: true }
);

export const Message = mongoose.model("Message", messageSchema);
export const Usage = mongoose.model("Usage", usageSchema);
