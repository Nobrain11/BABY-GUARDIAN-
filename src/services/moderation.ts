import {
  Telegraf
} from "telegraf";

import type {
  Message
} from "telegraf/types";

import {
  prisma
} from "../db.js";

import {
  redis,
  incrementRateLimit
} from "../redis.js";

import {
  getBlockedWords
} from "./group.js";

import {
  upsertMember,
  createWarning,
  recordMessage
} from "./member.js";

import {
  audit
} from "./audit.js";

export async function isAdmin(
  bot: Telegraf,
  chatId: number,
  userId: number
) {
  try {
    const member =
      await bot.telegram.getChatMember(
        chatId,
        userId
      );

    return (
      member.status ===
        "administrator" ||
      member.status ===
        "creator"
    );
  } catch {
    return false;
  }
}

function getText(
  message: Message
) {
  if ("text" in message) {
    return message.text || "";
  }

  if ("caption" in message) {
    return message.caption || "";
  }

  return "";
}

function containsLink(
  text: string
) {
  return /(https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i
    .test(text);
}

export async function moderate(
  bot: Telegraf,
  chatId: number,
  message: Message,
  user: {
    id: number;
    username?: string;
    first_name: string;
    last_name?: string;
  }
) {
  const group =
    await prisma.group.findUnique({
      where: {
        telegramId:
          String(chatId)
      }
    });

  if (!group) {
    return;
  }

  if (
    await isAdmin(
      bot,
      chatId,
      user.id
    )
  ) {
    await recordMessage(
      group.id,
      user.id
    );

    return;
  }

  const member =
    await upsertMember(
      group.id,
      user
    );

  await recordMessage(
    group.id,
    user.id
  );

  if (group.lockdown) {
    try {
      await bot.telegram.deleteMessage(
        chatId,
        message.message_id
      );
    } catch {}

    return;
  }

  /*
   * Anti flood
   */

  const floodKey =
    `flood:${chatId}:${user.id}`;

  const count =
    await incrementRateLimit(
      floodKey,
      group.floodWindowSec
    );

  if (
    group.antiSpamEnabled &&
    count > group.maxMessages
  ) {
    try {
      await bot.telegram.restrictChatMember(
        chatId,
        user.id,
        {
          permissions: {
            can_send_messages:
              false
          }
        }
      );
    } catch {}

    try {
      await bot.telegram.deleteMessage(
        chatId,
        message.message_id
      );
    } catch {}

    await audit(
      bot,
      group.id,
      "ANTI_SPAM_MUTE",
      "SYSTEM",
      String(user.id),
      "Flood limit exceeded"
    );

    return;
  }

  const text =
    getText(message);

  /*
   * Anti link
   */

  if (
    group.antiLinksEnabled &&
    containsLink(text)
  ) {
    try {
      await bot.telegram.deleteMessage(
        chatId,
        message.message_id
      );
    } catch {}

    await createWarning(
      group.id,
      member.id,
      "Unauthorized link",
      "SYSTEM"
    );

    await audit(
      bot,
      group.id,
      "LINK_REMOVED",
      "SYSTEM",
      String(user.id)
    );

    return;
  }

  /*
   * Blocked words
   */

  const words =
    getBlockedWords(
      group.blockedWords
    );

  const hit =
    words.find(word =>
      text
        .toLowerCase()
        .includes(word)
    );

  if (hit) {
    try {
      await bot.telegram.deleteMessage(
        chatId,
        message.message_id
      );
    } catch {}

    await createWarning(
      group.id,
      member.id,
      `Blocked phrase: ${hit}`,
      "SYSTEM"
    );

    await audit(
      bot,
      group.id,
      "BLOCKED_CONTENT",
      "SYSTEM",
      String(user.id),
      hit
    );
  }
}
