import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  EmbedBuilder,
} from "discord.js";
import { TicketConfig } from "../models/TicketConfig.js";
import { Ticket } from "../models/Ticket.js";

export const data = new SlashCommandBuilder()
  .setName("ticket-config")
  .setDescription("إعدادات نظام التذاكر")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("رسالة_الترحيب")
      .setDescription("تعيين رسالة الترحيب ({user} للمستخدم، {ticket} لرقم التذكرة)")
      .addStringOption((opt) =>
        opt.setName("الرسالة").setDescription("نص رسالة الترحيب").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("قناة_اللوقات")
      .setDescription("تعيين قناة اللوقات")
      .addChannelOption((opt) =>
        opt.setName("القناة").setDescription("القناة").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("رتبة_المشرفين")
      .setDescription("تعيين رتبة المشرفين (يقدرون يستلمون ويديرون التذاكر)")
      .addRoleOption((opt) =>
        opt.setName("الرتبة").setDescription("رتبة المشرفين").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("رتبة_الإدارة_العليا")
      .setDescription("تعيين رتبة الإدارة العليا (يشوفون التذاكر المغلقة ويعيدون فتحها)")
      .addRoleOption((opt) =>
        opt.setName("الرتبة").setDescription("رتبة الإدارة العليا").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("حظر")
      .setDescription("حظر مستخدم من فتح التذاكر")
      .addUserOption((opt) =>
        opt.setName("المستخدم").setDescription("المستخدم المراد حظره").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("رفع_حظر")
      .setDescription("رفع حظر مستخدم من فتح التذاكر")
      .addUserOption((opt) =>
        opt.setName("المستخدم").setDescription("المستخدم المراد رفع حظره").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("إحصائيات").setDescription("عرض إحصائيات التذاكر في السيرفر")
  )
  .addSubcommand((sub) =>
    sub.setName("عرض").setDescription("عرض جميع الإعدادات الحالية")
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
      content: `✅ تم تحديث رسالة الترحيب:\n\`\`\`\n${msg}\n\`\`\``,
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

  if (sub === "رتبة_المشرفين") {
    const role = interaction.options.getRole("الرتبة", true);
    config.staffRoleId = role.id;
    await config.save();
    await interaction.editReply({ content: `✅ تم تعيين رتبة المشرفين: <@&${role.id}>` });
    return;
  }

  if (sub === "رتبة_الإدارة_العليا") {
    const role = interaction.options.getRole("الرتبة", true);
    config.seniorAdminRoleId = role.id;
    await config.save();
    await interaction.editReply({ content: `✅ تم تعيين رتبة الإدارة العليا: <@&${role.id}>` });
    return;
  }

  if (sub === "حظر") {
    const user = interaction.options.getUser("المستخدم", true);
    if (config.blacklistedUsers.includes(user.id)) {
      await interaction.editReply({ content: `❌ المستخدم **${user.tag}** محظور مسبقاً.` });
      return;
    }
    config.blacklistedUsers.push(user.id);
    await config.save();
    await interaction.editReply({ content: `✅ تم حظر **${user.tag}** من فتح التذاكر.` });
    return;
  }

  if (sub === "رفع_حظر") {
    const user = interaction.options.getUser("المستخدم", true);
    const idx = config.blacklistedUsers.indexOf(user.id);
    if (idx === -1) {
      await interaction.editReply({ content: `❌ المستخدم **${user.tag}** غير محظور.` });
      return;
    }
    config.blacklistedUsers.splice(idx, 1);
    await config.save();
    await interaction.editReply({ content: `✅ تم رفع حظر **${user.tag}**.` });
    return;
  }

  if (sub === "إحصائيات") {
    const [total, open, closed] = await Promise.all([
      Ticket.countDocuments({ guildId }),
      Ticket.countDocuments({ guildId, status: "open" }),
      Ticket.countDocuments({ guildId, status: "closed" }),
    ]);

    const byCategory = await Ticket.aggregate([
      { $match: { guildId } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const embed = new EmbedBuilder()
      .setTitle("📊 إحصائيات التذاكر")
      .addFields(
        { name: "📋 إجمالي التذاكر", value: `${total}`, inline: true },
        { name: "🟢 مفتوحة", value: `${open}`, inline: true },
        { name: "🔴 مغلقة", value: `${closed}`, inline: true },
        {
          name: "📂 توزيع الأقسام",
          value: byCategory.length
            ? byCategory.map((c) => `**${c._id}:** ${c.count}`).join("\n")
            : "لا توجد بيانات",
          inline: false,
        }
      )
      .setColor(0x5865f2)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "عرض") {
    await interaction.editReply({
      content: [
        "**⚙️ إعدادات نظام التذاكر:**",
        `📋 **الأقسام:** ${config.categories.length}/5`,
        ...config.categories.map((c) => `  • ${c.name}`),
        `📢 **قناة اللوقات:** ${config.logChannelId ? `<#${config.logChannelId}>` : "❌ غير محددة"}`,
        `🔧 **رتبة المشرفين:** ${config.staffRoleId ? `<@&${config.staffRoleId}>` : "❌ غير محددة"}`,
        `👑 **رتبة الإدارة العليا:** ${config.seniorAdminRoleId ? `<@&${config.seniorAdminRoleId}>` : "❌ غير محددة"}`,
        `🚫 **المحظورون:** ${config.blacklistedUsers.length} مستخدم`,
        `💬 **رسالة الترحيب:**\n\`\`\`\n${config.welcomeMessage}\n\`\`\``,
      ].join("\n"),
    });
    return;
  }
}
