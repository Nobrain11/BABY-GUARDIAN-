import {
  Telegraf
} from "telegraf";

import {
  config
} from "./config.js";

import {
  prisma,
  connectDatabase,
  disconnectDatabase
} from "./db.js";

import {
  closeRedis
} from "./redis.js";

import {
  getOrCreateGroup
} from "./services/group.js";

import {
  upsertMember,
  createWarning,
  clearWarnings
} from "./services/member.js";

import {
  audit
} from "./services/audit.js";

import {
  isAdmin,
  moderate
} from "./services/moderation.js";

const bot =
  new Telegraf(
    config.botToken
  );

async function requireAdmin(
  ctx: any
) {
  if (!ctx.chat || !ctx.from) {
    return false;
  }

  const admin =
    await isAdmin(
      bot,
      ctx.chat.id,
      ctx.from.id
    );

  if (!admin) {
    await ctx.reply(
      "⛔ Administrator permission required."
    );
  }

  return admin;
}

function replyTarget(
  ctx: any
) {
  return ctx.message
    ?.reply_to_message
    ?.from;
}

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

bot.start(async ctx => {
  await ctx.reply(
    [
      "🍼💚 BABY GROUP MANAGER",
      "",
      "Community security and moderation system.",
      "",
      "Use /help to see available commands."
    ].join("\n")
  );
});

/*
|--------------------------------------------------------------------------
| HELP
|--------------------------------------------------------------------------
*/

bot.command(
  "help",
  async ctx => {
    await ctx.reply(
      [
        "🍼💚 BABY GROUP MANAGER",
        "",
        "MEMBER",
        "/rules",
        "/stats",
        "/rank",
        "",
        "ADMIN",
        "/warn",
        "/warnings",
        "/clearwarnings",
        "/mute",
        "/unmute",
        "/ban",
        "/unban",
        "/kick",
        "/lockdown",
        "/unlock",
        "/setwelcome",
        "/setrules",
        "/settings"
      ].join("\n")
    );
  }
);

/*
|--------------------------------------------------------------------------
| RULES
|--------------------------------------------------------------------------
*/

bot.command(
  "rules",
  async ctx => {
    if (!ctx.chat) return;

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id),
        ctx.chat.type
      );

    await ctx.reply(
      group.rules
    );
  }
);

/*
|--------------------------------------------------------------------------
| STATS
|--------------------------------------------------------------------------
*/

bot.command(
  "stats",
  async ctx => {
    if (!ctx.chat) return;

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id),
        ctx.chat.type
      );

    const [
      members,
      messages,
      warnings
    ] = await Promise.all([
      prisma.member.count({
        where: {
          groupId: group.id
        }
      }),

      prisma.member.aggregate({
        where: {
          groupId: group.id
        },

        _sum: {
          messages: true
        }
      }),

      prisma.warning.count({
        where: {
          groupId: group.id
        }
      })
    ]);

    await ctx.reply(
      [
        "🍼💚 BABY STATS",
        "",
        `Members: ${members}`,
        `Messages: ${messages._sum.messages || 0}`,
        `Warnings: ${warnings}`,
        "",
        `Anti-spam: ${group.antiSpamEnabled ? "ON" : "OFF"}`,
        `Anti-links: ${group.antiLinksEnabled ? "ON" : "OFF"}`,
        `Anti-raid: ${group.antiRaidEnabled ? "ON" : "OFF"}`,
        `Lockdown: ${group.lockdown ? "ON" : "OFF"}`
      ].join("\n")
    );
  }
);

/*
|--------------------------------------------------------------------------
| RANK
|--------------------------------------------------------------------------
*/

bot.command(
  "rank",
  async ctx => {
    if (!ctx.chat || !ctx.from) {
      return;
    }

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    const member =
      await upsertMember(
        group.id,
        ctx.from
      );

    const level =
      Math.floor(
        member.xp / 100
      ) + 1;

    await ctx.reply(
      [
        "🍼 COMMUNITY RANK",
        "",
        `User: @${ctx.from.username || ctx.from.first_name}`,
        `Level: ${level}`,
        `XP: ${member.xp}`,
        `Messages: ${member.messages}`,
        `Warnings: ${member.warnings}`
      ].join("\n")
    );
  }
);

/*
|--------------------------------------------------------------------------
| WARN
|--------------------------------------------------------------------------
*/

bot.command(
  "warn",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const target =
      replyTarget(ctx);

    if (!target) {
      await ctx.reply(
        "Reply to a member's message with /warn [reason]."
      );

      return;
    }

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    const member =
      await upsertMember(
        group.id,
        target
      );

    const reason =
      ctx.message.text
        .split(" ")
        .slice(1)
        .join(" ") ||
      "No reason provided";

    await createWarning(
      group.id,
      member.id,
      reason,
      String(ctx.from.id)
    );

    const updated =
      await prisma.member.findUnique({
        where: {
          id: member.id
        }
      });

    await audit(
      bot,
      group.id,
      "WARNING",
      String(ctx.from.id),
      String(target.id),
      reason
    );

    await ctx.reply(
      `⚠️ WARNING ${updated?.warnings || 0}/${group.maxWarnings}\n\nReason: ${reason}`
    );

    if (
      (updated?.warnings || 0) >=
      group.maxWarnings
    ) {
      try {
        await bot.telegram.restrictChatMember(
          ctx.chat.id,
          target.id,
          {
            permissions: {
              can_send_messages:
                false
            }
          }
        );

        await ctx.reply(
          "🔇 Warning limit reached. Member muted."
        );
      } catch {}
    }
  }
);

/*
|--------------------------------------------------------------------------
| WARNINGS
|--------------------------------------------------------------------------
*/

bot.command(
  "warnings",
  async ctx => {
    if (!ctx.chat) return;

    const target =
      replyTarget(ctx) ||
      ctx.from;

    if (!target) return;

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    const member =
      await prisma.member.findUnique({
        where: {
          groupId_telegramId: {
            groupId:
              group.id,

            telegramId:
              String(target.id)
          }
        }
      });

    await ctx.reply(
      `⚠️ @${target.username || target.first_name} has ${member?.warnings || 0} warning(s).`
    );
  }
);

/*
|--------------------------------------------------------------------------
| CLEAR WARNINGS
|--------------------------------------------------------------------------
*/

bot.command(
  "clearwarnings",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const target =
      replyTarget(ctx);

    if (!target) {
      await ctx.reply(
        "Reply to the member with /clearwarnings."
      );

      return;
    }

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    await clearWarnings(
      group.id,
      String(target.id)
    );

    await audit(
      bot,
      group.id,
      "CLEAR_WARNINGS",
      String(ctx.from.id),
      String(target.id)
    );

    await ctx.reply(
      "✅ Warnings cleared."
    );
  }
);

/*
|--------------------------------------------------------------------------
| MUTE / UNMUTE
|--------------------------------------------------------------------------
*/

async function changeMute(
  ctx: any,
  muted: boolean
) {
  if (
    !ctx.chat ||
    !ctx.from ||
    !(await requireAdmin(ctx))
  ) {
    return;
  }

  const target =
    replyTarget(ctx);

  if (!target) {
    await ctx.reply(
      "Reply to the member's message."
    );

    return;
  }

  if (
    await isAdmin(
      bot,
      ctx.chat.id,
      target.id
    )
  ) {
    await ctx.reply(
      "⛔ You cannot moderate another administrator."
    );

    return;
  }

  try {
    await bot.telegram.restrictChatMember(
      ctx.chat.id,
      target.id,
      {
        permissions: muted
          ? {
              can_send_messages:
                false
            }
          : {
              can_send_messages:
                true,

              can_send_audios:
                true,

              can_send_documents:
                true,

              can_send_photos:
                true,

              can_send_videos:
                true,

              can_send_video_notes:
                true,

              can_send_voice_notes:
                true,

              can_send_polls:
                true,

              can_add_web_page_previews:
                true
            }
      }
    );

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    await audit(
      bot,
      group.id,
      muted
        ? "MUTE"
        : "UNMUTE",
      String(ctx.from.id),
      String(target.id)
    );

    await ctx.reply(
      muted
        ? "🔇 Member muted."
        : "🔊 Member unmuted."
    );
  } catch {
    await ctx.reply(
      "❌ Telegram rejected the action. Check bot permissions."
    );
  }
}

bot.command(
  "mute",
  ctx => changeMute(ctx, true)
);

bot.command(
  "unmute",
  ctx => changeMute(ctx, false)
);

/*
|--------------------------------------------------------------------------
| BAN
|--------------------------------------------------------------------------
*/

bot.command(
  "ban",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const target =
      replyTarget(ctx);

    if (!target) {
      await ctx.reply(
        "Reply to the member's message with /ban."
      );

      return;
    }

    if (
      await isAdmin(
        bot,
        ctx.chat.id,
        target.id
      )
    ) {
      await ctx.reply(
        "⛔ Cannot ban another administrator."
      );

      return;
    }

    try {
      await bot.telegram.banChatMember(
        ctx.chat.id,
        target.id
      );

      const group =
        await getOrCreateGroup(
          String(ctx.chat.id)
        );

      await audit(
        bot,
        group.id,
        "BAN",
        String(ctx.from.id),
        String(target.id)
      );

      await ctx.reply(
        "🚫 Member banned."
      );
    } catch {
      await ctx.reply(
        "❌ Unable to ban member."
      );
    }
  }
);

/*
|--------------------------------------------------------------------------
| KICK
|--------------------------------------------------------------------------
*/

bot.command(
  "kick",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const target =
      replyTarget(ctx);

    if (!target) {
      await ctx.reply(
        "Reply to the member's message with /kick."
      );

      return;
    }

    try {
      await bot.telegram.banChatMember(
        ctx.chat.id,
        target.id
      );

      await bot.telegram.unbanChatMember(
        ctx.chat.id,
        target.id
      );

      await ctx.reply(
        "👢 Member removed."
      );
    } catch {
      await ctx.reply(
        "❌ Unable to remove member."
      );
    }
  }
);

/*
|--------------------------------------------------------------------------
| UNBAN
|--------------------------------------------------------------------------
*/

bot.command(
  "unban",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const id =
      ctx.message.text
        .split(/\s+/)[1];

    if (!id) {
      await ctx.reply(
        "Usage: /unban USER_ID"
      );

      return;
    }

    try {
      await bot.telegram.unbanChatMember(
        ctx.chat.id,
        Number(id)
      );

      await ctx.reply(
        "✅ User unbanned."
      );
    } catch {
      await ctx.reply(
        "❌ Unable to unban user."
      );
    }
  }
);

/*
|--------------------------------------------------------------------------
| LOCKDOWN
|--------------------------------------------------------------------------
*/

bot.command(
  "lockdown",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    await prisma.group.update({
      where: {
        id: group.id
      },

      data: {
        lockdown: true
      }
    });

    await audit(
      bot,
      group.id,
      "LOCKDOWN",
      String(ctx.from.id)
    );

    await ctx.reply(
      "🚨 BABY LOCKDOWN ACTIVATED."
    );
  }
);

/*
|--------------------------------------------------------------------------
| UNLOCK
|--------------------------------------------------------------------------
*/

bot.command(
  "unlock",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    await prisma.group.update({
      where: {
        id: group.id
      },

      data: {
        lockdown: false
      }
    });

    await audit(
      bot,
      group.id,
      "UNLOCK",
      String(ctx.from.id)
    );

    await ctx.reply(
      "🔓 BABY GROUP UNLOCKED."
    );
  }
);

/*
|--------------------------------------------------------------------------
| SET WELCOME
|--------------------------------------------------------------------------
*/

bot.command(
  "setwelcome",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const text =
      ctx.message.text
        .replace(
          /^\/setwelcome\s*/i,
          ""
        )
        .trim();

    if (!text) {
      await ctx.reply(
        "Usage:\n/setwelcome Your welcome message"
      );

      return;
    }

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    await prisma.group.update({
      where: {
        id: group.id
      },

      data: {
        welcomeMessage:
          text
      }
    });

    await ctx.reply(
      "✅ Welcome message updated."
    );
  }
);

/*
|--------------------------------------------------------------------------
| SET RULES
|--------------------------------------------------------------------------
*/

bot.command(
  "setrules",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const text =
      ctx.message.text
        .replace(
          /^\/setrules\s*/i,
          ""
        )
        .trim();

    if (!text) {
      await ctx.reply(
        "Usage:\n/setrules Your rules"
      );

      return;
    }

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    await prisma.group.update({
      where: {
        id: group.id
      },

      data: {
        rules: text
      }
    });

    await ctx.reply(
      "✅ Rules updated."
    );
  }
);

/*
|--------------------------------------------------------------------------
| SETTINGS
|--------------------------------------------------------------------------
*/

bot.command(
  "settings",
  async ctx => {
    if (
      !ctx.chat ||
      !ctx.from ||
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    await ctx.reply(
      [
        "⚙️ BABY SETTINGS",
        "",
        `Anti-spam: ${group.antiSpamEnabled ? "ON" : "OFF"}`,
        `Anti-links: ${group.antiLinksEnabled ? "ON" : "OFF"}`,
        `Anti-raid: ${group.antiRaidEnabled ? "ON" : "OFF"}`,
        `Lockdown: ${group.lockdown ? "ON" : "OFF"}`,
        "",
        `Flood limit: ${group.maxMessages}`,
        `Flood window: ${group.floodWindowSec}s`,
        `Warning limit: ${group.maxWarnings}`
      ].join("\n")
    );
  }
);

/*
|--------------------------------------------------------------------------
| NEW MEMBERS
|--------------------------------------------------------------------------
*/

bot.on(
  "new_chat_members",
  async ctx => {
    if (!ctx.chat) return;

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id),
        "BABY"
      );

    if (
      !group.welcomeEnabled
    ) {
      return;
    }

    for (
      const member
      of ctx.message
          .new_chat_members
    ) {
      await upsertMember(
        group.id,
        member
      );

      await ctx.reply(
        `${group.welcomeMessage}\n\nWelcome, ${member.first_name}! 🍼💚`
      );
    }
  }
);

/*
|--------------------------------------------------------------------------
| LEFT MEMBERS
|--------------------------------------------------------------------------
*/

bot.on(
  "left_chat_member",
  async ctx => {
    if (!ctx.chat) return;

    const group =
      await getOrCreateGroup(
        String(ctx.chat.id)
      );

    await prisma.groupEvent.create({
      data: {
        groupId:
          group.id,

        type:
          "MEMBER_LEFT",

        telegramId:
          String(
            ctx.message
              .left_chat_member.id
          )
      }
    });
  }
);

/*
|--------------------------------------------------------------------------
| MESSAGE MODERATION
|--------------------------------------------------------------------------
*/

bot.on(
  "message",
  async ctx => {
    if (!ctx.chat || !ctx.from) {
      return;
    }

    if (
      ctx.chat.type !==
        "group" &&
      ctx.chat.type !==
        "supergroup"
    ) {
      return;
    }

    if (
      "new_chat_members" in
      ctx.message
    ) {
      return;
    }

    if (
      "left_chat_member" in
      ctx.message
    ) {
      return;
    }

    await getOrCreateGroup(
      String(ctx.chat.id),
      ctx.chat.type
    );

    await moderate(
      bot,
      ctx.chat.id,
      ctx.message,
      ctx.from
    );
  }
);

/*
|--------------------------------------------------------------------------
| ERROR HANDLER
|--------------------------------------------------------------------------
*/

bot.catch(error => {
  console.error(
    "Telegram error:",
    error
  );
});

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

async function main() {
  await connectDatabase();

  const me =
    await bot.telegram.getMe();

  console.log(
    `🍼 Connected as @${me.username}`
  );

  await bot.launch();

  console.log(
    "🟢 BABY Group Manager running"
  );
}

async function shutdown(
  signal: string
) {
  console.log(
    `Received ${signal}`
  );

  bot.stop(signal);

  await closeRedis();

  await disconnectDatabase();

  process.exit(0);
}

process.once(
  "SIGINT",
  () => void shutdown("SIGINT")
);

process.once(
  "SIGTERM",
  () => void shutdown("SIGTERM")
);

main().catch(async error => {
  console.error(
    "Fatal startup error:",
    error
  );

  await closeRedis();

  await disconnectDatabase();

  process.exit(1);
});
