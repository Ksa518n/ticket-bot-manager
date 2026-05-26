import { Client, REST, Routes } from "discord.js";
import { commands } from "../commands/index.js";
import { logger } from "../../lib/logger.js";

export async function handleReady(client: Client) {
  logger.info(`✅ البوت جاهز: ${client.user?.tag}`);

  const token = process.env["DISCORD_TOKEN"]!;
  const clientId = process.env["DISCORD_CLIENT_ID"]!;
  const guildId = process.env["GUILD_ID"] ?? "1217664651895111770";

  const rest = new REST().setToken(token);
  const commandData = commands.map((c) => c.data.toJSON());

  try {
    logger.info("🔄 جارٍ تسجيل Slash Commands...");
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commandData,
    });
    logger.info("✅ تم تسجيل Slash Commands بنجاح!");
  } catch (err) {
    logger.error({ err }, "❌ خطأ في تسجيل الأوامر");
  }
}
