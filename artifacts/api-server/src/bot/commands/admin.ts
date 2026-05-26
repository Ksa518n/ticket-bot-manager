import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
  ChannelType,
} from "discord.js";
import { Ticket } from "../models/Ticket.js";
import { TicketLog } from "../models/TicketLog.js";
import { TicketConfig } from "../models/TicketConfig.js";
import mongoose from "mongoose";

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("أوامر الإدارة العليا للبوت")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("حذف_التذاكر")
      .setDescription("حذف جميع قنوات التذاكر وبياناتها من قاعدة البيانات")
      .addStringOption((opt) =>
        opt
          .setName("نوع")
          .setDescription("ما الذي تريد حذفه؟")
          .setRequired(true)
          .addChoices(
            { name: "المفتوحة فقط", value: "open" },
            { name: "المغلقة فقط", value: "closed" },
            { name: "الكل", value: "all" },
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("مسح_البيانات")
      .setDescription("مسح جميع بيانات البوت من قاعدة البيانات (تذاكر + سجلات + إعدادات)")
      .addBooleanOption((opt) =>
        opt
          .setName("حذف_الإعدادات")
          .setDescription("هل تريد حذف إعدادات البوت أيضاً؟ (سيتطلب إعادة ضبط كامل)")
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  // ─── حذف قنوات التذاكر ────────────────────────────────────────────────────
  if (sub === "حذف_التذاكر") {
    const type = interaction.options.getString("نوع", true) as "open" | "closed" | "all";

    const query = type === "all" ? { guildId: guild.id } : { guildId: guild.id, status: type };
    const tickets = await Ticket.find(query);

    if (tickets.length === 0) {
      await interaction.editReply({ content: "✅ لا توجد تذاكر لحذفها." });
      return;
    }

    await interaction.editReply({
      content: `⏳ جارٍ حذف **${tickets.length}** تذكرة... قد يستغرق ذلك بعض الوقت.`,
    });

    let deletedChannels = 0;
    let failedChannels = 0;

    for (const ticket of tickets) {
      try {
        const ch = guild.channels.cache.get(ticket.channelId)
          ?? await guild.channels.fetch(ticket.channelId).catch(() => null);
        if (ch && (ch.type === ChannelType.GuildText)) {
          await (ch as TextChannel).delete("حذف جميع التذاكر بأمر إداري");
          deletedChannels++;
        }
      } catch {
        failedChannels++;
      }
    }

    // حذف من قاعدة البيانات
    const channelIds = tickets.map((t) => t.channelId);
    await Ticket.deleteMany(query);
    await TicketLog.deleteMany({ channelId: { $in: channelIds } });

    const resultEmbed = new EmbedBuilder()
      .setTitle("🗑️ تم حذف التذاكر")
      .addFields(
        { name: "📋 النوع المحذوف", value: type === "open" ? "المفتوحة" : type === "closed" ? "المغلقة" : "الكل", inline: true },
        { name: "✅ قنوات حُذفت", value: `${deletedChannels}`, inline: true },
        { name: "❌ فشل الحذف", value: `${failedChannels}`, inline: true },
        { name: "🗄️ سجلات حُذفت من DB", value: `${tickets.length}`, inline: true },
        { name: "👤 بواسطة", value: interaction.user.tag, inline: true },
      )
      .setColor(0xe74c3c)
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [resultEmbed] });
    return;
  }

  // ─── مسح بيانات قاعدة البيانات ───────────────────────────────────────────
  if (sub === "مسح_البيانات") {
    const deleteConfig = interaction.options.getBoolean("حذف_الإعدادات", true);

    const db = mongoose.connection.db;
    if (!db) {
      await interaction.editReply({ content: "❌ لا يوجد اتصال بقاعدة البيانات." });
      return;
    }

    // احصاء قبل الحذف
    const ticketCount  = await Ticket.countDocuments({ guildId: guild.id });
    const logCount     = await TicketLog.countDocuments({ guildId: guild.id });

    await Ticket.deleteMany({ guildId: guild.id });
    await TicketLog.deleteMany({ guildId: guild.id });

    // حذف العداد
    const Counter = mongoose.models["Counter"] ?? mongoose.model("Counter", new mongoose.Schema({ guildId: String }));
    await Counter.deleteMany({ guildId: guild.id });

    let configDeleted = false;
    if (deleteConfig) {
      await TicketConfig.deleteMany({ guildId: guild.id });
      configDeleted = true;
    }

    const resultEmbed = new EmbedBuilder()
      .setTitle("🧹 تم مسح البيانات")
      .setDescription(deleteConfig
        ? "⚠️ تم حذف جميع البيانات بما فيها الإعدادات. يجب إعادة ضبط البوت باستخدام `/ticket-config`."
        : "تم حذف بيانات التذاكر مع الاحتفاظ بإعدادات البوت.")
      .addFields(
        { name: "🎫 تذاكر مُحذفة", value: `${ticketCount}`, inline: true },
        { name: "📋 سجلات مُحذفة", value: `${logCount}`, inline: true },
        { name: "⚙️ إعدادات مُحذفة", value: configDeleted ? "نعم ⚠️" : "لا ✅", inline: true },
        { name: "🔢 العداد أُعيد", value: "نعم", inline: true },
        { name: "👤 بواسطة", value: interaction.user.tag, inline: true },
      )
      .setColor(0xe74c3c)
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [resultEmbed] });
    return;
  }

  await interaction.editReply({ content: "❌ أمر غير معروف." });
}
