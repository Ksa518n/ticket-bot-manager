import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import { TicketConfig } from "../models/TicketConfig.js";

export const data = new SlashCommandBuilder()
  .setName("setup-ticket")
  .setDescription("إضافة أو حذف قسم تذاكر (حد أقصى 5 أقسام)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("اضافة")
      .setDescription("إضافة قسم تذاكر جديد")
      .addStringOption((opt) =>
        opt.setName("اسم_القسم").setDescription("اسم قسم التذكرة").setRequired(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName("الكاتجوري")
          .setDescription("الكاتجوري التي ستُفتح فيها تذاكر هذا القسم")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("إيموجي").setDescription("الإيموجي الخاص بالقسم (اختياري)").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("حذف")
      .setDescription("حذف قسم تذاكر موجود")
      .addStringOption((opt) =>
        opt.setName("اسم_القسم").setDescription("اسم القسم المراد حذفه").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("عرض").setDescription("عرض الأقسام الحالية")
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;
  const sub = interaction.options.getSubcommand();

  let config = await TicketConfig.findOne({ guildId });
  if (!config) {
    config = new TicketConfig({ guildId, categories: [] });
  }

  if (sub === "اضافة") {
    const name = interaction.options.getString("اسم_القسم", true);
    const category = interaction.options.getChannel("الكاتجوري", true);
    const emoji = interaction.options.getString("إيموجي");

    if (config.categories.length >= 5) {
      await interaction.editReply({ content: "❌ وصلت للحد الأقصى (5 أقسام). احذف قسماً أولاً." });
      return;
    }
    if (config.categories.find((c) => c.name === name)) {
      await interaction.editReply({ content: `❌ القسم **${name}** موجود مسبقاً.` });
      return;
    }

    config.categories.push({ name, categoryId: category.id, emoji: emoji ?? undefined });
    await config.save();
    await interaction.editReply({
      content: `✅ تم إضافة قسم **${name}** ${emoji ? emoji : ""} — الأقسام: **${config.categories.length}/5**\nاستخدم \`/ticket-panel\` لإرسال بانل التذاكر.`,
    });
    return;
  }

  if (sub === "حذف") {
    const name = interaction.options.getString("اسم_القسم", true);
    const idx = config.categories.findIndex((c) => c.name === name);
    if (idx === -1) {
      await interaction.editReply({ content: `❌ القسم **${name}** غير موجود.` });
      return;
    }
    config.categories.splice(idx, 1);
    await config.save();
    await interaction.editReply({ content: `✅ تم حذف قسم **${name}** — الأقسام المتبقية: **${config.categories.length}/5**` });
    return;
  }

  if (sub === "عرض") {
    if (config.categories.length === 0) {
      await interaction.editReply({ content: "📂 لا توجد أقسام مضافة بعد." });
      return;
    }
    await interaction.editReply({
      content: `**📂 الأقسام الحالية (${config.categories.length}/5):**\n${config.categories.map((c, i) => `${i + 1}. ${c.emoji ? c.emoji : "🎫"} **${c.name}** — <#${c.categoryId}>`).join("\n")}`,
    });
    return;
  }
}
