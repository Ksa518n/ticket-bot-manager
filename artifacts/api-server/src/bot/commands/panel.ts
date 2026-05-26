import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from "discord.js";
import { TicketConfig } from "../models/TicketConfig.js";

export const data = new SlashCommandBuilder()
  .setName("ticket-panel")
  .setDescription("إرسال بانل التذاكر في قناة محددة")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((opt) =>
    opt
      .setName("القناة")
      .setDescription("القناة التي سيُرسل فيها البانل")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("نص_البانل")
      .setDescription("النص الذي يظهر في embed البانل")
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;
  const channel = interaction.options.getChannel("القناة", true) as TextChannel;
  const customText = interaction.options.getString("نص_البانل");

  const config = await TicketConfig.findOne({ guildId });

  if (!config || config.categories.length === 0) {
    await interaction.editReply({
      content: "❌ لا توجد أقسام مضافة. استخدم `/setup-ticket` أولاً.",
    });
    return;
  }

  if (customText) {
    config.panelDescription = customText;
    await config.save();
  }

  const description = config.panelDescription ?? "اختر القسم المناسب لك من القائمة أدناه.";

  const options = config.categories.map((cat) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(cat.name)
      .setValue(`open_ticket:${cat.name}`)
      .setEmoji("🎫")
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category_select")
    .setPlaceholder("اختر قسم التذكرة...")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setTitle("🎫 التذاكر")
    .setDescription(
      `${description}\n\n${config.categories.map((c) => `🎫 **${c.name}**`).join("\n")}`
    )
    .setColor(0xe67e22)
    .setFooter({ text: interaction.guild?.name ?? "نظام التذاكر" })
    .setTimestamp();

  await channel.send({ embeds: [embed], components: [row] });

  await interaction.editReply({ content: `✅ تم إرسال بانل التذاكر في <#${channel.id}>` });
}
