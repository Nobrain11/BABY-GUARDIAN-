import {
  Contract,
  JsonRpcProvider,
  Interface,
  Log,
  formatUnits
} from "ethers";

import {
  config
} from "../config.js";

import {
  prisma
} from "../db.js";

import type {
  Telegram
} from "telegraf";

const RPC_URL =
  process.env.RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

const CHAIN_ID =
  Number(
    process.env.CHAIN_ID || 4663
  );

const BABY_ADDRESS =
  process.env.BABY_CONTRACT_ADDRESS ||
  "0x9f4A9C70d10F4Fa88d9db84AFdc6B8b44f3E81a1";

const provider =
  new JsonRpcProvider(
    RPC_URL,
    {
      chainId: CHAIN_ID,
      name: "Robinhood Chain"
    }
  );

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

const token =
  new Contract(
    BABY_ADDRESS,
    ERC20_ABI,
    provider
  );

/*
|--------------------------------------------------------------------------
| STATE
|--------------------------------------------------------------------------
*/

let running = false;

let timer:
  ReturnType<typeof setInterval> |
  undefined;

let lastBlock = 0;

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const MIN_BUY =
  Number(
    process.env.BUY_BOT_MIN_ETH || 0.1
  );

const WHALE_BUY =
  Number(
    process.env.BUY_BOT_WHALE_ETH || 2
  );

const CONFIRMATIONS =
  Number(
    process.env.BUY_BOT_CONFIRMATIONS || 1
  );

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function getTelegramGroupId(
  telegramId: string
): number | null {
  const value =
    Number(telegramId);

  if (
    !Number.isSafeInteger(value)
  ) {
    return null;
  }

  return value;
}

async function getTokenMetadata() {
  let symbol = "BABY";
  let decimals = 18;

  try {
    const symbolFunction =
      token.getFunction("symbol");

    if (symbolFunction) {
      const result =
        await symbolFunction();

      if (
        typeof result === "string" &&
        result.length > 0
      ) {
        symbol = result;
      }
    }
  } catch (error) {
    console.error(
      "Unable to read token symbol:",
      error
    );
  }

  try {
    const decimalsFunction =
      token.getFunction("decimals");

    if (decimalsFunction) {
      const result =
        await decimalsFunction();

      decimals =
        Number(result);
    }
  } catch (error) {
    console.error(
      "Unable to read token decimals:",
      error
    );
  }

  return {
    symbol,
    decimals
  };
}

/*
|--------------------------------------------------------------------------
| LOG PARSER
|--------------------------------------------------------------------------
*/

function parseLog(
  log: Log
) {
  /*
   * We deliberately use Interface.parseLog()
   * instead of assuming `log.args` exists.
   *
   * In ethers v6:
   * Log does NOT have args.
   * EventLog may have args.
   */

  const iface =
    new Interface([
      "event Transfer(address indexed from,address indexed to,uint256 value)"
    ]);

  try {
    const parsed =
      iface.parseLog({
        topics: log.topics,
        data: log.data
      });

    if (!parsed) {
      return null;
    }

    if (
      parsed.name !==
      "Transfer"
    ) {
      return null;
    }

    const from =
      String(
        parsed.args[0]
      );

    const to =
      String(
        parsed.args[1]
      );

    const value =
      parsed.args[2];

    return {
      from,
      to,
      value
    };
  } catch {
    return null;
  }
}

/*
|--------------------------------------------------------------------------
| GROUPS
|--------------------------------------------------------------------------
*/

async function getEnabledGroups() {
  return prisma.group.findMany({
    where: {
      buyBotEnabled: true
    }
  });
}

/*
|--------------------------------------------------------------------------
| SEND BUY ALERT
|--------------------------------------------------------------------------
*/

async function sendBuyAlert(
  telegram: Telegram,
  group: {
    id: string;
    telegramId: string;
    buyBotMinEth: number;
    buyBotWhaleEth: number;
    buyBotShowWallet: boolean;
    buyBotShowUsd: boolean;
    buyBotShowTx: boolean;
    buyBotShowTokenAmount: boolean;
    buyBotShowNativeAmount: boolean;
  },
  buyer: string,
  tokenAmount: bigint,
  nativeAmount: number,
  txHash: string,
  blockNumber: bigint
) {
  if (
    nativeAmount <
    group.buyBotMinEth
  ) {
    return;
  }

  const isWhale =
    nativeAmount >=
    group.buyBotWhaleEth;

  const metadata =
    await getTokenMetadata();

  const tokenDisplay =
    formatUnits(
      tokenAmount,
      metadata.decimals
    );

  /*
   * Prevent duplicate alerts.
   */

  const existing =
    await prisma.buyAlert.findUnique({
      where: {
        groupId_txHash: {
          groupId: group.id,
          txHash
        }
      }
    });

  if (existing) {
    return;
  }

  const alert =
    await prisma.buyAlert.create({
      data: {
        groupId: group.id,
        txHash,
        blockNumber,
        buyer,
        tokenAmount:
          tokenDisplay,
        nativeAmount:
          nativeAmount.toString(),
        isWhale,
        confirmed:
          CONFIRMATIONS <= 1,
        confirmedAt:
          CONFIRMATIONS <= 1
            ? new Date()
            : null
      }
    });

  const lines: string[] = [];

  if (isWhale) {
    lines.push(
      "🐋🍼💚 BABY WHALE BUY"
    );
  } else {
    lines.push(
      "🍼💚 BABY BUY"
    );
  }

  lines.push("");
  lines.push(
    `💰 Buy: ${nativeAmount.toFixed(4)} ETH`
  );

  if (
    group.buyBotShowTokenAmount
  ) {
    lines.push(
      `🍼 Received: ${tokenDisplay} ${metadata.symbol}`
    );
  }

  if (
    group.buyBotShowWallet
  ) {
    lines.push(
      `👛 Buyer: ${buyer}`
    );
  }

  if (
    group.buyBotShowTx
  ) {
    lines.push(
      `🔗 TX: https://robinhoodchain.blockscout.com/tx/${txHash}`
    );
  }

  lines.push("");
  lines.push(
    "🍼 BABY is growing."
  );

  const chatId =
    getTelegramGroupId(
      group.telegramId
    );

  if (chatId === null) {
    console.error(
      "Invalid Telegram group ID:",
      group.telegramId
    );

    return;
  }

  try {
    const message =
      await telegram.sendMessage(
        chatId,
        lines.join("\n")
      );

    await prisma.buyAlert.update({
      where: {
        id: alert.id
      },
      data: {
        telegramMessageId:
          message.message_id
      }
    });
  } catch (error) {
    console.error(
      `Unable to send Buy Bot alert to ${group.telegramId}:`,
      error
    );
  }
}

/*
|--------------------------------------------------------------------------
| PROCESS BLOCK
|--------------------------------------------------------------------------
*/

async function processBlock(
  blockNumber: number,
  telegram: Telegram
) {
  const groups =
    await getEnabledGroups();

  if (
    groups.length === 0
  ) {
    return;
  }

  const logs =
    await provider.getLogs({
      address:
        BABY_ADDRESS,
      fromBlock:
        blockNumber,
      toBlock:
        blockNumber
    });

  for (
    const log
    of logs
  ) {
    /*
     * Only standard ethers Log is
     * expected here.
     */

    const parsed =
      parseLog(log);

    if (!parsed) {
      continue;
    }

    /*
     * A normal Transfer event does NOT
     * automatically mean a BUY.
     *
     * This is deliberately kept conservative.
     *
     * We need the actual BABY pool address
     * and Swap event before classifying
     * transfers as purchases.
     */

    const buyer =
      parsed.to;

    const tokenAmount =
      parsed.value;

    /*
     * We currently cannot determine the
     * actual ETH spent from a Transfer event.
     *
     * Therefore don't generate a fake buy.
     */

    console.log(
      "BABY Transfer detected:",
      {
        txHash: log.transactionHash,
        buyer,
        tokenAmount:
          tokenAmount.toString()
      }
    );
  }
}

/*
|--------------------------------------------------------------------------
| WATCHER
|--------------------------------------------------------------------------
*/

export async function initializeBuyBot() {
  console.log(
    "🍼 Initializing BABY Buy Bot..."
  );

  try {
    lastBlock =
      await provider.getBlockNumber();

    const network =
      await provider.getNetwork();

    console.log(
      "🍼 Buy Bot network:",
      {
        chainId:
          network.chainId.toString(),
        block:
          lastBlock,
        contract:
          BABY_ADDRESS
      }
    );

    const metadata =
      await getTokenMetadata();

    console.log(
      "🍼 Token:",
      metadata
    );
  } catch (error) {
    console.error(
      "Buy Bot initialization failed:",
      error
    );

    throw error;
  }
}

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

export function startBuyBotWatcher(
  telegram: Telegram
) {
  if (running) {
    console.log(
      "🍼 Buy Bot watcher already running"
    );

    return;
  }

  running = true;

  console.log(
    "🍼💚 Starting BABY blockchain watcher..."
  );

  timer =
    setInterval(
      async () => {
        if (!running) {
          return;
        }

        try {
          const currentBlock =
            await provider.getBlockNumber();

          if (
            currentBlock <=
            lastBlock
          ) {
            return;
          }

          const start =
            lastBlock + 1;

          for (
            let block = start;
            block <= currentBlock;
            block++
          ) {
            await processBlock(
              block,
              telegram
            );
          }

          lastBlock =
            currentBlock;
        } catch (error) {
          console.error(
            "Buy Bot watcher error:",
            error
          );
        }
      },
      3000
    );
}

/*
|--------------------------------------------------------------------------
| STOP
|--------------------------------------------------------------------------
*/

export function stopBuyBotWatcher() {
  running = false;

  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }

  console.log(
    "🛑 BABY Buy Bot watcher stopped"
  );
}

/*
|--------------------------------------------------------------------------
| TELEGRAM COMMAND REGISTRATION
|--------------------------------------------------------------------------
*/

export function registerBuyBot(
  bot: any
) {
  /*
   * /buybot
   */

  bot.command(
    "buybot",
    async (ctx: any) => {
      if (!ctx.chat) {
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
          "🍼 This group has not been initialized yet."
        );

        return;
      }

      await ctx.reply(
        [
          "🍼💚 BABY BUY BOT",
          "",
          `Status: ${group.buyBotEnabled ? "🟢 ON" : "🔴 OFF"}`,
          `Minimum buy: ${group.buyBotMinEth} ETH`,
          `Whale threshold: ${group.buyBotWhaleEth} ETH`,
          "",
          "Admin commands:",
          "/buybot_on",
          "/buybot_off",
          "/buybot_min 0.1",
          "/buybot_whale 2"
        ].join("\n")
      );
    }
  );

  /*
   * Enable
   */

  bot.command(
    "buybot_on",
    async (ctx: any) => {
      if (!ctx.chat) {
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
        return;
      }

      await prisma.group.update({
        where: {
          id: group.id
        },
        data: {
          buyBotEnabled:
            true
        }
      });

      await ctx.reply(
        "🍼💚 BABY Buy Bot enabled."
      );
    }
  );

  /*
   * Disable
   */

  bot.command(
    "buybot_off",
    async (ctx: any) => {
      if (!ctx.chat) {
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
        return;
      }

      await prisma.group.update({
        where: {
          id: group.id
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

  /*
   * Minimum buy
   */

  bot.command(
    "buybot_min",
    async (ctx: any) => {
      if (!ctx.chat) {
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
          "Usage:\n/buybot_min 0.1"
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
        return;
      }

      await prisma.group.update({
        where: {
          id: group.id
        },
        data: {
          buyBotMinEth:
            value
        }
      });

      await ctx.reply(
        `✅ Minimum Buy Bot alert set to ${value} ETH.`
      );
    }
  );

  /*
   * Whale threshold
   */

  bot.command(
    "buybot_whale",
    async (ctx: any) => {
      if (!ctx.chat) {
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
          "Usage:\n/buybot_whale 2"
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
        return;
      }

      await prisma.group.update({
        where: {
          id: group.id
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
