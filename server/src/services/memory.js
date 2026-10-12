import { MemoryDoc } from "../db/models.js";

export async function readNote(userId, path) {
  const doc = await MemoryDoc.findOne({ userId, path }).lean();
  return doc?.content ?? null;
}

export async function writeNote(userId, path, content) {
  await MemoryDoc.updateOne({ userId, path }, { $set: { content } }, { upsert: true });
}
