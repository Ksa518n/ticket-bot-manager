import mongoose, { Schema, Document } from "mongoose";

export interface ITicketCategory {
  name: string;
  categoryId: string;
}

export interface ITicketConfig extends Document {
  guildId: string;
  categories: ITicketCategory[];
  ticketCounter: number;
  logChannelId?: string;
  staffRoleId?: string;
}

const TicketCategorySchema = new Schema<ITicketCategory>({
  name: { type: String, required: true },
  categoryId: { type: String, required: true },
});

const TicketConfigSchema = new Schema<ITicketConfig>({
  guildId: { type: String, required: true, unique: true },
  categories: { type: [TicketCategorySchema], default: [] },
  ticketCounter: { type: Number, default: 1000 },
  logChannelId: { type: String },
  staffRoleId: { type: String },
});

export const TicketConfig = mongoose.model<ITicketConfig>("TicketConfig", TicketConfigSchema);
