import {
  Interaction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  TextChannel,
  CategoryChannel,
  Colors,
  Guild,
  OverwriteResolvable,
} from "discord.js";
import { Ticket, ITicket } from "../models/Ticket.js";
import { TicketConfig, ITicketConfig } from "../models/TicketConfig.js";
import { TicketLog } from "../models/TicketLog.js";
import { getNextTicketNumber } from "../models/Counter.js";
import { generateTranscript } from "../lib/transcript.js";
import { commands } from "../commands/index.js";
import { logger } from "../../lib/logger.js";

// ─── permission helpers ────────────────────────────────────────────────────

function isStaff(
  interaction: { memberPermissions: { has: (p: bigint) => boolean } | null; member: unknown },
  config: ITicketConfig
): boolean {
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  if (perms.has(PermissionFlagsBits.Administrator)) return true;
  if (config.staffRoleId) {
    const member = interaction.member as { roles: { cache: Map<string, unknown> } } | null;
    return member?.roles.cache.has(config.staffRoleId) ?? false;
  }
  return perms.has(PermissionFlagsBits.ManageChannels);
}

function isSeniorAdmin(
  interaction: { memberPermissions: { has: (p: bigint) => boolean } | null; member: unknown },
  config: ITicketConfig
): boolean {
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  if (perms.has(PermissionFlagsBits.Administrator)) return true;
  if (config.seniorAdminRoleId) {
    const member = interaction.member as { roles: { cache: Map<string, unknown> } } | null;
    return member?.roles.cache.has(config.seniorAdminRoleId) ?? false;
  }
  return false;
}

// ─── log helper ────────────────────────────────────────────────────────────

async function sendLog(guild: Guild, config: ITicketConfig, embed: EmbedBuilder): Promise<void> {
  try {
    if (!config.logChannelId) return;
    const ch = guild.channels.cache.get(config.logChannelId) as TextChannel | undefined;
    await ch?.send({ embeds: [embed] });
  } catch { /* قناة اللوقات غير متاحة */ }
}

// ─── action menu builder ───────────────────────────────────────────────────

function buildActionMenu(staffMode: boolean): ActionRowBuilder<StringSelectMenuBuilder> {
  const opts = [
    new StringSelectMenuOptionBuilder()
      .setLabel("إغلاق التذكرة").setValue("ta:close").setEmoji("🔒"),
  ];

  if (staffMode) {
    opts.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("استلام التذكرة").setValue("ta:claim").setDescription("استلام التذكرة كمشرف").setEmoji("✅"),
      new StringSelectMenuOptionBuilder()
        .setLabel("ترك التذكرة").setValue("ta:unclaim").setDescription("ترك الاستلام لمشرف آخر").setEmoji("🚪"),
      new StringSelectMenuOptionBuilder()
        .setLabel("استدعاء صاحب التذكرة").setValue("ta:summon").setDescription("إرسال DM لصاحب التذكرة").setEmoji("📢"),
      new StringSelectMenuOptionBuilder()
        .setLabel("تغيير اسم التذكرة").setValue("ta:rename").setDescription("تغيير اسم القناة").setEmoji("✏️"),
      new StringSelectMenuOptionBuilder()
        .setLabel("ملاحظة داخلية").setValue("ta:note").setDescription("إضافة ملاحظة في اللوقات").setEmoji("📝"),
    );
  }

  opts.push(
    new StringSelectMenuOptionBuilder()
      .setLabel("تحديث القائمة").setValue("ta:refresh").setDescription("إعادة تحميل القائمة").setEmoji("🔄"),
  );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ticket_action_menu")
      .setPlaceholder("اختر إجراء...")
      .addOptions(opts)
  );
}

// ─── main handler ──────────────────────────────────────────────────────────

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const cmd = commands.find((c) => c.data.name === interaction.commandName);
    if (!cmd) return;
    try { await cmd.execute(interaction); }
    catch (err) {
      logger.error({ err }, "Slash command error");
      const msg = { content: "❌ حدث خطأ.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const cmd = commands.find((c) => c.data.name === interaction.commandName);
    if (!cmd || !("autocomplete" in cmd)) return;
    try {
      // @ts-ignore - we check for autocomplete existence above
      await cmd.autocomplete(interaction);
    } catch (err) {
      logger.error({ err }, "Autocomplete error");
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "ticket_category_select") {
      await handleCategorySelect(interaction); return;
    }
    if (interaction.customId === "ticket_action_menu") {
      await handleTicketAction(interaction); return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("ticket_reopen:")) {
      await handleReopen(interaction); return;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("modal_rename:")) {
      await handleRenameModal(interaction); return;
    }
    if (interaction.customId.startsWith("modal_note:")) {
      await handleNoteModal(interaction); return;
    }
    if (interaction.customId.startsWith("modal_close:")) {
      await handleCloseModal(interaction); return;
    }
  }
}

// ─── open ticket ───────────────────────────────────────────────────────────

async function handleCategorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const val = interaction.values[0];

  // refresh
  if (val === "panel_refresh") {
    await interaction.update({
      components: interaction.message.components,
    });
    return;
  }

  const selectedCategory = val.startsWith("open_ticket:") ? val.slice("open_ticket:".length) : val;
  const guildId = interaction.guildId!;
  const config = await TicketConfig.findOne({ guildId });

  if (!config) {
    await interaction.reply({ content: "❌ لا يوجد إعداد للتذاكر.", ephemeral: true }); return;
  }

  // blacklist check
  if (config.blacklistedUsers.includes(interaction.user.id)) {
    await interaction.reply({ content: "🚫 أنت محظور من فتح التذاكر في هذا السيرفر.", ephemeral: true }); return;
  }

  const catConfig = config.categories.find((c) => c.name === selectedCategory);
  if (!catConfig) {
    await interaction.reply({ content: "❌ القسم غير موجود.", ephemeral: true }); return;
  }

  const existing = await Ticket.findOne({ guildId, userId: interaction.user.id, status: "open" });
  if (existing) {
    await interaction.reply({ content: `❌ لديك تذكرة مفتوحة بالفعل: <#${existing.channelId}>`, ephemeral: true }); return;
  }

  await interaction.deferReply({ ephemeral: true });

  const ticketNumber = await getNextTicketNumber(guildId);
  const guild = interaction.guild!;
  const parentCat = guild.channels.cache.get(catConfig.categoryId) as CategoryChannel | undefined;

  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
    },
    {
      id: interaction.client.user!.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
    },
  ];
  if (config.staffRoleId) {
    overwrites.push({ id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  if (config.seniorAdminRoleId) {
    overwrites.push({ id: config.seniorAdminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const channel = await guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: parentCat ?? null,
    permissionOverwrites: overwrites,
  }) as TextChannel;

  const ticket = new Ticket({
    ticketNumber, channelId: channel.id, guildId,
    userId: interaction.user.id, username: interaction.user.tag,
    category: selectedCategory, categoryId: catConfig.categoryId,
    status: "open", title: `تذكرة #${ticketNumber}`,
  });
  await ticket.save();

  const ticketLog = new TicketLog({
    ticketNumber, guildId, channelId: channel.id,
    userId: interaction.user.id, username: interaction.user.tag,
    category: selectedCategory, openedAt: new Date(),
    logs: [{ action: "فتح التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date() }],
  });
  await ticketLog.save();

  const staffCount = config.staffRoleId
    ? guild.members.cache.filter((m) => m.roles.cache.has(config.staffRoleId!)).size
    : guild.members.cache.filter((m) => m.permissions.has(PermissionFlagsBits.ManageChannels) && !m.user.bot).size;

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

  const welcomeText = config.welcomeMessage
    .replace("{user}", `<@${interaction.user.id}>`)
    .replace("{ticket}", `#${ticketNumber}`);

  const welcomeEmbed = new EmbedBuilder().setDescription(welcomeText).setColor(0x3498db);
  const actionRow = buildActionMenu(true);

  const mentionParts: string[] = [`<@${interaction.user.id}>`];
  if (config.staffRoleId) mentionParts.push(`<@&${config.staffRoleId}>`);

  await channel.send({
    content: mentionParts.join(" "),
    embeds: [infoEmbed, welcomeEmbed],
    components: [actionRow],
  });

  // DM opener
  try {
    await interaction.user.send({
      embeds: [new EmbedBuilder()
        .setTitle("🎫 تم فتح تذكرتك")
        .setDescription(`تم فتح تذكرتك في **${guild.name}**\n**القسم:** ${selectedCategory}\n**رقم التذكرة:** #${ticketNumber}\n**الرابط:** <#${channel.id}>`)
        .setColor(Colors.Green).setTimestamp()],
    });
  } catch { /* DMs مغلقة */ }

  await sendLog(guild, config, new EmbedBuilder()
    .setTitle("📂 تذكرة جديدة فُتحت")
    .addFields(
      { name: "👤 الفاتح", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
      { name: "📂 القسم", value: selectedCategory, inline: true },
      { name: "🔢 رقم التذكرة", value: `#${ticketNumber}`, inline: true },
      { name: "📌 القناة", value: `<#${channel.id}>`, inline: true },
    )
    .setColor(Colors.Green).setTimestamp()
  );

  await interaction.editReply({ content: `✅ تم فتح تذكرتك: <#${channel.id}>` });
}

// ─── ticket action menu router ─────────────────────────────────────────────

async function handleTicketAction(interaction: StringSelectMenuInteraction): Promise<void> {
  const action = interaction.values[0];
  const guildId = interaction.guildId!;
  const config = await TicketConfig.findOne({ guildId });
  if (!config) { await interaction.reply({ content: "❌ خطأ في الإعداد.", ephemeral: true }); return; }

  if (action === "ta:refresh") {
    const staff = isStaff(interaction, config);
    await interaction.update({ components: [buildActionMenu(staff)] });
    return;
  }

  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });

  if (action === "ta:close") { await doClose(interaction, ticket, config); return; }

  if (!isStaff(interaction, config)) {
    await interaction.reply({ content: "❌ هذا الإجراء مخصص للمشرفين فقط.", ephemeral: true }); return;
  }

  if (!ticket) { await interaction.reply({ content: "❌ هذه القناة ليست تذكرة مفتوحة.", ephemeral: true }); return; }

  switch (action) {
    case "ta:claim":   await doClaim(interaction, ticket, config); break;
    case "ta:unclaim": await doUnclaim(interaction, ticket, config); break;
    case "ta:summon":  await doSummon(interaction, ticket, config); break;
    case "ta:rename":  await doRename(interaction, ticket); break;
    case "ta:note":    await doNote(interaction, ticket); break;
  }
}

// ─── close ─────────────────────────────────────────────────────────────────

async function doClose(
  interaction: StringSelectMenuInteraction,
  ticket: ITicket | null,
  config: ITicketConfig
): Promise<void> {
  if (!ticket) { await interaction.reply({ content: "❌ هذه القناة ليست تذكرة مفتوحة.", ephemeral: true }); return; }

  const canClose = interaction.user.id === ticket.userId || isStaff(interaction, config);
  if (!canClose) { await interaction.reply({ content: "❌ ليس لديك صلاحية الإغلاق.", ephemeral: true }); return; }

  // staff must provide a reason via modal
  if (isStaff(interaction, config)) {
    const modal = new ModalBuilder()
      .setCustomId(`modal_close:${ticket.ticketNumber}`)
      .setTitle("إغلاق التذكرة");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("close_reason")
          .setLabel("سبب الإغلاق (إلزامي)")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("اكتب سبب إغلاق التذكرة هنا...")
          .setMinLength(3)
          .setMaxLength(500)
          .setRequired(true)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  // opener closes without reason
  await interaction.deferUpdate();
  await executeClose(
    interaction.channel as TextChannel,
    interaction.guild!,
    ticket,
    config,
    interaction.user.tag,
    interaction.user.id,
    interaction.client.user!.id,
    "أغلقها صاحب التذكرة"
  );
}

// modal submit for staff close
async function handleCloseModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const ticketNumber = parseInt(interaction.customId.split(":")[1]);
  const reason = interaction.fields.getTextInputValue("close_reason");
  const guildId = interaction.guildId!;

  const ticket = await Ticket.findOne({ ticketNumber, guildId, status: "open" });
  if (!ticket) { await interaction.editReply({ content: "❌ التذكرة غير موجودة أو مغلقة بالفعل." }); return; }

  const config = await TicketConfig.findOne({ guildId });
  if (!config) { await interaction.editReply({ content: "❌ خطأ في الإعداد." }); return; }

  await executeClose(
    interaction.channel as TextChannel,
    interaction.guild!,
    ticket,
    config,
    interaction.user.tag,
    interaction.user.id,
    interaction.client.user!.id,
    reason
  );

  await interaction.editReply({ content: "✅ تم إغلاق التذكرة." });
}

// shared close logic
async function executeClose(
  channel: TextChannel,
  guild: Guild,
  ticket: ITicket,
  config: ITicketConfig,
  closerTag: string,
  closerId: string,
  botId: string,
  reason: string
): Promise<void> {
  ticket.status = "closed";
  ticket.closedAt = new Date();
  ticket.closedBy = closerTag;
  await ticket.save();

  const messages = await channel.messages.fetch({ limit: 100 });
  const html = generateTranscript(messages, ticket.ticketNumber, ticket.category, ticket.username, guild.name);

  const ticketLog = await TicketLog.findOne({ channelId: channel.id });
  if (ticketLog) {
    ticketLog.closedAt = new Date();
    ticketLog.closedBy = closerTag;
    ticketLog.transcript = messages.map((m) => `[${new Date(m.createdTimestamp).toLocaleString("ar-SA")}] ${m.author.tag}: ${m.content || "[embed/مرفق]"}`);
    ticketLog.logs.push({ action: "إغلاق التذكرة", by: closerTag, byId: closerId, at: new Date(), detail: reason });
    await ticketLog.save();
  }

  await channel.setName(`closed-${ticket.ticketNumber}`);

  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: closerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
    { id: ticket.userId, deny: [PermissionFlagsBits.ViewChannel] },
  ];
  if (config.staffRoleId) overwrites.push({ id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  if (config.seniorAdminRoleId) overwrites.push({ id: config.seniorAdminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  await channel.permissionOverwrites.set(overwrites);

  // send close embed in channel
  const closeEmbed = new EmbedBuilder()
    .setTitle("تم حذف التذكرة")
    .addFields(
      { name: "🗑️ حذف بواسطة", value: `${closerTag} - <@${closerId}>`, inline: false },
      { name: "👤 صاحب التذكرة", value: `<@${ticket.userId}>`, inline: false },
      { name: "🔧 مستلم التذكرة", value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "<لا يوجد>", inline: false },
      { name: "📋 سبب الإغلاق", value: reason, inline: false },
      { name: "🕐 وقت فتحها", value: `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:F>`, inline: false },
      { name: "🗑️ وقت حذفها", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      { name: "🏠 اسم التذكرة", value: `ticket-${ticket.ticketNumber}`, inline: false },
      { name: "🏠 رقم التذكرة", value: `${ticket.ticketNumber}`, inline: false },
      { name: "🗂️ نوع التذكرة", value: ticket.category, inline: false },
    )
    .setColor(0xe91e63)
    .setFooter({ text: `${guild.name}'s Tickets`, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp();

  const reopenRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_reopen:${ticket.ticketNumber}`)
      .setLabel("🔓 إعادة فتح التذكرة")
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [closeEmbed], components: [reopenRow] });

  // DM opener
  try {
    const client = channel.client;
    const opener = await client.users.fetch(ticket.userId);
    const dmEmbed = new EmbedBuilder()
      .setTitle("تم حذف التذكرة")
      .addFields(
        { name: "🗑️ حذف بواسطة", value: `${closerTag} - <@${closerId}>`, inline: false },
        { name: "👤 صاحب التذكرة", value: `<@${ticket.userId}>`, inline: false },
        { name: "🔧 مستلم التذكرة", value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "<لا يوجد>", inline: false },
        { name: "📋 سبب الإغلاق", value: reason, inline: false },
        { name: "🕐 وقت فتحها", value: `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:F>`, inline: false },
        { name: "🗑️ وقت حذفها", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
        { name: "🏠 اسم التذكرة", value: `ticket-${ticket.ticketNumber}`, inline: false },
        { name: "🏠 رقم التذكرة", value: `${ticket.ticketNumber}`, inline: false },
        { name: "🗂️ نوع التذكرة", value: ticket.category, inline: false },
      )
      .setThumbnail(opener.displayAvatarURL())
      .setColor(0xe91e63)
      .setFooter({ text: `${guild.name}'s Tickets`, iconURL: guild.iconURL() ?? undefined })
      .setTimestamp();
    await opener.send({
      embeds: [dmEmbed],
      files: [{ attachment: html, name: `ticket-${ticket.ticketNumber}.html` }],
    });
  } catch { /* DMs مغلقة */ }

  // log channel embed
  await sendLog(guild, config, new EmbedBuilder()
    .setTitle("تم حذف التذكرة")
    .addFields(
      { name: "🗑️ حذف بواسطة", value: `${closerTag} - <@${closerId}>`, inline: false },
      { name: "👤 صاحب التذكرة", value: `<@${ticket.userId}> (${ticket.username})`, inline: false },
      { name: "🔧 مستلم التذكرة", value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "<لا يوجد>", inline: false },
      { name: "📋 سبب الإغلاق", value: reason, inline: false },
      { name: "🕐 وقت فتحها", value: `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:F>`, inline: false },
      { name: "🗑️ وقت حذفها", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      { name: "🏠 اسم التذكرة", value: `ticket-${ticket.ticketNumber}`, inline: false },
      { name: "🏠 رقم التذكرة", value: `${ticket.ticketNumber}`, inline: false },
      { name: "🗂️ نوع التذكرة", value: ticket.category, inline: false },
    )
    .setColor(0xe91e63)
    .setFooter({ text: `${guild.name}'s Tickets`, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp()
  );

  // HTML to log channel
  try {
    const logCh = config.logChannelId ? guild.channels.cache.get(config.logChannelId) as TextChannel | undefined : undefined;
    await logCh?.send({ files: [{ attachment: html, name: `ticket-${ticket.ticketNumber}.html` }] });
  } catch { /* log channel */ }
}

// ─── claim ─────────────────────────────────────────────────────────────────

async function doClaim(
  interaction: StringSelectMenuInteraction,
  ticket: ITicket,
  config: ITicketConfig
): Promise<void> {
  if (ticket.claimedBy) {
    await interaction.reply({ content: `❌ التذكرة مستلمة من قبل **${ticket.claimedByName}**.`, ephemeral: true }); return;
  }

  ticket.claimedBy = interaction.user.id;
  ticket.claimedByName = interaction.user.tag;
  await ticket.save();

  // update the info embed's "المستلم" field (index 5) to show claimer
  const originalEmbeds = interaction.message.embeds;
  const updatedInfoEmbed = EmbedBuilder.from(originalEmbeds[0])
    .spliceFields(5, 1, { name: "🔧 المستلم", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true });
  const newEmbeds = [updatedInfoEmbed, ...(originalEmbeds[1] ? [EmbedBuilder.from(originalEmbeds[1])] : [])];

  await interaction.update({ embeds: newEmbeds, components: [buildActionMenu(true)] });

  const ticketLog = await TicketLog.findOne({ channelId: interaction.channelId });
  if (ticketLog) {
    ticketLog.logs.push({ action: "استلام التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date() });
    await ticketLog.save();
  }

  await (interaction.channel as TextChannel).send({
    embeds: [new EmbedBuilder()
      .setDescription(`✅ <@${interaction.user.id}> استلم هذه التذكرة.`)
      .setColor(Colors.Green).setTimestamp()],
  });

  try {
    const opener = await interaction.client.users.fetch(ticket.userId);
    await opener.send({
      embeds: [new EmbedBuilder()
        .setTitle("✅ تم استلام تذكرتك")
        .setDescription(`قام **${interaction.user.tag}** باستلام تذكرتك **#${ticket.ticketNumber}** وسيساعدك قريباً.`)
        .setColor(Colors.Green).setTimestamp()],
    });
  } catch { /* DMs مغلقة */ }

  await sendLog(interaction.guild!, config, new EmbedBuilder()
    .setTitle("✅ استلام تذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "🔧 المستلم", value: `${interaction.user.tag}`, inline: true },
      { name: "👤 الفاتح", value: `<@${ticket.userId}>`, inline: true },
    )
    .setColor(Colors.Green).setTimestamp()
  );
}

// ─── unclaim ───────────────────────────────────────────────────────────────

async function doUnclaim(
  interaction: StringSelectMenuInteraction,
  ticket: ITicket,
  config: ITicketConfig
): Promise<void> {
  if (!ticket.claimedBy) {
    await interaction.reply({ content: "❌ هذه التذكرة غير مستلمة.", ephemeral: true }); return;
  }

  await interaction.update({ components: [buildActionMenu(true)] });

  const prev = ticket.claimedByName;
  ticket.claimedBy = undefined;
  ticket.claimedByName = undefined;
  await ticket.save();

  const ticketLog = await TicketLog.findOne({ channelId: interaction.channelId });
  if (ticketLog) {
    ticketLog.logs.push({ action: "ترك التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date(), detail: `ترك الاستلام، كان مستلماً من ${prev}` });
    await ticketLog.save();
  }

  await (interaction.channel as TextChannel).send({
    embeds: [new EmbedBuilder()
      .setDescription(`🚪 <@${interaction.user.id}> ترك هذه التذكرة — أصبحت متاحة للاستلام.`)
      .setColor(Colors.Orange).setTimestamp()],
  });

  await sendLog(interaction.guild!, config, new EmbedBuilder()
    .setTitle("🚪 ترك تذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "🚪 التارك", value: `${interaction.user.tag}`, inline: true },
    )
    .setColor(Colors.Orange).setTimestamp()
  );
}

// ─── summon ────────────────────────────────────────────────────────────────

async function doSummon(
  interaction: StringSelectMenuInteraction,
  ticket: ITicket,
  config: ITicketConfig
): Promise<void> {
  await interaction.update({ components: [buildActionMenu(true)] });

  const ticketLog = await TicketLog.findOne({ channelId: interaction.channelId });
  if (ticketLog) {
    ticketLog.logs.push({ action: "استدعاء صاحب التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date() });
    await ticketLog.save();
  }

  await (interaction.channel as TextChannel).send({
    content: `<@${ticket.userId}>`,
    embeds: [new EmbedBuilder()
      .setDescription(`📢 <@${ticket.userId}> تم استدعاؤك من قبل <@${interaction.user.id}> — رجاءً الرد هنا.`)
      .setColor(Colors.Yellow).setTimestamp()],
  });

  try {
    const opener = await interaction.client.users.fetch(ticket.userId);
    const summonEmbed = new EmbedBuilder()
      .setTitle("تم استدعاءك للتذكرة")
      .addFields(
        { name: "🖥️ السيرفر", value: interaction.guild!.name, inline: false },
        { name: "🎫 التذكرة", value: `ticket-${ticket.ticketNumber}\naضغط على الزر بالأسفل لنقلك للتذكرة`, inline: false },
      )
      .setThumbnail(interaction.guild!.iconURL() ?? null)
      .setColor(0xe91e63)
      .setFooter({ text: `${interaction.guild!.name}'s Tickets`, iconURL: interaction.guild!.iconURL() ?? undefined })
      .setTimestamp();

    const linkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("اضغط للدخول")
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${interaction.guildId}/${interaction.channelId}`)
        .setEmoji("🔗")
    );

    await opener.send({ embeds: [summonEmbed], components: [linkRow] });
  } catch { /* DMs مغلقة */ }

  await sendLog(interaction.guild!, config, new EmbedBuilder()
    .setTitle("📢 استدعاء صاحب التذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
      { name: "📢 المستدعي", value: `${interaction.user.tag}`, inline: true },
      { name: "👤 الفاتح", value: `<@${ticket.userId}>`, inline: true },
    )
    .setColor(Colors.Yellow).setTimestamp()
  );
}

// ─── rename (modal) ────────────────────────────────────────────────────────

async function doRename(interaction: StringSelectMenuInteraction, ticket: ITicket): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`modal_rename:${ticket.ticketNumber}`)
    .setTitle("تغيير اسم التذكرة");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("new_name")
        .setLabel("الاسم الجديد")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("مثال: دعم-تقني")
        .setMaxLength(80)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleRenameModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const ticketNumber = parseInt(interaction.customId.split(":")[1]);
  const newName = interaction.fields.getTextInputValue("new_name").replace(/\s+/g, "-").toLowerCase();
  const ticket = await Ticket.findOne({ ticketNumber, guildId: interaction.guildId!, status: "open" });

  if (!ticket) { await interaction.editReply({ content: "❌ التذكرة غير موجودة." }); return; }

  const channel = interaction.channel as TextChannel;
  const oldName = channel.name;
  await channel.setName(`ticket-${newName}`);
  ticket.title = newName;
  await ticket.save();

  const ticketLog = await TicketLog.findOne({ channelId: channel.id });
  if (ticketLog) {
    ticketLog.logs.push({ action: "تغيير الاسم", by: interaction.user.tag, byId: interaction.user.id, at: new Date(), detail: `${oldName} → ticket-${newName}` });
    await ticketLog.save();
  }

  await channel.send({
    embeds: [new EmbedBuilder()
      .setDescription(`✏️ تم تغيير اسم التذكرة إلى **ticket-${newName}** بواسطة <@${interaction.user.id}>`)
      .setColor(Colors.Blurple).setTimestamp()],
  });

  const config = await TicketConfig.findOne({ guildId: interaction.guildId! });
  if (config) {
    await sendLog(interaction.guild!, config, new EmbedBuilder()
      .setTitle("✏️ تغيير اسم تذكرة")
      .addFields(
        { name: "🔢 رقم التذكرة", value: `#${ticket.ticketNumber}`, inline: true },
        { name: "الاسم القديم", value: oldName, inline: true },
        { name: "الاسم الجديد", value: `ticket-${newName}`, inline: true },
        { name: "👤 بواسطة", value: interaction.user.tag, inline: true },
      )
      .setColor(Colors.Blurple).setTimestamp()
    );
  }

  await interaction.editReply({ content: `✅ تم تغيير الاسم إلى **ticket-${newName}**` });
}

// ─── note (modal) ──────────────────────────────────────────────────────────

async function doNote(interaction: StringSelectMenuInteraction, ticket: ITicket): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`modal_note:${ticket.ticketNumber}`)
    .setTitle("إضافة ملاحظة داخلية");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("note_content")
        .setLabel("الملاحظة (تُرسل للوقات فقط)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("اكتب ملاحظتك هنا...")
        .setMaxLength(1000)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleNoteModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const ticketNumber = parseInt(interaction.customId.split(":")[1]);
  const note = interaction.fields.getTextInputValue("note_content");
  const ticket = await Ticket.findOne({ ticketNumber, guildId: interaction.guildId! });

  if (!ticket) { await interaction.editReply({ content: "❌ التذكرة غير موجودة." }); return; }

  const ticketLog = await TicketLog.findOne({ channelId: ticket.channelId });
  if (ticketLog) {
    ticketLog.logs.push({ action: "ملاحظة داخلية", by: interaction.user.tag, byId: interaction.user.id, at: new Date(), detail: note });
    await ticketLog.save();
  }

  const config = await TicketConfig.findOne({ guildId: interaction.guildId! });
  if (config) {
    await sendLog(interaction.guild!, config, new EmbedBuilder()
      .setTitle("📝 ملاحظة داخلية")
      .addFields(
        { name: "🔢 رقم التذكرة", value: `#${ticketNumber}`, inline: true },
        { name: "👤 بواسطة", value: interaction.user.tag, inline: true },
        { name: "📝 الملاحظة", value: note },
      )
      .setColor(0x9b59b6).setTimestamp()
    );
  }

  await interaction.editReply({ content: "✅ تم إرسال الملاحظة إلى اللوقات." });
}

// ─── reopen (button) ───────────────────────────────────────────────────────

async function handleReopen(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const config = await TicketConfig.findOne({ guildId });

  if (!config || !isSeniorAdmin(interaction, config)) {
    await interaction.reply({ content: "❌ إعادة الفتح مخصصة للإدارة العليا فقط.", ephemeral: true }); return;
  }

  const ticketNumber = parseInt(interaction.customId.split(":")[1]);
  const ticket = await Ticket.findOne({ ticketNumber, guildId, status: "closed" });

  if (!ticket) { await interaction.reply({ content: "❌ التذكرة غير موجودة أو مفتوحة بالفعل.", ephemeral: true }); return; }

  await interaction.deferUpdate();

  ticket.status = "open";
  ticket.reopenedAt = new Date();
  ticket.reopenedBy = interaction.user.tag;
  ticket.claimedBy = undefined;
  ticket.claimedByName = undefined;
  await ticket.save();

  const channel = interaction.channel as TextChannel;
  const guild = interaction.guild!;

  // restore channel name
  await channel.setName(`ticket-${ticketNumber}`);

  // restore opener's access
  await channel.permissionOverwrites.edit(ticket.userId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
  });

  const ticketLog = await TicketLog.findOne({ channelId: channel.id });
  if (ticketLog) {
    ticketLog.logs.push({ action: "إعادة فتح التذكرة", by: interaction.user.tag, byId: interaction.user.id, at: new Date() });
    await ticketLog.save();
  }

  const actionRow = buildActionMenu(true);

  await channel.send({
    content: `<@${ticket.userId}>`,
    embeds: [new EmbedBuilder()
      .setTitle("🔓 تم إعادة فتح التذكرة")
      .setDescription(`قام <@${interaction.user.id}> بإعادة فتح التذكرة **#${ticketNumber}**.`)
      .addFields(
        { name: "👤 الفاتح الأصلي", value: `<@${ticket.userId}>`, inline: true },
        { name: "🔓 أُعيد فتحها بواسطة", value: interaction.user.tag, inline: true },
      )
      .setColor(Colors.Green).setTimestamp()],
    components: [actionRow],
  });

  // DM opener
  try {
    const opener = await interaction.client.users.fetch(ticket.userId);
    const reopenDmEmbed = new EmbedBuilder()
      .setTitle("تم إعادة فتح تذكرتك")
      .addFields(
        { name: "🖥️ السيرفر", value: guild.name, inline: false },
        { name: "🎫 التذكرة", value: `ticket-${ticketNumber}\nاضغط على الزر بالأسفل لنقلك للتذكرة`, inline: false },
        { name: "🔓 أُعيد فتحها بواسطة", value: interaction.user.tag, inline: false },
      )
      .setThumbnail(guild.iconURL() ?? null)
      .setColor(0xe91e63)
      .setFooter({ text: `${guild.name}'s Tickets`, iconURL: guild.iconURL() ?? undefined })
      .setTimestamp();

    const linkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("اضغط للدخول")
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guild.id}/${channel.id}`)
        .setEmoji("🔗")
    );

    await opener.send({ embeds: [reopenDmEmbed], components: [linkRow] });
  } catch { /* DMs مغلقة */ }

  await sendLog(guild, config, new EmbedBuilder()
    .setTitle("🔓 إعادة فتح تذكرة")
    .addFields(
      { name: "🔢 رقم التذكرة", value: `#${ticketNumber}`, inline: true },
      { name: "🔓 أُعيد فتحها بواسطة", value: `${interaction.user.tag}`, inline: true },
      { name: "👤 الفاتح الأصلي", value: `<@${ticket.userId}>`, inline: true },
    )
    .setColor(Colors.Green).setTimestamp()
  );
}
