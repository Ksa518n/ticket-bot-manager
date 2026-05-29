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
    opt.setName("العنوان").setDescription("عنوان الـ embed").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("الوصف").setDescription("وصف/نص الـ embed").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;
  const channel = interaction.options.getChannel("القناة", true) as TextChannel;
  const customTitle = interaction.options.getString("العنوان");
  const customDesc = interaction.options.getString("الوصف");

  const config = await TicketConfig.findOne({ guildId });

  if (!config || config.categories.length === 0) {
    await interaction.editReply({ content: "❌ لا توجد أقسام مضافة. استخدم `/setup-ticket اضافة` أولاً." });
    return;
  }

  if (customTitle) { config.panelTitle = customTitle; await config.save(); }
  if (customDesc) { config.panelDescription = customDesc; await config.save(); }

  const title = config.panelTitle ?? "🎫 التذاكر";
  const description = config.panelDescription ?? "اختر القسم المناسب لك من القائمة أدناه.";

  const options = config.categories.map((cat) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(cat.name)
      .setValue(`open_ticket:${cat.name}`);
    
    if (cat.emoji) {
      option.setEmoji(cat.emoji);
    } else {
      option.setEmoji("🎫");
    }
    
    return option;
  });

  options.push(
    new StringSelectMenuOptionBuilder()
      .setLabel("تحديث")
      .setValue("panel_refresh")
      .setDescription("إعادة تحميل القائمة")
      .setEmoji("🔄")
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category_select")
    .setPlaceholder("اختر قسم التذكرة...")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`${description}\n\n${config.categories.map((c) => `${c.emoji ? c.emoji : "🎫"} **${c.name}**`).join("\n")}`)
    .setColor(0xe67e22)
    .setFooter({ text: interaction.guild?.name ?? "نظام التذاكر", iconURL: interaction.guild?.iconURL() ?? undefined })
    .setTimestamp();

  await channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: `✅ تم إرسال البانل في <#${channel.id}>` });
}
