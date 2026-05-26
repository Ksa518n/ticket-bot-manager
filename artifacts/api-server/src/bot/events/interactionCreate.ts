import {
  Interaction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  TextChannel,
  CategoryChannel,
  Colors,
} from "discord.js";
import { Ticket } from "../models/Ticket.js";
import { TicketConfig } from "../models/TicketConfig.js";
import { TicketLog } from "../models/TicketLog.js";
import { getNextTicketNumber } from "../models/Counter.js";
import { commands } from "../commands/index.js";
import { logger } from "../../lib/logger.js";

// ─── helpers ───────────────────────────────────────────────────────────────

function isAdmin(interaction: { memberPermissions: { has: (p: bigint) => boolean } | null }): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
}

async function sendLog(
  interaction: { client: import("discord.js").Client; guild: import("discord.js").Guild | null },
  guildId: string,
  embed: EmbedBuilder
): Promise<void> {
  try {
    const config = await TicketConfig.findOne({ guildId });
    if (!config?.logChannelId) return;
    const ch = interaction.guild?.channels.cache.get(config.logChannelId) as TextChannel | undefined;
    await ch?.send({ embeds: [embed] });
  } catch { /* قناة اللوقات غير متاحة */ }
}

function buildActionMenu(isStaff: boolean): ActionRowBuilder<StringSelectMenuBuilder> {
  const userOptions = [
    new StringSelectMenuOptionBuilder()
      .setLabel("إغلاق التذكرة")
      .setValue("ticket_action:close")
      .setDescription("إغلاق هذه التذكرة")
      .setEmoji("🔒"),
  ];

  const staffOptions = [
    new StringSelectMenuOptionBuilder()
      .setLabel("استلام التذكرة")
      .setValue("ticket_action:claim")
      .setDescription("استلام التذكرة كمشرف")
      .setEmoji("✅"),
    new StringSelectMenuOptionBuilder()
      .setLabel("ترك التذكرة")
      .setValue("ticket_action:unclaim")
      .setDescription("ترك التذكرة لمشرف آخر")
      .setEmoji("🚪"),
    new StringSelectMenuOptionBuilder()
      .setLabel("استدعاء صاحب التذكرة")
      .setValue("ticket_action:summon")
      .setDescription("إرسال رسالة خاصة لصاحب التذكرة")
      .setEmoji("📢"),
    new StringSelectMenuOptionBuilder()
      .setLabel("تغيير اسم التذكرة")
      .setValue("ticket_action:rename")
      .setDescription("تغيير اسم قناة التذكرة")
      .setEmoji("✏️"),
  ];

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_action_menu")
    .setPlaceholder("اختر إجراء...")
    .addOptions(isStaff ? [...userOptions, ...staffOptions] : userOptions);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

// ─── main handler ──────────────────────────────────────────────────────────

export async function handleInteraction(interaction: Interaction): Promise<void> {
  // slash commands
  if (interaction.isChatInputCommand()) {
    const cmd = commands.find((c) => c.data.name === interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction);
    } catch (err) {
      logger.error({ err }, "Slash command error");
      const msg = { content: "❌ حدث خطأ.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
    return;
  }

  // select menus
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "ticket_category_select") {
      await handleCategorySelect(interaction);
    } else if (interaction.customId === "ticket_action_menu") {
      await handleTicketAction(interaction);
    }
    return;
  }

  // modals
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("modal_rename:")) {
      await handleRenameModal(interaction);
    }
    return;
  }
}

// ─── open ticket ───────────────────────────────────────────────────────────

async function handleCategorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;
  const selectedValue = interaction.values[0];
  // value format: "open_ticket:اسم القسم" or plain name (legacy)
  const selectedCategory = selectedValue.startsWith("open_ticket:")
    ? selectedValue.slice("open_ticket:".length)
    : selectedValue;

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

  const existing = await Ticket.findOne({ guildId, userId: interaction.user.id, status: "open" });
  if (existing) {
    await interaction.editReply({ content: `❌ لديك تذكرة مفتوحة: <#${existing.channelId}>` });
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
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: interaction.client.user!.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
  }) as TextChannel;

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

  // save log entry
  const ticketLog = new TicketLog({
    ticketNumber,
    guildId,
    channelId: channel.id,
    userId: interaction.user.id,
    username: interaction.user.tag,
    category: selectedCategory,
    openedAt: new Date(),
    logs: [{ action: "فتح التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date() }],
  });
  await ticketLog.save();

  // welcome message
  const welcomeText = config.welcomeMessage
    .replace("{user}", `<@${interaction.user.id}>`)
    .replace("{ticket}", `#${ticketNumber}`);

  const staffCount = guild.members.cache.filter(
    (m) => m.permissions.has(PermissionFlagsBits.ManageChannels) && !m.user.bot
  ).size;

  const infoEmbed = new EmbedBuilder()
    .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTitle(`⚡ ${guild.name}`)
    .addFields(
      { name: "👤 فُتحت بواسطة", value: `<@${interaction.user.id}>`, inline: true },
      { name: "📂 القسم", value: selectedCategory, inline: true },
      { name: "🔢 رقم التذكرة", value: `#${ticketNumber}`, inline: true },
      { name: "🕐 تاريخ الفتح", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      { name: "🟢 المشرفون المتاحون", value: `${staffCount}`, inline: true },
      { name: "🔧 المستلم", value: "لم يُستلم بعد", inline: true },
    )
    .setThumbnail(interaction.user.displayAvatarURL())
    .setColor(0x2f3136)
    .setFooter({ text: `${guild.name} TICKET` })
    .setTimestamp();

  const welcomeEmbed = new EmbedBuilder()
    .setDescription(welcomeText)
    .setColor(0x3498db);

  const actionRow = buildActionMenu(false);

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [infoEmbed, welcomeEmbed],
    components: [actionRow],
  });

  // DM opener
  try {
    await interaction.user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎫 تم فتح تذكرتك")
          .setDescription(
            `تم فتح تذكرتك في **${guild.name}**\n**القسم:** ${selectedCategory}\n**رقم التذكرة:** #${ticketNumber}\n**الرابط:** <#${channel.id}>`
          )
          .setColor(Colors.Green)
          .setTimestamp(),
      ],
    });
  } catch { /* المستخدم أغلق الرسائل الخاصة */ }

  // log channel
  await sendLog(interaction, guildId, new EmbedBuilder()
    .setTitle("📂 تذكرة جديدة")
    .addFields(
      { name: "👤 الفاتح", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
      { name: "📂 القسم", value: selectedCategory, inline: true },
      { name: "🔢 رقم التذكرة", value: `#${ticketNumber}`, inline: true },
      { name: "📌 القناة", value: `<#${channel.id}>`, inline: true },
    )
    .setColor(Colors.Green)
    .setTimestamp()
  );

  await interaction.editReply({ content: `✅ تم فتح تذكرتك: <#${channel.id}>` });
}

// ─── ticket actions (select menu) ──────────────────────────────────────────

async function handleTicketAction(interaction: StringSelectMenuInteraction): Promise<void> {
  const action = interaction.values[0];

  if (action === "ticket_action:close") {
    await doCloseTicket(interaction);
  } else if (action === "ticket_action:claim") {
    await doClaimTicket(interaction);
  } else if (action === "ticket_action:unclaim") {
    await doUnclaimTicket(interaction);
  } else if (action === "ticket_action:summon") {
    await doSummonTicket(interaction);
  } else if (action === "ticket_action:rename") {
    await doRenameTicket(interaction);
  }
}

// ─── close ─────────────────────────────────────────────────────────────────

async function doCloseTicket(interaction: StringSelectMenuInteraction): Promise<void> {
  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "❌ هذه التذكرة مغلقة بالفعل.", ephemeral: true });
    return;
  }

  const canClose = interaction.user.id === ticket.userId || isAdmin(interaction);
  if (!canClose) {
    await interaction.reply({ content: "❌ ليس لديك صلاحية إغلاق هذه التذكرة.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  ticket.status = "closed";
  ticket.closedAt = new Date();
  ticket.closedBy = interaction.user.tag;
  await ticket.save();

  const channel = interaction.channel as TextChannel;

  // fetch transcript
  const messages = await channel.messages.fetch({ limit: 100 });
  const transcriptLines = messages
    .reverse()
    .map((m) => `[${new Date(m.createdTimestamp).toLocaleString("ar-SA")}] ${m.author.tag}: ${m.content || "[مرفق]"}`)
    .filter((l) => !l.includes("[مرفق]") || true);

  // update log
  const ticketLog = await TicketLog.findOne({ channelId: channel.id });
  if (ticketLog) {
    ticketLog.closedAt = new Date();
    ticketLog.closedBy = interaction.user.tag;
    ticketLog.transcript = transcriptLines;
    ticketLog.logs.push({ action: "إغلاق التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date() });
    await ticketLog.save();
  }

  const transcriptText = transcriptLines.length > 0
    ? transcriptLines.slice(-50).join("\n")
    : "لا توجد رسائل";

  const closeEmbed = new EmbedBuilder()
    .setTitle("🔒 تم إغلاق التذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "👤 الفاتح", value: `<@${ticket.userId}>`, inline: true },
      { name: "🔒 أُغلقت بواسطة", value: interaction.user.tag, inline: true },
      { name: "📂 القسم", value: ticket.category, inline: true },
      { name: "🕐 تاريخ الإغلاق", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
    )
    .setColor(Colors.Red)
    .setTimestamp();

  await channel.send({ embeds: [closeEmbed] });

  // DM opener with transcript
  try {
    const opener = await interaction.client.users.fetch(ticket.userId);
    const transcriptBuffer = Buffer.from(transcriptLines.join("\n"), "utf-8");
    await opener.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🔒 تم إغلاق تذكرتك")
          .setDescription(
            `تم إغلاق تذكرتك **#${ticket.ticketNumber}** في **${interaction.guild?.name}**\n**بواسطة:** ${interaction.user.tag}\n**القسم:** ${ticket.category}`
          )
          .setColor(Colors.Red)
          .setTimestamp(),
      ],
      files: [{ attachment: transcriptBuffer, name: `transcript-${ticket.ticketNumber}.txt` }],
    });
  } catch { /* لا يمكن إرسال DM */ }

  // log channel
  await sendLog(interaction, ticket.guildId, new EmbedBuilder()
    .setTitle("🔒 تذكرة مغلقة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "👤 الفاتح", value: `<@${ticket.userId}> (${ticket.username})`, inline: true },
      { name: "🔒 أُغلقت بواسطة", value: `${interaction.user.tag}`, inline: true },
      { name: "📂 القسم", value: ticket.category, inline: true },
      { name: "📜 آخر الرسائل", value: `\`\`\`\n${transcriptText.slice(0, 900)}\n\`\`\`` },
    )
    .setColor(Colors.Red)
    .setTimestamp()
  );

  setTimeout(async () => {
    try { await channel.delete("إغلاق التذكرة"); } catch { /* محذوفة مسبقاً */ }
  }, 5000);
}

// ─── claim ─────────────────────────────────────────────────────────────────

async function doClaimTicket(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: "❌ هذا الإجراء مخصص للمشرفين فقط.", ephemeral: true });
    return;
  }

  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "❌ هذه القناة ليست تذكرة مفتوحة.", ephemeral: true });
    return;
  }
  if (ticket.claimedBy) {
    await interaction.reply({ content: `❌ هذه التذكرة مستلمة من قبل **${ticket.claimedByName}**.`, ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  ticket.claimedBy = interaction.user.id;
  ticket.claimedByName = interaction.user.tag;
  await ticket.save();

  // update log
  const ticketLog = await TicketLog.findOne({ channelId: interaction.channelId });
  if (ticketLog) {
    ticketLog.logs.push({ action: "استلام التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date() });
    await ticketLog.save();
  }

  const embed = new EmbedBuilder()
    .setDescription(`✅ <@${interaction.user.id}> استلم هذه التذكرة.`)
    .setColor(Colors.Green)
    .setTimestamp();

  await (interaction.channel as TextChannel).send({ embeds: [embed] });

  try {
    const opener = await interaction.client.users.fetch(ticket.userId);
    await opener.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ تم استلام تذكرتك")
          .setDescription(`قام **${interaction.user.tag}** باستلام تذكرتك **#${ticket.ticketNumber}** وسيساعدك قريباً.`)
          .setColor(Colors.Green)
          .setTimestamp(),
      ],
    });
  } catch { /* لا يمكن إرسال DM */ }

  await sendLog(interaction, ticket.guildId, new EmbedBuilder()
    .setTitle("✅ استلام تذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "🔧 المستلم", value: `${interaction.user.tag}`, inline: true },
      { name: "👤 الفاتح", value: `<@${ticket.userId}>`, inline: true },
    )
    .setColor(Colors.Green)
    .setTimestamp()
  );
}

// ─── unclaim ───────────────────────────────────────────────────────────────

async function doUnclaimTicket(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: "❌ هذا الإجراء مخصص للمشرفين فقط.", ephemeral: true });
    return;
  }

  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "❌ هذه القناة ليست تذكرة مفتوحة.", ephemeral: true });
    return;
  }
  if (!ticket.claimedBy) {
    await interaction.reply({ content: "❌ هذه التذكرة غير مستلمة من أحد.", ephemeral: true });
    return;
  }
  if (ticket.claimedBy !== interaction.user.id && !isAdmin(interaction)) {
    await interaction.reply({ content: "❌ لا يمكنك ترك تذكرة لم تستلمها.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const prevClaimer = ticket.claimedByName;
  ticket.claimedBy = undefined;
  ticket.claimedByName = undefined;
  await ticket.save();

  const ticketLog = await TicketLog.findOne({ channelId: interaction.channelId });
  if (ticketLog) {
    ticketLog.logs.push({ action: "ترك التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date(), detail: `ترك الاستلام من ${prevClaimer}` });
    await ticketLog.save();
  }

  const embed = new EmbedBuilder()
    .setDescription(`🚪 <@${interaction.user.id}> ترك هذه التذكرة — أصبحت متاحة للاستلام.`)
    .setColor(Colors.Orange)
    .setTimestamp();

  await (interaction.channel as TextChannel).send({ embeds: [embed] });

  await sendLog(interaction, ticket.guildId, new EmbedBuilder()
    .setTitle("🚪 ترك تذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "🚪 التارك", value: `${interaction.user.tag}`, inline: true },
      { name: "👤 الفاتح", value: `<@${ticket.userId}>`, inline: true },
    )
    .setColor(Colors.Orange)
    .setTimestamp()
  );
}

// ─── summon ────────────────────────────────────────────────────────────────

async function doSummonTicket(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: "❌ هذا الإجراء مخصص للمشرفين فقط.", ephemeral: true });
    return;
  }

  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "❌ هذه القناة ليست تذكرة مفتوحة.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const ticketLog = await TicketLog.findOne({ channelId: interaction.channelId });
  if (ticketLog) {
    ticketLog.logs.push({ action: "استدعاء صاحب التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date() });
    await ticketLog.save();
  }

  const pingEmbed = new EmbedBuilder()
    .setDescription(`📢 <@${ticket.userId}> تم استدعاؤك من قبل <@${interaction.user.id}> — رجاءً الرد في هذه التذكرة.`)
    .setColor(Colors.Yellow)
    .setTimestamp();

  await (interaction.channel as TextChannel).send({ content: `<@${ticket.userId}>`, embeds: [pingEmbed] });

  try {
    const opener = await interaction.client.users.fetch(ticket.userId);
    await opener.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("📢 استدعاء — تذكرتك بحاجة لردّك")
          .setDescription(
            `قام **${interaction.user.tag}** باستدعائك في تذكرة **#${ticket.ticketNumber}**\n**القسم:** ${ticket.category}\n**الرابط:** <#${interaction.channelId}>`
          )
          .setColor(Colors.Yellow)
          .setTimestamp(),
      ],
    });
  } catch { /* لا يمكن إرسال DM */ }

  await sendLog(interaction, ticket.guildId, new EmbedBuilder()
    .setTitle("📢 استدعاء صاحب التذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "📢 المستدعي", value: `${interaction.user.tag}`, inline: true },
      { name: "👤 الفاتح", value: `<@${ticket.userId}>`, inline: true },
    )
    .setColor(Colors.Yellow)
    .setTimestamp()
  );
}

// ─── rename (modal) ────────────────────────────────────────────────────────

async function doRenameTicket(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: "❌ هذا الإجراء مخصص للمشرفين فقط.", ephemeral: true });
    return;
  }

  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "❌ هذه القناة ليست تذكرة مفتوحة.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_rename:${ticket.ticketNumber}`)
    .setTitle("تغيير اسم التذكرة");

  const input = new TextInputBuilder()
    .setCustomId("new_name")
    .setLabel("الاسم الجديد للتذكرة")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("مثال: دعم-فني")
    .setMaxLength(90)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

async function handleRenameModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const ticketNumber = parseInt(interaction.customId.split(":")[1]);
  const newName = interaction.fields.getTextInputValue("new_name").replace(/\s+/g, "-").toLowerCase();
  const ticket = await Ticket.findOne({ ticketNumber, guildId: interaction.guildId!, status: "open" });

  if (!ticket) {
    await interaction.editReply({ content: "❌ التذكرة غير موجودة." });
    return;
  }

  const channel = interaction.channel as TextChannel;
  const oldName = channel.name;
  await channel.setName(`ticket-${newName}`);
  ticket.title = newName;
  await ticket.save();

  const ticketLog = await TicketLog.findOne({ channelId: channel.id });
  if (ticketLog) {
    ticketLog.logs.push({ action: "تغيير الاسم", by: interaction.user.tag, byId: interaction.user.id, at: new Date(), detail: `${oldName} ← ticket-${newName}` });
    await ticketLog.save();
  }

  const embed = new EmbedBuilder()
    .setDescription(`✏️ تم تغيير اسم التذكرة إلى **ticket-${newName}** بواسطة <@${interaction.user.id}>`)
    .setColor(Colors.Blurple)
    .setTimestamp();

  await channel.send({ embeds: [embed] });

  await sendLog(interaction, ticket.guildId, new EmbedBuilder()
    .setTitle("✏️ تغيير اسم تذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "✏️ الاسم القديم", value: oldName, inline: true },
      { name: "✅ الاسم الجديد", value: `ticket-${newName}`, inline: true },
      { name: "👤 بواسطة", value: `${interaction.user.tag}`, inline: true },
    )
    .setColor(Colors.Blurple)
    .setTimestamp()
  );

  await interaction.editReply({ content: `✅ تم تغيير الاسم إلى **ticket-${newName}**` });
}
