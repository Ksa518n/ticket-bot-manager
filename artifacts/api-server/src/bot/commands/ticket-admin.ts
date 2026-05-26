import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { Ticket } from "../models/Ticket.js";

export const data = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("أوامر إدارة التذاكر")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addSubcommand((sub) =>
    sub
      .setName("استدعاء")
      .setDescription("استدعاء الشخص الذي فتح التذكرة في القناة الصوتية")
      .addUserOption((opt) =>
        opt.setName("المستخدم").setDescription("المستخدم المراد استدعاؤه").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("اغلاق")
      .setDescription("إغلاق التذكرة الحالية")
      .addStringOption((opt) =>
        opt.setName("السبب").setDescription("سبب الإغلاق").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("تغيير_اسم")
      .setDescription("تغيير اسم قناة التذكرة")
      .addStringOption((opt) =>
        opt.setName("الاسم").setDescription("الاسم الجديد للتذكرة").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("استلام")
      .setDescription("استلام التذكرة وتعيينها لك كمشرف")
  )
  .addSubcommand((sub) =>
    sub
      .setName("معلومات")
      .setDescription("عرض معلومات التذكرة الحالية")
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();
  const channel = interaction.channel as TextChannel;
  const ticket = await Ticket.findOne({ channelId: channel.id, status: "open" });

  if (sub === "استدعاء") {
    const targetUser = interaction.options.getUser("المستخدم");
    const userId = targetUser?.id ?? ticket?.userId;

    if (!userId) {
      await interaction.editReply({ content: "❌ هذه القناة ليست تذكرة مفتوحة أو حدد مستخدماً." });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("📢 استدعاء")
      .setDescription(`<@${userId}> تم استدعاؤك من قبل <@${interaction.user.id}> في هذه التذكرة.`)
      .setColor(0xf39c12)
      .setTimestamp();

    await channel.send({ content: `<@${userId}>`, embeds: [embed] });

    try {
      const member = await interaction.guild!.members.fetch(userId);
      await member.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("📢 استدعاء - تذكرتك")
            .setDescription(
              `تم استدعاؤك من قبل **${interaction.user.tag}** في التذكرة: <#${channel.id}>`
            )
            .setColor(0xf39c12)
            .setTimestamp(),
        ],
      });
    } catch { /* لا يمكن إرسال DM */ }

    await interaction.editReply({ content: "✅ تم إرسال الاستدعاء." });
    return;
  }

  if (sub === "اغلاق") {
    if (!ticket) {
      await interaction.editReply({ content: "❌ هذه القناة ليست تذكرة مفتوحة." });
      return;
    }

    const reason = interaction.options.getString("السبب") ?? "لا يوجد سبب";

    ticket.status = "closed";
    ticket.closedAt = new Date();
    ticket.closedBy = interaction.user.tag;
    await ticket.save();

    try {
      const opener = await interaction.client.users.fetch(ticket.userId);
      await opener.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔒 تم إغلاق تذكرتك")
            .setDescription(
              `تم إغلاق تذكرتك **#${ticket.ticketNumber}** من قبل **${interaction.user.tag}**\n**السبب:** ${reason}`
            )
            .setColor(0xe74c3c)
            .setTimestamp(),
        ],
      });
    } catch { /* لا يمكن إرسال DM */ }

    const closeEmbed = new EmbedBuilder()
      .setTitle("🔒 تم إغلاق التذكرة")
      .setDescription(`**المغلق بواسطة:** ${interaction.user.tag}\n**السبب:** ${reason}`)
      .setColor(0xe74c3c)
      .setTimestamp();

    await channel.send({ embeds: [closeEmbed] });
    await interaction.editReply({ content: "✅ جاري إغلاق التذكرة..." });

    setTimeout(async () => {
      try {
        await channel.delete(`إغلاق التذكرة - ${reason}`);
      } catch { /* قناة مُحذوفة مسبقاً */ }
    }, 5000);
    return;
  }

  if (sub === "تغيير_اسم") {
    if (!ticket) {
      await interaction.editReply({ content: "❌ هذه القناة ليست تذكرة مفتوحة." });
      return;
    }

    const newName = interaction.options.getString("الاسم", true);
    const sanitized = newName.replace(/\s+/g, "-").toLowerCase();

    await channel.setName(`ticket-${sanitized}`);
    ticket.title = newName;
    await ticket.save();

    await interaction.editReply({ content: `✅ تم تغيير اسم التذكرة إلى **ticket-${sanitized}**` });
    return;
  }

  if (sub === "استلام") {
    if (!ticket) {
      await interaction.editReply({ content: "❌ هذه القناة ليست تذكرة مفتوحة." });
      return;
    }

    ticket.claimedBy = interaction.user.id;
    ticket.claimedByName = interaction.user.tag;
    await ticket.save();

    const embed = new EmbedBuilder()
      .setTitle("✅ تم استلام التذكرة")
      .setDescription(`<@${interaction.user.id}> استلم هذه التذكرة وسيقوم بمساعدتك.`)
      .setColor(0x2ecc71)
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    try {
      const opener = await interaction.client.users.fetch(ticket.userId);
      await opener.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ تم استلام تذكرتك")
            .setDescription(
              `قام **${interaction.user.tag}** باستلام تذكرتك **#${ticket.ticketNumber}** وسيساعدك قريباً.`
            )
            .setColor(0x2ecc71)
            .setTimestamp(),
        ],
      });
    } catch { /* لا يمكن إرسال DM */ }

    await interaction.editReply({ content: "✅ تم استلام التذكرة بنجاح." });
    return;
  }

  if (sub === "معلومات") {
    if (!ticket) {
      await interaction.editReply({ content: "❌ هذه القناة ليست تذكرة مفتوحة." });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎫 معلومات التذكرة #${ticket.ticketNumber}`)
      .addFields(
        { name: "👤 المستخدم", value: `<@${ticket.userId}>`, inline: true },
        { name: "📂 القسم", value: ticket.category, inline: true },
        { name: "📌 الحالة", value: ticket.status === "open" ? "🟢 مفتوحة" : "🔴 مغلقة", inline: true },
        { name: "🕐 تاريخ الإنشاء", value: `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:R>`, inline: true },
        {
          name: "🔧 المشرف المستلم",
          value: ticket.claimedByName ? `${ticket.claimedByName}` : "لم يُستلم بعد",
          inline: true,
        }
      )
      .setColor(0x3498db)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  await interaction.editReply({ content: "❌ أمر غير معروف." });
}
