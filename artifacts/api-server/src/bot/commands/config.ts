import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from "discord.js";
import { TicketConfig } from "../models/TicketConfig.js";

export const data = new SlashCommandBuilder()
  .setName("ticket-config")
  .setDescription("إعدادات نظام التذاكر")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("رسالة_الترحيب")
      .setDescription("تعيين رسالة الترحيب عند فتح التذكرة")
      .addStringOption((opt) =>
        opt
          .setName("الرسالة")
          .setDescription(
            "نص رسالة الترحيب. استخدم {user} لذكر صاحب التذكرة و {ticket} لرقمها"
          )
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("قناة_اللوقات")
      .setDescription("تعيين قناة اللوقات لتسجيل أحداث التذاكر")
      .addChannelOption((opt) =>
        opt
          .setName("القناة")
          .setDescription("القناة المخصصة للوقات")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("عرض")
      .setDescription("عرض الإعدادات الحالية")
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;
  const sub = interaction.options.getSubcommand();

  let config = await TicketConfig.findOne({ guildId });
  if (!config) {
    config = new TicketConfig({ guildId, categories: [] });
    await config.save();
  }

  if (sub === "رسالة_الترحيب") {
    const msg = interaction.options.getString("الرسالة", true);
    config.welcomeMessage = msg;
    await config.save();
    await interaction.editReply({
      content: `✅ تم تحديث رسالة الترحيب:\n\`\`\`\n${msg}\n\`\`\`\n**المتغيرات:** \`{user}\` لذكر صاحب التذكرة، \`{ticket}\` لرقم التذكرة`,
    });
    return;
  }

  if (sub === "قناة_اللوقات") {
    const ch = interaction.options.getChannel("القناة", true) as TextChannel;
    config.logChannelId = ch.id;
    await config.save();
    await interaction.editReply({ content: `✅ تم تعيين قناة اللوقات: <#${ch.id}>` });
    return;
  }

  if (sub === "عرض") {
    await interaction.editReply({
      content: [
        "**⚙️ إعدادات نظام التذاكر:**",
        `📋 **الأقسام:** ${config.categories.length}/5`,
        config.categories.map((c) => `  • ${c.name}`).join("\n"),
        `📢 **قناة اللوقات:** ${config.logChannelId ? `<#${config.logChannelId}>` : "غير محددة"}`,
        `💬 **رسالة الترحيب:**\n\`\`\`\n${config.welcomeMessage}\n\`\`\``,
      ].join("\n"),
    });
    return;
  }
}
