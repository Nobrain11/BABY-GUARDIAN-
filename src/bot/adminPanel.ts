import { Markup, Telegraf } from "telegraf";
import { prisma } from "../db.js";
import { isAdmin } from "../services/moderation.js";

export function registerAdminPanel(bot: Telegraf) {
  bot.command("panel", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;

    const admin = await isAdmin(
      bot,
      ctx.chat.id,
      ctx.from.id
    );

    if (!admin) {
      await ctx.reply(
        "⛔ Administrator permission required."
      );
      return;
    }

    await sendPanel(ctx);
  });

  bot.action("baby:panel", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;

    const admin = await isAdmin(
      bot,
      ctx.chat.id,
      ctx.from.id
    );

    if (!admin) {
      await ctx.answerCbQuery(
        "Administrator only.",
        { show_alert: true }
      );
      return;
    }

    await ctx.answerCbQuery();
    await sendPanel(ctx);
  });

  bot.action(
    /^baby:toggle:(.+)$/,
    async (ctx) => {
      if (!ctx.chat || !ctx.from) return;

      const admin = await isAdmin(
        bot,
        ctx.chat.id,
        ctx.from.id
      );

      if (!admin) {
        await ctx.answerCbQuery(
          "Administrator only.",
          { show_alert: true }
        );
        return;
      }

      const setting = ctx.match[1];

      const group =
        await prisma.group.findUnique({
          where: {
            telegramId:
              String(ctx.chat.id)
          }
        });

      if (!group) {
        await ctx.answerCbQuery(
          "Group not configured."
        );
        return;
      }

      const fields = [
        "welcomeEnabled",
        "antiSpamEnabled",
        "antiLinksEnabled",
        "antiRaidEnabled",
        "lockdown"
      ] as const;

      if (
        !fields.includes(
          setting as typeof fields[number]
        )
      ) {
        await ctx.answerCbQuery(
          "Invalid setting."
        );
        return;
      }

      const field =
        setting as typeof fields[number];

      await prisma.group.update({
        where: {
          id: group.id
        },

        data: {
          [field]: !group[field]
        }
      });

      await ctx.answerCbQuery(
        `${setting} updated`
      );

      await sendPanel(ctx);
    }
  );

  bot.action(
    "baby:stats",
    async (ctx) => {
      if (!ctx.chat || !ctx.from) return;

      const admin = await isAdmin(
        bot,
        ctx.chat.id,
        ctx.from.id
      );

      if (!admin) {
        await ctx.answerCbQuery(
          "Administrator only.",
          { show_alert: true }
        );
        return;
      }

      const group =
        await prisma.group.findUnique({
          where: {
            telegramId:
              String(ctx.chat.id)
          }
        });

      if (!group) return;

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

      await ctx.answerCbQuery();

      await ctx.editMessageText(
        [
          "📊 BABY GROUP STATISTICS",
          "",
          `👥 Members: ${members}`,
          `💬 Messages: ${
            messages._sum.messages || 0
          }`,
          `⚠️ Warnings: ${warnings}`,
          "",
          "Use the button below to return."
        ].join("\n"),

        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "⬅️ Back",
              "baby:panel"
            )
          ]
        ])
      );
    }
  );
}

async function sendPanel(ctx: any) {
  const group =
    await prisma.group.findUnique({
      where: {
        telegramId:
          String(ctx.chat.id)
      }
    });

  if (!group) {
    await ctx.reply(
      "❌ This group hasn't been initialized yet."
    );
    return;
  }

  const text = [
    "🍼💚 BABY GROUP MANAGER",
    "",
    "⚙️ ADMIN CONTROL PANEL",
    "",
    `👋 Welcome: ${status(group.welcomeEnabled)}`,
    `🛡 Anti-spam: ${status(group.antiSpamEnabled)}`,
    `🔗 Anti-links: ${status(group.antiLinksEnabled)}`,
    `🚨 Anti-raid: ${status(group.antiRaidEnabled)}`,
    `🔒 Lockdown: ${status(group.lockdown)}`,
    "",
    `🌊 Flood limit: ${group.maxMessages}`,
    `⏱ Flood window: ${group.floodWindowSec}s`,
    `⚠️ Warning limit: ${group.maxWarnings}`
  ].join("\n");

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `👋 Welcome ${group.welcomeEnabled ? "ON" : "OFF"}`,
        "baby:toggle:welcomeEnabled"
      )
    ],

    [
      Markup.button.callback(
        `🛡 Anti-spam ${group.antiSpamEnabled ? "ON" : "OFF"}`,
        "baby:toggle:antiSpamEnabled"
      )
    ],

    [
      Markup.button.callback(
        `🔗 Anti-links ${group.antiLinksEnabled ? "ON" : "OFF"}`,
        "baby:toggle:antiLinksEnabled"
      )
    ],

    [
      Markup.button.callback(
        `🚨 Anti-raid ${group.antiRaidEnabled ? "ON" : "OFF"}`,
        "baby:toggle:antiRaidEnabled"
      )
    ],

    [
      Markup.button.callback(
        `🔒 Lockdown ${group.lockdown ? "ON" : "OFF"}`,
        "baby:toggle:lockdown"
      )
    ],

    [
      Markup.button.callback(
        "📊 Statistics",
        "baby:stats"
      )
    ],

    [
      Markup.button.callback(
        "🔄 Refresh",
        "baby:panel"
      )
    ]
  ]);

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(
        text,
        keyboard
      );
    } catch {
      await ctx.reply(
        text,
        keyboard
      );
    }
  } else {
    await ctx.reply(
      text,
      keyboard
    );
  }
}

function status(
  enabled: boolean
) {
  return enabled
    ? "🟢 ON"
    : "🔴 OFF";
}
