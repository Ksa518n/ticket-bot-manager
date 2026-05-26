import mongoose, { Schema, Document } from "mongoose";

export interface ICounter extends Document {
  guildId: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  guildId: { type: String, required: true, unique: true },
  seq: { type: Number, default: 1000 },
});

export const Counter = mongoose.model<ICounter>("Counter", CounterSchema);

export async function getNextTicketNumber(guildId: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { guildId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}
