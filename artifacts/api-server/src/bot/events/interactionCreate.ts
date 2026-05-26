import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  PermissionFlagsBits,
  TextChannel,
  CategoryChannel,
} from "discord.js";
import { Ticket } from "../models/Ticket.js";
import { TicketConfig } from "../models/TicketConfig.js";
import { getNextTicketNumber } from "../models/Counter.js";
import { commands } from "../commands/index.js";

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const command = commands.find((c) => c.data.name === interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "❌ حدث خطأ.", ephemeral: true });
      } else {
        await interaction.reply({ content: "❌ حدث خطأ.", ephemeral: true });
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "ticket_category_select") {
    await handleCategorySelect(interaction);
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === "ticket_open_panel") {
      await handleOpenPanel(interaction);
      return;
    }
    if (interaction.customId === "ticket_close") {
      await handleTicketClose(interaction);
      return;
    }
    if (interaction.customId === "ticket_claim_btn") {
      await handleClaimButton(interaction);
      return;
    }
  }
}

async function handleOpenPanel(interaction: ButtonInteraction): Promise<void> {
  const config = await TicketConfig.findOne({ guildId: interaction.guildId! });
  if (!config || config.categories.length === 0) {
    await interaction.reply({ content: "❌ لا توجد أقسام مضافة بعد.", ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("🎫 التذاكر")
    .setDescription(
      `**اختر القسم المناسب لك:**\n\n${config.categories.map((c) => `🎫 ${c.name}`).join("\n")}`
    )
    .setColor(0xe67e22)
    .setTimestamp();

  const options = config.categories.map((cat) =>
    new StringSelectMenuOptionBuilder().setLabel(cat.name).setValue(cat.name).setEmoji("🎫")
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category_select")
    .setPlaceholder("اختر قسم التذكرة...")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function handleCategorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;
  const selectedCategory = interaction.values[0];
  const config = await TicketConfig.findOne({ guildId });

  if (!config) {
    await interaction.editReply({ content: "❌ لا يوجد إعداد للتذاكر." });
    return;
  }

  const catConfig = config.categories.find((c) => c.name === selectedCategory);
  if (!catConfig) {
    await interaction.editReply({ content: "❌ القسم غير موجود." });
    return;
  }

  const existingTicket = await Ticket.findOne({
    guildId,
    userId: interaction.user.id,
    status: "open",
  });

  if (existingTicket) {
    await interaction.editReply({
      content: `❌ لديك تذكرة مفتوحة بالفعل: <#${existingTicket.channelId}>`,
    });
    return;
  }

  const ticketNumber = await getNextTicketNumber(guildId);
  const guild = interaction.guild!;

  const category = guild.channels.cache.get(catConfig.categoryId) as CategoryChannel | undefined;

  const channel = await guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: category ?? null,
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: interaction.client.user!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  const ticket = new Ticket({
    ticketNumber,
    channelId: channel.id,
    guildId,
    userId: interaction.user.id,
    username: interaction.user.tag,
    category: selectedCategory,
    categoryId: catConfig.categoryId,
    status: "open",
    title: `تذكرة #${ticketNumber}`,
  });
  await ticket.save();

  const staffCount = guild.members.cache.filter(
    (m) => m.permissions.has(PermissionFlagsBits.ManageChannels) && !m.user.bot
  ).size;

  const embed = new EmbedBuilder()
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL() ?? undefined,
    })
    .setTitle(`⚡ ${guild.name}`)
    .addFields(
      { name: "👤 [مفتوحة بواسطة]", value: `<@${interaction.user.id}>`, inline: false },
      { name: "🔧 [المسؤولين والإدارة]", value: `@المشرفين`, inline: false },
      { name: "🕐 [تم الإنشاء]", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false },
      { name: "🟢 [المشرفين المتاحين]", value: `${staffCount}`, inline: false },
      { name: "🔢 [رقم التذكرة]", value: `#${ticketNumber}`, inline: false },
      { name: "📁 [القسم]", value: `${selectedCategory}`, inline: false }
    )
    .setColor(0x2f3136)
    .setThumbnail(interaction.user.displayAvatarURL())
    .setFooter({
      text: `${guild.name} TICKET | Today at ${new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    })
    .setTimestamp();

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("👥 خيارات المستخدم")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ticket_claim_btn")
      .setLabel("🔧 خيارات المشرف")
      .setStyle(ButtonStyle.Secondary)
  );

  const adminRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("🔨 خيارات المسؤول")
      .setStyle(ButtonStyle.Success)
  );

  await (channel as TextChannel).send({
    content: `<@${interaction.user.id}>`,
    embeds: [embed],
    components: [closeRow, adminRow],
  });

  try {
    await interaction.user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎫 تم فتح تذكرتك")
          .setDescription(
            `تم فتح تذكرتك في **${guild.name}**\n**القسم:** ${selectedCategory}\n**رقم التذكرة:** #${ticketNumber}\n**الرابط:** <#${channel.id}>`
          )
          .setColor(0x2ecc71)
          .setTimestamp(),
      ],
    });
  } catch { /* المستخدم أغلق الرسائل الخاصة */ }

  await interaction.editReply({
    content: `✅ تم فتح تذكرتك: <#${channel.id}>`,
  });
}

async function handleClaimButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "❌ ليس لديك صلاحية استلام التذاكر.", ephemeral: true });
    return;
  }

  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "❌ هذه التذكرة غير موجودة أو مغلقة.", ephemeral: true });
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

  await interaction.reply({ embeds: [embed] });

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
}

async function handleTicketClose(interaction: ButtonInteraction): Promise<void> {
  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "❌ هذه التذكرة مغلقة بالفعل.", ephemeral: true });
    return;
  }

  const canClose =
    interaction.user.id === ticket.userId ||
    (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false);

  if (!canClose) {
    await interaction.reply({ content: "❌ ليس لديك صلاحية إغلاق هذه التذكرة.", ephemeral: true });
    return;
  }

  ticket.status = "closed";
  ticket.closedAt = new Date();
  ticket.closedBy = interaction.user.tag;
  await ticket.save();

  const embed = new EmbedBuilder()
    .setTitle("🔒 تم إغلاق التذكرة")
    .setDescription(`تم إغلاق التذكرة بواسطة <@${interaction.user.id}>`)
    .setColor(0xe74c3c)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });

  try {
    const opener = await interaction.client.users.fetch(ticket.userId);
    await opener.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🔒 تم إغلاق تذكرتك")
          .setDescription(
            `تم إغلاق تذكرتك **#${ticket.ticketNumber}** في **${interaction.guild?.name}** بواسطة **${interaction.user.tag}**`
          )
          .setColor(0xe74c3c)
          .setTimestamp(),
      ],
    });
  } catch { /* لا يمكن إرسال DM */ }

  setTimeout(async () => {
    try {
      await (interaction.channel as TextChannel).delete("إغلاق التذكرة");
    } catch { /* قناة مُحذوفة مسبقاً */ }
  }, 5000);
}
