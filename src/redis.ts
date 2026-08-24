import { Telegraf } from "telegraf";

import { config } from "./config.js";

import {
  prisma,
  connectDatabase,
  disconnectDatabase
} from "./db.js";

import {
  connectRedis,
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

import {
  handleMemberJoin
} from "./services/raid.js";

import {
  registerAdminPanel
} from "./bot/adminPanel.js";


/*
|--------------------------------------------------------------------------
| BOT
|--------------------------------------------------------------------------
*/

const bot = new Telegraf(
  config.botToken
);


/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

async function requireAdmin(
  ctx: any
): Promise<boolean> {
  if (!ctx.chat || !ctx.from) {
    return false;
  }

  const admin = await isAdmin(
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


async function getGroup(
  chatId: number,
  title = "BABY"
) {
  return getOrCreateGroup(
    String(chatId),
    title
  );
}


function getReplyTarget(
  ctx: any
) {
  return ctx.message?.reply_to_message?.from;
}


/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

bot.start(
  async (ctx) => {
    await ctx.reply(
      [
        "🍼💚 BABY GROUP MANAGER",
        "",
        "Community security and moderation system.",
        "",
        "Use /help to see available commands.",
        "",
        "Administrators can use /panel."
      ].join("\n")
    );
  }
);


/*
|--------------------------------------------------------------------------
| HELP
|--------------------------------------------------------------------------
*/

bot.command(
  "help",
  async (ctx) => {
    await ctx.reply(
      [
        "🍼💚 BABY GROUP MANAGER",
        "",
        "MEMBER COMMANDS",
        "",
        "/rules",
        "/stats",
        "/rank",
        "",
        "ADMIN COMMANDS",
        "",
        "/panel",
        "/warn",
        "/warnings",
        "/clearwarnings",
        "/mute",
        "/unmute",
        "/ban",
        "/unban USER_ID",
        "/kick",
        "/lockdown",
        "/unlock",
        "/setwelcome TEXT",
        "/setrules TEXT",
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
  async (ctx) => {
    if (!ctx.chat) return;

    const group =
      await getGroup(
        ctx.chat.id
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
  async (ctx) => {
    if (!ctx.chat) return;

    const group =
      await getGroup(
        ctx.chat.id
      );

    const members =
      await prisma.member.count({
        where: {
          groupId: group.id
        }
      });

    const warnings =
      await prisma.warning.count({
        where: {
          groupId: group.id
        }
      });

    const messages =
      await prisma.member.aggregate({
        where: {
          groupId: group.id
        },
        _sum: {
          messages: true
        }
      });

    await ctx.reply(
      [
        "🍼💚 BABY GROUP STATS",
        "",
        `👥 Members: ${members}`,
        `💬 Messages: ${messages._sum.messages || 0}`,
        `⚠️ Warnings: ${warnings}`,
        "",
        `🛡 Anti-spam: ${
          group.antiSpamEnabled
            ? "🟢 ON"
            : "🔴 OFF"
        }`,
        `🔗 Anti-links: ${
          group.antiLinksEnabled
            ? "🟢 ON"
            : "🔴 OFF"
        }`,
        `🚨 Anti-raid: ${
          group.antiRaidEnabled
            ? "🟢 ON"
            : "🔴 OFF"
        }`,
        `🔒 Lockdown: ${
          group.lockdown
            ? "🟢 ON"
            : "🔴 OFF"
        }`
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
  async (ctx) => {
    if (!ctx.chat || !ctx.from) {
      return;
    }

    const group =
      await getGroup(
        ctx.chat.id
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
        "🍼💚 COMMUNITY RANK",
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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const target =
      getReplyTarget(ctx);

    if (!target) {
      await ctx.reply(
        "Reply to a member's message with /warn [reason]."
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
        "⛔ You cannot warn another administrator."
      );

      return;
    }

    const group =
      await getGroup(
        ctx.chat.id
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
        .join(" ")
        .trim() ||
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

    const warningCount =
      updated?.warnings || 0;

    await audit(
      bot,
      group.id,
      "WARNING",
      String(ctx.from.id),
      String(target.id),
      reason
    );

    await ctx.reply(
      [
        "⚠️ MEMBER WARNING",
        "",
        `User: @${target.username || target.first_name}`,
        `Warnings: ${warningCount}/${group.maxWarnings}`,
        `Reason: ${reason}`
      ].join("\n")
    );

    if (
      warningCount >=
      group.maxWarnings
    ) {
      try {
        await bot.telegram.restrictChatMember(
          ctx.chat.id,
          target.id,
          {
            permissions: {
              can_send_messages: false
            }
          }
        );

        await audit(
          bot,
          group.id,
          "AUTO_MUTE",
          "SYSTEM",
          String(target.id),
          "Maximum warning limit reached"
        );

        await ctx.reply(
          "🔇 Warning limit reached. Member has been muted."
        );
      } catch (error) {
        console.error(
          "Auto mute failed:",
          error
        );
      }
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
  async (ctx) => {
    if (!ctx.chat) return;

    const target =
      getReplyTarget(ctx) ||
      ctx.from;

    if (!target) return;

    const group =
      await getGroup(
        ctx.chat.id
      );

    const member =
      await prisma.member.findUnique({
        where: {
          groupId_telegramId: {
            groupId: group.id,
            telegramId:
              String(target.id)
          }
        }
      });

    await ctx.reply(
      [
        "⚠️ WARNINGS",
        "",
        `User: @${target.username || target.first_name}`,
        `Warnings: ${
          member?.warnings || 0
        }/${group.maxWarnings}`
      ].join("\n")
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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const target =
      getReplyTarget(ctx);

    if (!target) {
      await ctx.reply(
        "Reply to the member's message with /clearwarnings."
      );

      return;
    }

    const group =
      await getGroup(
        ctx.chat.id
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
      "✅ Member warnings cleared."
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
    !ctx.from
  ) {
    return;
  }

  if (
    !(await requireAdmin(ctx))
  ) {
    return;
  }

  const target =
    getReplyTarget(ctx);

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
      await getGroup(
        ctx.chat.id
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
  } catch (error) {
    console.error(
      "Mute operation failed:",
      error
    );

    await ctx.reply(
      "❌ Telegram rejected the action. Check the bot administrator permissions."
    );
  }
}


bot.command(
  "mute",
  (ctx) =>
    changeMute(ctx, true)
);


bot.command(
  "unmute",
  (ctx) =>
    changeMute(ctx, false)
);


/*
|--------------------------------------------------------------------------
| BAN
|--------------------------------------------------------------------------
*/

bot.command(
  "ban",
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const target =
      getReplyTarget(ctx);

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
        "⛔ You cannot ban another administrator."
      );

      return;
    }

    try {
      await bot.telegram.banChatMember(
        ctx.chat.id,
        target.id
      );

      const group =
        await getGroup(
          ctx.chat.id
        );

      await audit(
        bot,
        group.id,
        "BAN",
        String(ctx.from.id),
        String(target.id)
      );

      await ctx.reply(
        "🚫 Member permanently banned."
      );
    } catch (error) {
      console.error(
        "Ban failed:",
        error
      );

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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const target =
      getReplyTarget(ctx);

    if (!target) {
      await ctx.reply(
        "Reply to the member's message with /kick."
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
        "⛔ You cannot kick another administrator."
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

      const group =
        await getGroup(
          ctx.chat.id
        );

      await audit(
        bot,
        group.id,
        "KICK",
        String(ctx.from.id),
        String(target.id)
      );

      await ctx.reply(
        "👢 Member removed from the group."
      );
    } catch (error) {
      console.error(
        "Kick failed:",
        error
      );

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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const id =
      ctx.message.text
        .split(/\s+/)[1];

    if (!id) {
      await ctx.reply(
        "Usage:\n/unban USER_ID"
      );

      return;
    }

    const userId =
      Number(id);

    if (
      !Number.isSafeInteger(
        userId
      )
    ) {
      await ctx.reply(
        "❌ Invalid Telegram user ID."
      );

      return;
    }

    try {
      await bot.telegram.unbanChatMember(
        ctx.chat.id,
        userId
      );

      const group =
        await getGroup(
          ctx.chat.id
        );

      await audit(
        bot,
        group.id,
        "UNBAN",
        String(ctx.from.id),
        String(userId)
      );

      await ctx.reply(
        "✅ User unbanned."
      );
    } catch (error) {
      console.error(
        "Unban failed:",
        error
      );

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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const group =
      await getGroup(
        ctx.chat.id
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
      [
        "🚨 BABY LOCKDOWN ACTIVATED",
        "",
        "Normal member messages will be removed."
      ].join("\n")
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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const group =
      await getGroup(
        ctx.chat.id
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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
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
      await getGroup(
        ctx.chat.id
      );

    await prisma.group.update({
      where: {
        id: group.id
      },

      data: {
        welcomeMessage: text
      }
    });

    await audit(
      bot,
      group.id,
      "SET_WELCOME",
      String(ctx.from.id)
    );

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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
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
      await getGroup(
        ctx.chat.id
      );

    await prisma.group.update({
      where: {
        id: group.id
      },

      data: {
        rules: text
      }
    });

    await audit(
      bot,
      group.id,
      "SET_RULES",
      String(ctx.from.id)
    );

    await ctx.reply(
      "✅ Community rules updated."
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
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      !(await requireAdmin(ctx))
    ) {
      return;
    }

    const group =
      await getGroup(
        ctx.chat.id
      );

    await ctx.reply(
      [
        "⚙️ BABY GROUP SETTINGS",
        "",
        `👋 Welcome: ${
          group.welcomeEnabled
            ? "🟢 ON"
            : "🔴 OFF"
        }`,
        `🛡 Anti-spam: ${
          group.antiSpamEnabled
            ? "🟢 ON"
            : "🔴 OFF"
        }`,
        `🔗 Anti-links: ${
          group.antiLinksEnabled
            ? "🟢 ON"
            : "🔴 OFF"
        }`,
        `🚨 Anti-raid: ${
          group.antiRaidEnabled
            ? "🟢 ON"
            : "🔴 OFF"
        }`,
        `🔒 Lockdown: ${
          group.lockdown
            ? "🟢 ON"
            : "🔴 OFF"
        }`,
        "",
        `🌊 Flood limit: ${group.maxMessages}`,
        `⏱ Flood window: ${group.floodWindowSec}s`,
        `⚠️ Warning limit: ${group.maxWarnings}`
      ].join("\n")
    );
  }
);


/*
|--------------------------------------------------------------------------
| NEW MEMBERS / ANTI-RAID
|--------------------------------------------------------------------------
*/

bot.on(
  "new_chat_members",
  async (ctx) => {
    if (!ctx.chat) return;

    /*
     * Do NOT use ctx.chat.title here.
     * Telegraf's Chat type can also be PrivateChat.
     */

    const group =
      await getGroup(
        ctx.chat.id,
        "BABY"
      );

    for (
      const member
      of ctx.message.new_chat_members
    ) {
      await upsertMember(
        group.id,
        member
      );

      /*
       * Anti-raid detection
       */

      await handleMemberJoin(
        bot,
        ctx.chat.id,
        member.id
      );

      /*
       * Welcome
       */

      if (
        group.welcomeEnabled &&
        !group.lockdown
      ) {
        await ctx.reply(
          [
            group.welcomeMessage,
            "",
            `🍼 Welcome, ${member.first_name}!`
          ].join("\n")
        );
      }

      await audit(
        bot,
        group.id,
        "MEMBER_JOINED",
        "SYSTEM",
        String(member.id)
      );
    }
  }
);


/*
|--------------------------------------------------------------------------
| LEFT MEMBER
|--------------------------------------------------------------------------
*/

bot.on(
  "left_chat_member",
  async (ctx) => {
    if (!ctx.chat) return;

    const group =
      await getGroup(
        ctx.chat.id
      );

    const member =
      ctx.message.left_chat_member;

    await prisma.groupEvent.create({
      data: {
        groupId: group.id,
        type: "MEMBER_LEFT",
        telegramId:
          String(member.id),
        payload:
          JSON.stringify({
            username:
              member.username,
            firstName:
              member.first_name
          })
      }
    });

    await audit(
      bot,
      group.id,
      "MEMBER_LEFT",
      "SYSTEM",
      String(member.id)
    );
  }
);


/*
|--------------------------------------------------------------------------
| MESSAGE MODERATION
|--------------------------------------------------------------------------
*/

bot.on(
  "message",
  async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.from
    ) {
      return;
    }

    if (
      ctx.chat.type !== "group" &&
      ctx.chat.type !== "supergroup"
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

    await getGroup(
      ctx.chat.id,
      "BABY"
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
| BOT ERROR HANDLER
|--------------------------------------------------------------------------
*/

bot.catch(
  (error) => {
    console.error(
      "❌ Telegram bot error:",
      error
    );
  }
);


/*
|--------------------------------------------------------------------------
| STARTUP
|--------------------------------------------------------------------------
*/

async function main() {
  console.log(
    "🍼 Starting BABY Group Manager..."
  );

  /*
   * PostgreSQL
   */

  await connectDatabase();

  console.log(
    "🗄️ PostgreSQL connected"
  );

  /*
   * Redis
   */

  await connectRedis();

  console.log(
    "⚡ Redis connection verified"
  );

  /*
   * Admin panel
   */

  registerAdminPanel(
    bot
  );

  /*
   * Telegram connection
   */

  const me =
    await bot.telegram.getMe();

  console.log(
    `🤖 Connected as @${me.username}`
  );

  /*
   * Start bot
   */

  await bot.launch();

  console.log(
    "🟢 BABY Group Manager running"
  );
}


/*
|--------------------------------------------------------------------------
| GRACEFUL SHUTDOWN
|--------------------------------------------------------------------------
*/

async function shutdown(
  signal: string
) {
  console.log(
    `\n🛑 Received ${signal}. Shutting down...`
  );

  try {
    bot.stop(
      signal
    );
  } catch {}

  try {
    await closeRedis();
  } catch (error) {
    console.error(
      "Redis shutdown error:",
      error
    );
  }

  try {
    await disconnectDatabase();
  } catch (error) {
    console.error(
      "Database shutdown error:",
      error
    );
  }

  console.log(
    "✅ Shutdown complete"
  );

  process.exit(0);
}


process.once(
  "SIGINT",
  () => {
    void shutdown(
      "SIGINT"
    );
  }
);


process.once(
  "SIGTERM",
  () => {
    void shutdown(
      "SIGTERM"
    );
  }
);


/*
|--------------------------------------------------------------------------
| START APPLICATION
|--------------------------------------------------------------------------
*/

main().catch(
  async (error) => {
    console.error(
      "🔥 Fatal startup error:",
      error
    );

    try {
      await closeRedis();
    } catch {}

    try {
      await disconnectDatabase();
    } catch {}

    process.exit(1);
  }
);
