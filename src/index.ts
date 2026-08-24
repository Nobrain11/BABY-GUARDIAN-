import "dotenv/config";
import { Telegraf, Context } from "telegraf";
import {
  ChatMember,
  Message,
  Update
} from "telegraf/types";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

const bot = new Telegraf(BOT_TOKEN);

type UserRecord = {
  warnings: number;
  messages: number;
  joinedAt: number;
  lastMessages: number[];
};

type GroupSettings = {
  welcome: boolean;
  antiSpam: boolean;
  antiLinks: boolean;
  antiRaid: boolean;
  lockdown: boolean;
  maxMessages: number;
  floodWindow: number;
  maxWarnings: number;
  rules: string;
  welcomeMessage: string;
  blockedWords: string[];
};

const users = new Map<string, UserRecord>();
const groups = new Map<string, GroupSettings>();

const DEFAULT_RULES = `
🍼💚 BABY COMMUNITY RULES

1. No scams.
2. No spam.
3. No phishing links.
4. No impersonation.
5. No fake BABY announcements.
6. No malicious links.
7. Respect other members.
8. Never ask for private keys or seed phrases.
9. Admins will never ask you to send funds.
10. Have fun and let's grow old together. 🍼💚
`;

const DEFAULT_WELCOME = `
🍼💚 WELCOME TO BABY!

The first baby born on Robinhood Chain.

Please read the group rules and stay alert for scams.

Grab your dummy.

Let's grow old together. 🍼💚
`;

function groupKey(ctx: Context): string | null {
  const chat = ctx.chat;

  if (!chat) return null;

  if (chat.type !== "group" && chat.type !== "supergroup") {
    return null;
  }

  return String(chat.id);
}

function getSettings(chatId: string): GroupSettings {
  let settings = groups.get(chatId);

  if (!settings) {
    settings = {
      welcome: true,
      antiSpam: true,
      antiLinks: true,
      antiRaid: true,
      lockdown: false,
      maxMessages: 6,
      floodWindow: 5,
      maxWarnings: 3,
      rules: DEFAULT_RULES,
      welcomeMessage: DEFAULT_WELCOME,
      blockedWords: [
        "free eth",
        "double your",
        "send eth",
        "send crypto",
        "claim reward",
        "airdrop now",
        "connect wallet"
      ]
    };

    groups.set(chatId, settings);
  }

  return settings;
}

function getUser(userId: string): UserRecord {
  let user = users.get(userId);

  if (!user) {
    user = {
      warnings: 0,
      messages: 0,
      joinedAt: Date.now(),
      lastMessages: []
    };

    users.set(userId, user);
  }

  return user;
}

async function isAdmin(
  ctx: Context,
  userId?: number
): Promise<boolean> {
  if (!ctx.chat || !userId) return false;

  try {
    const member = await ctx.telegram.getChatMember(
      ctx.chat.id,
      userId
    );

    return (
      member.status === "creator" ||
      member.status === "administrator"
    );
  } catch {
    return false;
  }
}

async function isOwner(
  ctx: Context,
  userId?: number
): Promise<boolean> {
  if (!ctx.chat || !userId) return false;

  try {
    const member = await ctx.telegram.getChatMember(
      ctx.chat.id,
      userId
    );

    return member.status === "creator";
  } catch {
    return false;
  }
}

async function logAction(
  ctx: Context,
  action: string,
  details: string
) {
  const chatId = process.env.LOG_CHAT_ID;

  if (!chatId) return;

  try {
    await ctx.telegram.sendMessage(
      chatId,
      [
        "🛡 MODERATION LOG",
        "",
        `Action: ${action}`,
        `Details: ${details}`,
        `Time: ${new Date().toISOString()}`
      ].join("\n")
    );
  } catch (error) {
    console.error("Failed to send log:", error);
  }
}

async function deleteMessage(
  ctx: Context,
  messageId: number
) {
  try {
    if (!ctx.chat) return;

    await ctx.telegram.deleteMessage(
      ctx.chat.id,
      messageId
    );
  } catch {
    // Bot may not have delete permissions.
  }
}

async function warnUser(
  ctx: Context,
  userId: number,
  reason: string
) {
  const user = getUser(String(userId));

  user.warnings += 1;

  const chatId = ctx.chat?.id;

  if (!chatId) return;

  await logAction(
    ctx,
    "WARNING",
    `${userId} — ${reason}`
  );

  if (user.warnings >= getSettings(String(chatId)).maxWarnings) {
    try {
      await ctx.telegram.restrictChatMember(
        chatId,
        userId,
        {
          permissions: {
            can_send_messages: false,
            can_send_audios: false,
            can_send_documents: false,
            can_send_photos: false,
            can_send_videos: false,
            can_send_video_notes: false,
            can_send_voice_notes: false,
            can_send_polls: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
            can_change_info: false,
            can_invite_users: false,
            can_pin_messages: false
          }
        }
      );

      user.warnings = 0;

      await ctx.reply(
        `🔇 User has been muted after reaching the warning limit.\n\nReason: ${reason}`
      );
    } catch {
      await ctx.reply(
        `⚠️ Warning issued.\n\nReason: ${reason}`
      );
    }

    return;
  }

  await ctx.reply(
    `⚠️ WARNING ${user.warnings}/${getSettings(String(chatId)).maxWarnings}\n\nReason: ${reason}`
  );
}

function extractText(message: Message): string {
  if ("text" in message && message.text) {
    return message.text;
  }

  if ("caption" in message && message.caption) {
    return message.caption;
  }

  return "";
}

function containsLink(text: string): boolean {
  return /(https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text);
}

function containsBlockedWord(
  text: string,
  blockedWords: string[]
): string | null {
  const lower = text.toLowerCase();

  for (const word of blockedWords) {
    if (lower.includes(word.toLowerCase())) {
      return word;
    }
  }

  return null;
}

async function handleFlood(
  ctx: Context,
  userId: number
): Promise<boolean> {
  const chatId = groupKey(ctx);

  if (!chatId) return false;

  const settings = getSettings(chatId);
  const user = getUser(String(userId));

  const now = Date.now();

  user.lastMessages = user.lastMessages.filter(
    timestamp =>
      now - timestamp < settings.floodWindow * 1000
  );

  user.lastMessages.push(now);

  if (
    settings.antiSpam &&
    user.lastMessages.length > settings.maxMessages
  ) {
    try {
      await ctx.telegram.restrictChatMember(
        Number(chatId),
        userId,
        {
          permissions: {
            can_send_messages: false
          }
        }
      );

      await ctx.reply(
        `🚫 Anti-spam protection activated for @${ctx.from?.username ?? "user"}.\n\nMuted for flooding the chat.`
      );

      await logAction(
        ctx,
        "ANTI-SPAM",
        `${userId} muted for message flooding`
      );

      user.lastMessages = [];

      return true;
    } catch {
      return false;
    }
  }

  return false;
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
      "Welcome to the BABY community.",
      "",
      "I protect the group from spam, raids, scams and abusive activity.",
      "",
      "Use /rules to see the community rules."
    ].join("\n")
  );
});

/*
|--------------------------------------------------------------------------
| HELP
|--------------------------------------------------------------------------
*/

bot.command("help", async ctx => {
  await ctx.reply(
    [
      "🍼 BABY GROUP MANAGER",
      "",
      "/rules — Community rules",
      "/stats — Group statistics",
      "",
      "Admin commands:",
      "/warn",
      "/mute",
      "/unmute",
      "/ban",
      "/unban",
      "/kick",
      "/warnings",
      "/clearwarnings",
      "/lockdown",
      "/unlock",
      "/setwelcome",
      "/setrules"
    ].join("\n")
  );
});

/*
|--------------------------------------------------------------------------
| RULES
|--------------------------------------------------------------------------
*/

bot.command("rules", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId) return;

  await ctx.reply(getSettings(chatId).rules);
});

/*
|--------------------------------------------------------------------------
| STATS
|--------------------------------------------------------------------------
*/

bot.command("stats", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId) return;

  const groupUsers = [...users.values()];

  const totalMessages = groupUsers.reduce(
    (sum, user) => sum + user.messages,
    0
  );

  const warnings = groupUsers.reduce(
    (sum, user) => sum + user.warnings,
    0
  );

  await ctx.reply(
    [
      "🍼💚 BABY COMMUNITY STATS",
      "",
      `Tracked Users: ${groupUsers.length}`,
      `Messages: ${totalMessages}`,
      `Active Warnings: ${warnings}`,
      "",
      `Anti-Spam: ${getSettings(chatId).antiSpam ? "ON" : "OFF"}`,
      `Anti-Link: ${getSettings(chatId).antiLinks ? "ON" : "OFF"}`,
      `Anti-Raid: ${getSettings(chatId).antiRaid ? "ON" : "OFF"}`,
      `Lockdown: ${getSettings(chatId).lockdown ? "ON" : "OFF"}`
    ].join("\n")
  );
});

/*
|--------------------------------------------------------------------------
| WARN
|--------------------------------------------------------------------------
*/

bot.command("warn", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  if (!ctx.message || !("reply_to_message" in ctx.message)) {
    await ctx.reply(
      "Reply to the member's message with /warn [reason]."
    );
    return;
  }

  const target =
    ctx.message.reply_to_message.from;

  if (!target) return;

  const reason =
    ctx.message.text.split(" ").slice(1).join(" ") ||
    "No reason provided";

  await warnUser(
    ctx,
    target.id,
    reason
  );
});

/*
|--------------------------------------------------------------------------
| MUTE
|--------------------------------------------------------------------------
*/

bot.command("mute", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  if (!ctx.message || !("reply_to_message" in ctx.message)) {
    await ctx.reply(
      "Reply to a member's message with /mute."
    );
    return;
  }

  const target =
    ctx.message.reply_to_message.from;

  if (!target) return;

  try {
    await ctx.telegram.restrictChatMember(
      Number(chatId),
      target.id,
      {
        permissions: {
          can_send_messages: false
        }
      }
    );

    await ctx.reply(
      `🔇 @${target.username ?? target.first_name} has been muted.`
    );

    await logAction(
      ctx,
      "MUTE",
      `${target.id}`
    );
  } catch {
    await ctx.reply(
      "❌ I need administrator permission to mute members."
    );
  }
});

/*
|--------------------------------------------------------------------------
| UNMUTE
|--------------------------------------------------------------------------
*/

bot.command("unmute", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  if (!ctx.message || !("reply_to_message" in ctx.message)) {
    await ctx.reply(
      "Reply to the member's message with /unmute."
    );
    return;
  }

  const target =
    ctx.message.reply_to_message.from;

  if (!target) return;

  try {
    await ctx.telegram.restrictChatMember(
      Number(chatId),
      target.id,
      {
        permissions: {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true
        }
      }
    );

    await ctx.reply(
      `🔊 @${target.username ?? target.first_name} has been unmuted.`
    );
  } catch {
    await ctx.reply(
      "❌ Unable to unmute this member."
    );
  }
});

/*
|--------------------------------------------------------------------------
| BAN
|--------------------------------------------------------------------------
*/

bot.command("ban", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  if (!ctx.message || !("reply_to_message" in ctx.message)) {
    await ctx.reply(
      "Reply to the member's message with /ban."
    );
    return;
  }

  const target =
    ctx.message.reply_to_message.from;

  if (!target) return;

  if (await isAdmin(ctx, target.id)) {
    await ctx.reply(
      "❌ You cannot ban another administrator."
    );
    return;
  }

  try {
    await ctx.telegram.banChatMember(
      Number(chatId),
      target.id
    );

    await ctx.reply(
      `🚫 @${target.username ?? target.first_name} has been banned.`
    );

    await logAction(
      ctx,
      "BAN",
      `${target.id}`
    );
  } catch {
    await ctx.reply(
      "❌ Unable to ban this member."
    );
  }
});

/*
|--------------------------------------------------------------------------
| KICK
|--------------------------------------------------------------------------
*/

bot.command("kick", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  if (!ctx.message || !("reply_to_message" in ctx.message)) {
    await ctx.reply(
      "Reply to the member's message with /kick."
    );
    return;
  }

  const target =
    ctx.message.reply_to_message.from;

  if (!target) return;

  if (await isAdmin(ctx, target.id)) {
    return;
  }

  try {
    await ctx.telegram.banChatMember(
      Number(chatId),
      target.id
    );

    await ctx.telegram.unbanChatMember(
      Number(chatId),
      target.id
    );

    await ctx.reply(
      `👢 @${target.username ?? target.first_name} was removed from the group.`
    );
  } catch {
    await ctx.reply(
      "❌ Unable to kick this member."
    );
  }
});

/*
|--------------------------------------------------------------------------
| UNBAN
|--------------------------------------------------------------------------
*/

bot.command("unban", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  const id =
    ctx.message.text.split(" ")[1];

  if (!id) {
    await ctx.reply(
      "Usage: /unban USER_ID"
    );
    return;
  }

  try {
    await ctx.telegram.unbanChatMember(
      Number(chatId),
      Number(id)
    );

    await ctx.reply(
      `✅ User ${id} has been unbanned.`
    );
  } catch {
    await ctx.reply(
      "❌ Unable to unban that user."
    );
  }
});

/*
|--------------------------------------------------------------------------
| WARNINGS
|--------------------------------------------------------------------------
*/

bot.command("warnings", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId) return;

  if (!ctx.message || !("reply_to_message" in ctx.message)) {
    await ctx.reply(
      "Reply to a user's message with /warnings."
    );
    return;
  }

  const target =
    ctx.message.reply_to_message.from;

  if (!target) return;

  const user = getUser(String(target.id));

  await ctx.reply(
    `⚠️ @${target.username ?? target.first_name} has ${user.warnings} warning(s).`
  );
});

/*
|--------------------------------------------------------------------------
| CLEAR WARNINGS
|--------------------------------------------------------------------------
*/

bot.command("clearwarnings", async ctx => {
  if (!ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  if (!ctx.message || !("reply_to_message" in ctx.message)) {
    await ctx.reply(
      "Reply to a user's message with /clearwarnings."
    );
    return;
  }

  const target =
    ctx.message.reply_to_message.from;

  if (!target) return;

  const user = getUser(String(target.id));

  user.warnings = 0;

  await ctx.reply(
    `✅ Warnings cleared for @${target.username ?? target.first_name}.`
  );
});

/*
|--------------------------------------------------------------------------
| LOCKDOWN
|--------------------------------------------------------------------------
*/

bot.command("lockdown", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  const settings = getSettings(chatId);

  settings.lockdown = true;

  await ctx.reply(
    [
      "🚨 BABY LOCKDOWN MODE ACTIVATED",
      "",
      "New activity will be heavily restricted.",
      "Admins can still manage the group.",
      "",
      "Use /unlock to restore normal mode."
    ].join("\n")
  );

  await logAction(
    ctx,
    "LOCKDOWN",
    `Activated by ${ctx.from.id}`
  );
});

/*
|--------------------------------------------------------------------------
| UNLOCK
|--------------------------------------------------------------------------
*/

bot.command("unlock", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  const settings = getSettings(chatId);

  settings.lockdown = false;

  await ctx.reply(
    [
      "🔓 BABY GROUP UNLOCKED",
      "",
      "Normal community mode has been restored. 🍼💚"
    ].join("\n")
  );

  await logAction(
    ctx,
    "UNLOCK",
    `Activated by ${ctx.from.id}`
  );
});

/*
|--------------------------------------------------------------------------
| SET WELCOME
|--------------------------------------------------------------------------
*/

bot.command("setwelcome", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  const message =
    ctx.message.text
      .replace(/^\/setwelcome\s*/i, "")
      .trim();

  if (!message) {
    await ctx.reply(
      "Usage:\n/setwelcome Your welcome message"
    );
    return;
  }

  getSettings(chatId).welcomeMessage = message;

  await ctx.reply(
    "✅ Welcome message updated."
  );
});

/*
|--------------------------------------------------------------------------
| SET RULES
|--------------------------------------------------------------------------
*/

bot.command("setrules", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if (!(await isAdmin(ctx, ctx.from.id))) {
    return;
  }

  const rules =
    ctx.message.text
      .replace(/^\/setrules\s*/i, "")
      .trim();

  if (!rules) {
    await ctx.reply(
      "Usage:\n/setrules Your new rules"
    );
    return;
  }

  getSettings(chatId).rules = rules;

  await ctx.reply(
    "✅ Group rules updated."
  );
});

/*
|--------------------------------------------------------------------------
| NEW MEMBERS
|--------------------------------------------------------------------------
*/

bot.on("new_chat_members", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId) return;

  const settings = getSettings(chatId);

  if (!settings.welcome) return;

  for (const member of ctx.message.new_chat_members) {
    const user = getUser(String(member.id));

    user.joinedAt = Date.now();

    await ctx.reply(
      `${settings.welcomeMessage}\n\nWelcome, ${member.first_name}!`
    );
  }
});

/*
|--------------------------------------------------------------------------
| MESSAGE MODERATION
|--------------------------------------------------------------------------
*/

bot.on("message", async ctx => {
  const chatId = groupKey(ctx);

  if (!chatId || !ctx.from) return;

  if ("new_chat_members" in ctx.message) {
    return;
  }

  const settings = getSettings(chatId);

  const user = getUser(String(ctx.from.id));

  user.messages += 1;

  /*
  |--------------------------------------------------------------------------
  | Admin bypass
  |--------------------------------------------------------------------------
  */

  if (await isAdmin(ctx, ctx.from.id)) {
    return;
  }

  /*
  |--------------------------------------------------------------------------
  | LOCKDOWN
  |--------------------------------------------------------------------------
  */

  if (settings.lockdown) {
    await deleteMessage(
      ctx,
      ctx.message.message_id
    );

    return;
  }

  const text = extractText(ctx.message);

  /*
  |--------------------------------------------------------------------------
  | Flood detection
  |--------------------------------------------------------------------------
  */

  if (
    await handleFlood(
      ctx,
      ctx.from.id
    )
  ) {
    await deleteMessage(
      ctx,
      ctx.message.message_id
    );

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Link protection
  |--------------------------------------------------------------------------
  */

  if (
    settings.antiLinks &&
    containsLink(text)
  ) {
    await deleteMessage(
      ctx,
      ctx.message.message_id
    );

    await warnUser(
      ctx,
      ctx.from.id,
      "Unauthorized link"
    );

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Blocked words
  |--------------------------------------------------------------------------
  */

  const blocked = containsBlockedWord(
    text,
    settings.blockedWords
  );

  if (blocked) {
    await deleteMessage(
      ctx,
      ctx.message.message_id
    );

    await warnUser(
      ctx,
      ctx.from.id,
      `Blocked content: ${blocked}`
    );

    return;
  }
});

/*
|--------------------------------------------------------------------------
| ERROR HANDLER
|--------------------------------------------------------------------------
*/

bot.catch((error, ctx) => {
  console.error(
    "BOT ERROR:",
    error,
    "UPDATE:",
    ctx.updateType
  );
});

/*
|--------------------------------------------------------------------------
| START BOT
|--------------------------------------------------------------------------
*/

async function main() {
  console.log("🍼 BABY Group Manager starting...");

  const botInfo = await bot.telegram.getMe();

  console.log(
    `Connected as @${botInfo.username}`
  );

  await bot.launch();

  console.log(
    "🟢 BABY Group Manager is running."
  );
}

main().catch(error => {
  console.error(
    "Fatal startup error:",
    error
  );

  process.exit(1);
});

process.once(
  "SIGINT",
  () => bot.stop("SIGINT")
);

process.once(
  "SIGTERM",
  () => bot.stop("SIGTERM")
);
