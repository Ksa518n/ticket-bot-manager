import mongoose, { Schema, Document } from "mongoose";

export interface ITicket extends Document {
  ticketNumber: number;
  channelId: string;
  guildId: string;
  userId: string;
  username: string;
  category: string;
  categoryId: string;
  status: "open" | "closed";
  claimedBy?: string;
  claimedByName?: string;
  createdAt: Date;
  closedAt?: Date;
  closedBy?: string;
  reopenedAt?: Date;
  reopenedBy?: string;
  title: string;
}

const TicketSchema = new Schema<ITicket>({
  ticketNumber: { type: Number, required: true },
  channelId: { type: String, required: true },
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  username: { type: String, required: true },
  category: { type: String, required: true },
  categoryId: { type: String, required: true },
  status: { type: String, enum: ["open", "closed"], default: "open" },
  claimedBy: { type: String },
  claimedByName: { type: String },
  createdAt: { type: Date, default: Date.now },
  closedAt: { type: Date },
  closedBy: { type: String },
  reopenedAt: { type: Date },
  reopenedBy: { type: String },
  title: { type: String, required: true },
});

export const Ticket = mongoose.model<ITicket>("Ticket", TicketSchema);
