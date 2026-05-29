import mongoose, { Schema, Document } from "mongoose";

export interface ITicketCategory {
  name: string;
  categoryId: string;
  emoji?: string;
}

export interface ITicketConfig extends Document {
  guildId: string;
  categories: ITicketCategory[];
  welcomeMessage: string;
  logChannelId?: string;
  panelDescription?: string;
  panelTitle?: string;
  staffRoleId?: string;
  seniorAdminRoleId?: string;
  blacklistedUsers: string[];
}

const TicketCategorySchema = new Schema<ITicketCategory>({
  name: { type: String, required: true },
  categoryId: { type: String, required: true },
  emoji: { type: String },
});

const TicketConfigSchema = new Schema<ITicketConfig>({
  guildId: { type: String, required: true, unique: true },
  categories: { type: [TicketCategorySchema], default: [] },
  welcomeMessage: {
    type: String,
    default: "مرحباً {user} 👋\nتم فتح تذكرتك **{ticket}** بنجاح.\nسيقوم أحد المشرفين بمساعدتك قريباً، يرجى وصف مشكلتك.",
  },
  logChannelId: { type: String },
  panelDescription: { type: String, default: "اختر القسم المناسب لك من القائمة أدناه." },
  panelTitle: { type: String, default: "🎫 التذاكر" },
  staffRoleId: { type: String },
  seniorAdminRoleId: { type: String },
  blacklistedUsers: { type: [String], default: [] },
});

export const TicketConfig = mongoose.model<ITicketConfig>("TicketConfig", TicketConfigSchema);
