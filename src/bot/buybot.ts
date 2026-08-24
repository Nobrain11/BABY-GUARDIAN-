import {
  Telegraf
} from "telegraf";

import {
  prisma
} from "../db.js";

import {
  isAdmin
} from "../services/moderation.js";

export function registerBuyBot(
  bot: Telegraf
) {
  bot.command(
    "buybot",
    async (ctx) => {
      if (
        !ctx.chat ||
        !ctx.from
      ) {
        return;
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

        return;
      }

      const group =
        await prisma.group.findUnique({
          where: {
            telegramId:
              String(ctx.chat.id)
          }
        });

      if (!group) {
        await ctx.reply(
          "❌ Group has not been initialized yet."
        );

        return;
      }

      await ctx.reply(
        [
          "🍼💚 BABY BUY BOT",
          "",
          `Status: ${group.buyBotEnabled ? "🟢 ACTIVE" : "🔴 OFF"}`,
          `Minimum Buy: ${group.buyBotMinEth} ETH`,
          `Whale Threshold: ${group.buyBotWhaleEth} ETH`,
          `Show Wallet: ${group.buyBotShowWallet ? "ON" : "OFF"}`,
          `Show USD: ${group.buyBotShowUsd ? "ON" : "OFF"}`,
          `Show TX: ${group.buyBotShowTx ? "ON" : "OFF"}`,
          "",
          "Commands:",
          "/buybot_on",
          "/buybot_off",
          "/buybot_min 0.1",
          "/buybot_whale 2"
        ].join("\n")
      );
    }
  );

  bot.command(
    "buybot_on",
    async (ctx) => {
      if (
        !ctx.chat ||
        !ctx.from
      ) {
        return;
      }

      if (
        !(await isAdmin(
          bot,
          ctx.chat.id,
          ctx.from.id
        ))
      ) {
        return;
      }

      await prisma.group.update({
        where: {
          telegramId:
            String(ctx.chat.id)
        },
        data: {
          buyBotEnabled:
            true
        }
      });

      await ctx.reply(
        "🟢 BABY Buy Bot enabled."
      );
    }
  );

  bot.command(
    "buybot_off",
    async (ctx) => {
      if (
        !ctx.chat ||
        !ctx.from
      ) {
        return;
      }

      if (
        !(await isAdmin(
          bot,
          ctx.chat.id,
          ctx.from.id
        ))
      ) {
        return;
      }

      await prisma.group.update({
        where: {
          telegramId:
            String(ctx.chat.id)
        },
        data: {
          buyBotEnabled:
            false
        }
      });

      await ctx.reply(
        "🔴 BABY Buy Bot disabled."
      );
    }
  );

  bot.command(
    "buybot_min",
    async (ctx) => {
      if (
        !ctx.chat ||
        !ctx.from
      ) {
        return;
      }

      if (
        !(await isAdmin(
          bot,
          ctx.chat.id,
          ctx.from.id
        ))
      ) {
        return;
      }

      const value =
        Number(
          ctx.message.text
            .split(/\s+/)[1]
        );

      if (
        !Number.isFinite(value) ||
        value <= 0
      ) {
        await ctx.reply(
          "Usage: /buybot_min 0.1"
        );

        return;
      }

      await prisma.group.update({
        where: {
          telegramId:
            String(ctx.chat.id)
        },
        data: {
          buyBotMinEth:
            value
        }
      });

      await ctx.reply(
        `✅ Minimum buy set to ${value} ETH.`
      );
    }
  );

  bot.command(
    "buybot_whale",
    async (ctx) => {
      if (
        !ctx.chat ||
        !ctx.from
      ) {
        return;
      }

      if (
        !(await isAdmin(
          bot,
          ctx.chat.id,
          ctx.from.id
        ))
      ) {
        return;
      }

      const value =
        Number(
          ctx.message.text
            .split(/\s+/)[1]
        );

      if (
        !Number.isFinite(value) ||
        value <= 0
      ) {
        await ctx.reply(
          "Usage: /buybot_whale 2"
        );

        return;
      }

      await prisma.group.update({
        where: {
          telegramId:
            String(ctx.chat.id)
        },
        data: {
          buyBotWhaleEth:
            value
        }
      });

      await ctx.reply(
        `🐋 Whale threshold set to ${value} ETH.`
      );
    }
  );
}
