import mongoose, { Schema, Document } from "mongoose";

export interface ITicketLogEntry {
  action: string;
  by: string;
  byId: string;
  at: Date;
  detail?: string;
}

export interface ITicketLog extends Document {
  ticketNumber: number;
  guildId: string;
  channelId: string;
  userId: string;
  username: string;
  category: string;
  openedAt: Date;
  closedAt?: Date;
  closedBy?: string;
  transcript: string[];
  logs: ITicketLogEntry[];
}

const LogEntrySchema = new Schema<ITicketLogEntry>({
  action: { type: String, required: true },
  by: { type: String, required: true },
  byId: { type: String, required: true },
  at: { type: Date, default: Date.now },
  detail: { type: String },
});

const TicketLogSchema = new Schema<ITicketLog>({
  ticketNumber: { type: Number, required: true },
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  userId: { type: String, required: true },
  username: { type: String, required: true },
  category: { type: String, required: true },
  openedAt: { type: Date, required: true },
  closedAt: { type: Date },
  closedBy: { type: String },
  transcript: { type: [String], default: [] },
  logs: { type: [LogEntrySchema], default: [] },
});

export const TicketLog = mongoose.model<ITicketLog>("TicketLog", TicketLogSchema);
