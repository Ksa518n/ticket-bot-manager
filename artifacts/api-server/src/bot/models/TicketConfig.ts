import mongoose, { Schema, Document } from "mongoose";

export interface ITicketCategory {
  name: string;
  categoryId: string;
}

export interface ITicketConfig extends Document {
  guildId: string;
  categories: ITicketCategory[];
  welcomeMessage: string;
  logChannelId?: string;
  panelDescription?: string;
}

const TicketCategorySchema = new Schema<ITicketCategory>({
  name: { type: String, required: true },
  categoryId: { type: String, required: true },
});

const TicketConfigSchema = new Schema<ITicketConfig>({
  guildId: { type: String, required: true, unique: true },
  categories: { type: [TicketCategorySchema], default: [] },
  welcomeMessage: {
    type: String,
    default: "مرحباً {user}! تم فتح تذكرتك بنجاح.\nسيقوم أحد المشرفين بمساعدتك قريباً.",
  },
  logChannelId: { type: String },
  panelDescription: { type: String, default: "اختر القسم المناسب لك من القائمة أدناه." },
});

export const TicketConfig = mongoose.model<ITicketConfig>("TicketConfig", TicketConfigSchema);
