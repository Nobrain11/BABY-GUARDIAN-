import { Telegraf } from "telegraf";
import { prisma } from "../db.js";
import { redis } from "../redis.js";
import { audit } from "./audit.js";

const JOIN_WINDOW_SECONDS = 60;
const RAID_THRESHOLD = 8;

export async function handleMemberJoin(
  bot: Telegraf,
  chatId: number,
  userId: number
): Promise<void> {
  const group =
    await prisma.group.findUnique({
      where: {
        telegramId: String(chatId)
      }
    });

  if (!group) {
    return;
  }

  if (!group.antiRaidEnabled) {
    return;
  }

  if (group.lockdown) {
    return;
  }

  const key =
    `raid:joins:${chatId}`;

  const joins =
    await redis.incr(key);

  if (joins === 1) {
    await redis.expire(
      key,
      JOIN_WINDOW_SECONDS
    );
  }

  if (
    joins < RAID_THRESHOLD
  ) {
    return;
  }

  await activateRaidMode(
    bot,
    chatId,
    group.id,
    joins
  );
}

async function activateRaidMode(
  bot: Telegraf,
  chatId: number,
  groupId: string,
  joins: number
): Promise<void> {
  const group =
    await prisma.group.findUnique({
      where: {
        id: groupId
      }
    });

  if (!group) {
    return;
  }

  if (group.lockdown) {
    return;
  }

  await prisma.group.update({
    where: {
      id: groupId
    },

    data: {
      lockdown: true
    }
  });

  await audit(
    bot,
    groupId,
    "ANTI_RAID_LOCKDOWN",
    "SYSTEM",
    undefined,
    `${joins} members joined within ${JOIN_WINDOW_SECONDS} seconds`
  );

  try {
    await bot.telegram.sendMessage(
      chatId,
      [
        "🚨 BABY ANTI-RAID ACTIVATED",
        "",
        `⚠️ ${joins} new members detected within ${JOIN_WINDOW_SECONDS} seconds.`,
        "",
        "🔒 Group lockdown has been activated.",
        "🛡 Normal member messages will be removed.",
        "",
        "An administrator can review the group and use /unlock."
      ].join("\n")
    );
  } catch (error) {
    console.error(
      "Failed to send anti-raid alert:",
      error
    );
  }
}
