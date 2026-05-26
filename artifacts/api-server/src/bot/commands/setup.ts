import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
} from "discord.js";
import { TicketConfig } from "../models/TicketConfig.js";

export const data = new SlashCommandBuilder()
  .setName("setup-ticket")
  .setDescription("إعداد قسم تذاكر جديد (حد أقصى 5 أقسام)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("اسم_القسم")
      .setDescription("اسم قسم التذكرة (مثال: الدعم الفني)")
      .setRequired(true)
  )
  .addChannelOption((option) =>
    option
      .setName("الكاتجوري")
      .setDescription("الكاتجوري (Category) التي ستفتح فيها تذاكر هذا القسم")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(true)
  )
  .addChannelOption((option) =>
    option
      .setName("قناة_الإرسال")
      .setDescription("القناة التي سيُرسل فيها زر فتح التذاكر")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;
  const sectionName = interaction.options.getString("اسم_القسم", true);
  const category = interaction.options.getChannel("الكاتجوري", true);
  const sendChannel = interaction.options.getChannel("قناة_الإرسال") as TextChannel | null;

  let config = await TicketConfig.findOne({ guildId });
  if (!config) {
    config = new TicketConfig({ guildId, categories: [] });
  }

  if (config.categories.length >= 5) {
    await interaction.editReply({
      content: "❌ وصلت للحد الأقصى من الأقسام (5 أقسام). احذف قسماً قبل إضافة جديد.",
    });
    return;
  }

  const exists = config.categories.find((c) => c.name === sectionName);
  if (exists) {
    await interaction.editReply({
      content: `❌ القسم **${sectionName}** موجود مسبقاً.`,
    });
    return;
  }

  config.categories.push({ name: sectionName, categoryId: category.id });
  await config.save();

  const targetChannel = sendChannel ?? (interaction.channel as TextChannel);

  const options = config.categories.map((cat) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(cat.name)
      .setValue(cat.name)
      .setEmoji("🎫")
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category_select")
    .setPlaceholder("اختر قسم التذكرة...")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const openButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_open_panel")
      .setLabel("اضغط هنا لعرض أقسام التذاكر")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("➤")
  );

  const embed = new EmbedBuilder()
    .setTitle("🎫 التذاكر")
    .setDescription(
      `**اختر القسم المناسب لك:**\n\n${config.categories.map((c) => `🎫 ${c.name}`).join("\n")}`
    )
    .setColor(0xe67e22)
    .setFooter({ text: "نظام التذاكر" })
    .setTimestamp();

  await targetChannel.send({
    embeds: [embed],
    components: [row, openButtonRow],
  });

  await interaction.editReply({
    content: `✅ تم إضافة قسم **${sectionName}** بنجاح! الأقسام الحالية: **${config.categories.length}/5**`,
  });
}
