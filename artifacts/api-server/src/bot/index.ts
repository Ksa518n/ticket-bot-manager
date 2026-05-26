import { Client, GatewayIntentBits, Partials } from "discord.js";
import mongoose from "mongoose";
import { handleReady } from "./events/ready.js";
import { handleInteraction } from "./events/interactionCreate.js";
import { logger } from "../lib/logger.js";

export async function startBot() {
  const token = process.env["DISCORD_TOKEN"];
  const mongoUri = process.env["MONGODB_URI"];

  if (!token) {
    logger.error("DISCORD_TOKEN غير موجود");
    return;
  }
  if (!mongoUri) {
    logger.error("MONGODB_URI غير موجود");
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    logger.info("✅ تم الاتصال بـ MongoDB");
  } catch (err) {
    logger.error({ err }, "❌ فشل الاتصال بـ MongoDB");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("clientReady", () => handleReady(client));
  client.on("interactionCreate", handleInteraction);

  client.on("error", (err) => logger.error({ err }, "Discord client error"));

  await client.login(token);
}
