import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  AutocompleteInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { TicketConfig } from "../models/TicketConfig.js";

export const data = new SlashCommandBuilder()
  .setName("setup-ticket")
  .setDescription("إضافة أو حذف قسم تذاكر (حد أقصى 5 أقسام)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("اضافة")
      .setDescription("إضافة قسم تذاكر جديد")
      .addStringOption((opt) =>
        opt.setName("اسم_القسم").setDescription("اسم قسم التذكرة").setRequired(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName("الكاتجوري")
          .setDescription("الكاتجوري التي ستُفتح فيها تذاكر هذا القسم")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("إيموجي").setDescription("ضع الإيموجي هنا مباشرة (مثال: 🎫)").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("حذف")
      .setDescription("حذف قسم تذاكر موجود")
  )
  .addSubcommand((sub) =>
    sub.setName("عرض").setDescription("عرض الأقسام الحالية")
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const focusedValue = interaction.options.getFocused();
  const config = await TicketConfig.findOne({ guildId });

  if (!config || config.categories.length === 0) {
    await interaction.respond([]);
    return;
  }

  const filtered = config.categories.filter((cat) =>
    cat.name.toLowerCase().includes(focusedValue.toLowerCase())
  );

  await interaction.respond(
    filtered.map((cat) => ({ name: cat.name, value: cat.name }))
  );
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;
  const sub = interaction.options.getSubcommand();

  let config = await TicketConfig.findOne({ guildId });
  if (!config) {
    config = new TicketConfig({ guildId, categories: [] });
  }

  if (sub === "اضافة") {
    const name = interaction.options.getString("اسم_القسم", true);
    const category = interaction.options.getChannel("الكاتجوري", true);
    const emojiInput = interaction.options.getString("إيموجي");

    if (config.categories.length >= 5) {
      await interaction.editReply({ content: "❌ وصلت للحد الأقصى (5 أقسام). احذف قسماً أولاً." });
      return;
    }
    if (config.categories.find((c) => c.name === name)) {
      await interaction.editReply({ content: `❌ القسم **${name}** موجود مسبقاً.` });
      return;
    }

    // تنظيف الإيموجي: إذا كان إيموجي مخصص بتنسيق <:name:id> أو <a:name:id>، نستخرج فقط ما نحتاجه أو نتركه كما هو
    // ديسكورد يتعامل مع الإيموجي العادي كـ string. 
    const emoji = emojiInput?.trim() || undefined;

    config.categories.push({ name, categoryId: category.id, emoji });
    await config.save();
    await interaction.editReply({
      content: `✅ تم إضافة قسم **${name}** ${emoji ? emoji : ""} — الأقسام: **${config.categories.length}/5**\nاستخدم \`/ticket-panel\` لإرسال بانل التذاكر.`,
    });
    return;
  }

  if (sub === "حذف") {
    if (config.categories.length === 0) {
      await interaction.editReply({ content: "❌ لا توجد أقسام لحذفها." });
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("delete_ticket_category")
      .setPlaceholder("اختر القسم الذي تريد حذفه...")
      .addOptions(
        config.categories.map((cat) => {
          const option = new StringSelectMenuOptionBuilder()
            .setLabel(cat.name)
            .setValue(cat.name);
          if (cat.emoji) option.setEmoji(cat.emoji);
          return option;
        })
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.editReply({
      content: "🗑️ يرجى اختيار القسم المراد حذفه من القائمة أدناه:",
      components: [row],
    });
    return;
  }

  if (sub === "عرض") {
    if (config.categories.length === 0) {
      await interaction.editReply({ content: "📂 لا توجد أقسام مضافة بعد." });
      return;
    }
    await interaction.editReply({
      content: `**📂 الأقسام الحالية (${config.categories.length}/5):**\n${config.categories.map((c, i) => `${i + 1}. ${c.emoji ? c.emoji : "🎫"} **${c.name}** — <#${c.categoryId}>`).join("\n")}`,
    });
    return;
  }
}
