import { Telegraf } from "telegraf";
import { prisma } from "../db.js";
import { config } from "../config.js";

export async function audit(
  bot: Telegraf,
  groupId: string,
  action: string,
  actorId?: string,
  targetId?: string,
  details?: string
) {
  await prisma.auditLog.create({
    data: {
      groupId,

      action,

      actorId,

      targetId,

      details
    }
  });

  if (!config.logChatId) {
    return;
  }

  try {
    await bot.telegram.sendMessage(
      config.logChatId,

      [
        "🛡 BABY MODERATION LOG",
        "",
        `Action: ${action}`,
        `Actor: ${actorId || "SYSTEM"}`,
        `Target: ${targetId || "-"}`,
        `Details: ${details || "-"}`,
        "",
        new Date().toISOString()
      ].join("\n")
    );
  } catch (error) {
    console.error(
      "Could not send moderation log:",
      error
    );
  }
}
