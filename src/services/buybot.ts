// src/services/buybot.ts

import { ethers } from "ethers";
import { prisma } from "../db.js";
import { config } from "../config.js";

type BotLike = {
  telegram?: {
    sendMessage?: (
      chatId: string | number,
      text: string,
      options?: Record<string, unknown>
    ) => Promise<unknown>;
  };
};

type BuyBotSettings = {
  enabled: boolean;
  minEth: number;
  whaleEth: number;
  showWallet: boolean;
  showUsd: boolean;
  showTx: boolean;
};

type TransferRecord = {
  txHash: string;
  blockNumber: number;
  buyer: string;
  amount: bigint;
  tokenAddress: string;
};

const DEFAULT_SETTINGS: BuyBotSettings = {
  enabled: false,
  minEth: 0.01,
  whaleEth: 1,
  showWallet: true,
  showUsd: true,
  showTx: true,
};

const ERC20_TRANSFER_TOPIC = ethers.id(
  "Transfer(address,address,uint256)"
);

let provider: ethers.JsonRpcProvider | null = null;
let watcherTimer: NodeJS.Timeout | null = null;
let watcherRunning = false;

let lastProcessedBlock: number | null = null;

const botRegistry = new Map<string, BotLike>();

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.robinhoodRpcUrl);
  }

  return provider;
}

function getTokenAddress(): string {
  return ethers.getAddress(config.babyTokenAddress);
}

function normalizeAddress(value: string): string {
  try {
    return ethers.getAddress(value);
  } catch {
    return value;
  }
}

function formatEth(value: bigint): string {
  const eth = Number(ethers.formatEther(value));

  if (!Number.isFinite(eth)) {
    return "0";
  }

  if (eth >= 1000) return eth.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

  if (eth >= 1) return eth.toFixed(2);
  if (eth >= 0.1) return eth.toFixed(3);
  if (eth >= 0.01) return eth.toFixed(4);

  return eth.toFixed(6);
}

function explorerTx(txHash: string): string {
  const base =
    process.env.ROBINHOOD_EXPLORER_URL ||
    "https://explorer.mainnet.chain.robinhood.com";

  return `${base.replace(/\/$/, "")}/tx/${txHash}`;
}

function explorerAddress(address: string): string {
  const base =
    process.env.ROBINHOOD_EXPLORER_URL ||
    "https://explorer.mainnet.chain.robinhood.com";

  return `${base.replace(/\/$/, "")}/address/${address}`;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getSettings(group: {
  buyBotEnabled?: boolean;
  buyBotMinEth?: number;
  buyBotWhaleEth?: number;
  buyBotShowWallet?: boolean;
  buyBotShowUsd?: boolean;
  buyBotShowTx?: boolean;
}): BuyBotSettings {
  return {
    enabled:
      typeof group.buyBotEnabled === "boolean"
        ? group.buyBotEnabled
        : DEFAULT_SETTINGS.enabled,

    minEth:
      typeof group.buyBotMinEth === "number"
        ? group.buyBotMinEth
        : DEFAULT_SETTINGS.minEth,

    whaleEth:
      typeof group.buyBotWhaleEth === "number"
        ? group.buyBotWhaleEth
        : DEFAULT_SETTINGS.whaleEth,

    showWallet:
      typeof group.buyBotShowWallet === "boolean"
        ? group.buyBotShowWallet
        : DEFAULT_SETTINGS.showWallet,

    showUsd:
      typeof group.buyBotShowUsd === "boolean"
        ? group.buyBotShowUsd
        : DEFAULT_SETTINGS.showUsd,

    showTx:
      typeof group.buyBotShowTx === "boolean"
        ? group.buyBotShowTx
        : DEFAULT_SETTINGS.showTx,
  };
}

/**
 * Initialize the buy bot.
 *
 * Safe to call multiple times.
 */
export async function initializeBuyBot(
  bot?: BotLike
): Promise<void> {
  if (bot) {
    botRegistry.set("default", bot);
  }

  try {
    const rpc = config.robinhoodRpcUrl;
    const token = config.babyTokenAddress;

    console.log("[BUYBOT] Initializing...");
    console.log(`[BUYBOT] RPC: ${rpc}`);
    console.log(`[BUYBOT] BABY: ${token}`);

    const network = await getProvider().getNetwork();

    console.log(
      `[BUYBOT] Connected chainId=${network.chainId.toString()}`
    );

    const block = await getProvider().getBlockNumber();

    lastProcessedBlock = block;

    console.log(
      `[BUYBOT] Current block=${block}`
    );
  } catch (error) {
    console.error("[BUYBOT] Initialization failed:", error);
  }
}

/**
 * Start blockchain watcher.
 */
export function startBuyBotWatcher(
  bot?: BotLike
): void {
  if (bot) {
    botRegistry.set("default", bot);
  }

  if (watcherRunning) {
    console.log("[BUYBOT] Watcher already running");
    return;
  }

  watcherRunning = true;

  console.log("[BUYBOT] Starting watcher...");

  watcherTimer = setInterval(
    async () => {
      try {
        await scanBuyTransactions();
      } catch (error) {
        console.error(
          "[BUYBOT] Watcher error:",
          error
        );
      }
    },
    3_000
  );

  void scanBuyTransactions();
}

/**
 * Stop blockchain watcher.
 */
export function stopBuyBotWatcher(): void {
  watcherRunning = false;

  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }

  console.log("[BUYBOT] Watcher stopped");
}

/**
 * Scan new blocks for BABY token Transfer events.
 */
async function scanBuyTransactions(): Promise<void> {
  if (!watcherRunning && lastProcessedBlock !== null) {
    return;
  }

  const rpc = getProvider();

  const currentBlock = await rpc.getBlockNumber();

  if (lastProcessedBlock === null) {
    lastProcessedBlock = currentBlock;
    return;
  }

  if (currentBlock <= lastProcessedBlock) {
    return;
  }

  const fromBlock = lastProcessedBlock + 1;

  // Keep RPC requests small.
  const toBlock = Math.min(
    currentBlock,
    fromBlock + 20
  );

  const tokenAddress = getTokenAddress();

  console.log(
    `[BUYBOT] Scanning blocks ${fromBlock}-${toBlock}`
  );

  try {
    const logs = await rpc.getLogs({
      address: tokenAddress,
      fromBlock,
      toBlock,
      topics: [ERC20_TRANSFER_TOPIC],
    });

    for (const log of logs) {
      await processTransferLog(
        log,
        tokenAddress
      );
    }
  } catch (error) {
    console.error(
      "[BUYBOT] getLogs failed:",
      error
    );

    return;
  }

  lastProcessedBlock = toBlock;
}

/**
 * Process an ERC20 Transfer event.
 *
 * Important:
 * Transfer events alone cannot prove a purchase.
 * This function therefore treats incoming BABY transfers
 * as candidate buys and requires the originating transaction
 * to also contain native ETH value.
 */
async function processTransferLog(
  log: ethers.Log,
  tokenAddress: string
): Promise<void> {
  if (!log.topics || log.topics.length < 3) {
    return;
  }

  if (!log.transactionHash) {
    return;
  }

  const from = normalizeAddress(
    ethers.dataSlice(log.topics[1], 12)
  );

  const to = normalizeAddress(
    ethers.dataSlice(log.topics[2], 12)
  );

  if (
    from === ethers.ZeroAddress ||
    to === ethers.ZeroAddress
  ) {
    return;
  }

  let amount: bigint;

  try {
    amount = BigInt(log.data);
  } catch {
    return;
  }

  if (amount <= 0n) {
    return;
  }

  const transaction =
    await getProvider().getTransaction(
      log.transactionHash
    );

  if (!transaction) {
    return;
  }

  /*
   * Candidate buy:
   *
   * The transaction must carry native ETH value.
   * This filters out most ordinary transfers.
   *
   * DEX routers can make this heuristic imperfect,
   * so this is intentionally labelled as a candidate.
   */
  if (
    !transaction.value ||
    transaction.value <= 0n
  ) {
    return;
  }

  const nativeAmount = transaction.value;

  const nativeEth = Number(
    ethers.formatEther(nativeAmount)
  );

  if (!Number.isFinite(nativeEth)) {
    return;
  }

  if (nativeEth <= 0) {
    return;
  }

  const record: TransferRecord = {
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    buyer: to,
    amount,
    tokenAddress,
  };

  await handleCandidateBuy(
    record,
    nativeAmount
  );
}

/**
 * Handle a candidate BABY purchase.
 */
async function handleCandidateBuy(
  record: TransferRecord,
  nativeAmount: bigint
): Promise<void> {
  const groups = await prisma.group.findMany({
    where: {
      buyBotEnabled: true,
    },
  });

  if (groups.length === 0) {
    return;
  }

  const nativeEth = Number(
    ethers.formatEther(nativeAmount)
  );

  if (!Number.isFinite(nativeEth)) {
    return;
  }

  for (const group of groups) {
    const settings = getSettings(group);

    if (!settings.enabled) {
      continue;
    }

    if (nativeEth < settings.minEth) {
      continue;
    }

    const existing =
      await prisma.groupEvent.findFirst({
        where: {
          groupId: group.id,
          type: "BUY_ALERT",
          payload: {
            contains: record.txHash,
          },
        },
      });

    if (existing) {
      continue;
    }

    const whale =
      nativeEth >= settings.whaleEth;

    const message = buildBuyMessage(
      record,
      nativeAmount,
      settings,
      whale
    );

    await prisma.groupEvent.create({
      data: {
        groupId: group.id,
        type: "BUY_ALERT",
        telegramId: record.buyer,
        payload: JSON.stringify({
          txHash: record.txHash,
          buyer: record.buyer,
          tokenAddress: record.tokenAddress,
          nativeAmount: nativeEth,
          tokenAmount: record.amount.toString(),
          blockNumber: record.blockNumber,
          whale,
        }),
      },
    });

    const bot = botRegistry.get("default");

    if (!bot?.telegram?.sendMessage) {
      console.warn(
        `[BUYBOT] No Telegram bot registered for group ${group.telegramId}`
      );
      continue;
    }

    try {
      await bot.telegram.sendMessage(
        group.telegramId,
        message,
        {
          disable_web_page_preview: true,
        }
      );
    } catch (error) {
      console.error(
        `[BUYBOT] Failed to send alert to ${group.telegramId}:`,
        error
      );
    }
  }
}

/**
 * Build Telegram buy alert.
 */
function buildBuyMessage(
  record: TransferRecord,
  nativeAmount: bigint,
  settings: BuyBotSettings,
  whale: boolean
): string {
  const nativeEth = formatEth(nativeAmount);

  const title = whale
    ? "🐋🍼 BIG BABY BUY!"
    : "🍼💚 BABY BUY!";

  const lines: string[] = [
    title,
    "",
    `💰 Buy: ${nativeEth} ETH`,
  ];

  if (settings.showWallet) {
    lines.push(
      `👤 Buyer: ${shortenAddress(record.buyer)}`
    );
  }

  lines.push(
    `🪙 BABY: ${formatTokenAmount(record.amount)}`,
    ""
  );

  if (settings.showTx) {
    lines.push(
      `🔗 TX: ${explorerTx(record.txHash)}`
    );
  }

  if (settings.showWallet) {
    lines.push(
      `👛 Wallet: ${explorerAddress(record.buyer)}`
    );
  }

  lines.push(
    "",
    "🍼 BABY is trading live on Robinhood Chain."
  );

  return lines.join("\n");
}

function formatTokenAmount(
  amount: bigint
): string {
  /*
   * BABY token decimals should normally be read from
   * the contract rather than hardcoded.
   *
   * Default to 18 here because most ERC20 tokens use 18.
   */
  try {
    const value = Number(
      ethers.formatUnits(amount, 18)
    );

    if (!Number.isFinite(value)) {
      return amount.toString();
    }

    return value.toLocaleString(
      undefined,
      {
        maximumFractionDigits: 2,
      }
    );
  } catch {
    return amount.toString();
  }
}

/**
 * Enable buy bot for a group.
 */
export async function enableBuyBot(
  groupId: string
): Promise<void> {
  await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      buyBotEnabled: true,
    },
  });
}

/**
 * Disable buy bot for a group.
 */
export async function disableBuyBot(
  groupId: string
): Promise<void> {
  await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      buyBotEnabled: false,
    },
  });
}

/**
 * Configure minimum buy amount.
 */
export async function setBuyBotMinEth(
  groupId: string,
  amount: number
): Promise<void> {
  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error(
      "Minimum ETH amount must be a valid positive number"
    );
  }

  await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      buyBotMinEth: amount,
    },
  });
}

/**
 * Configure whale threshold.
 */
export async function setBuyBotWhaleEth(
  groupId: string,
  amount: number
): Promise<void> {
  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Whale ETH amount must be greater than zero"
    );
  }

  await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      buyBotWhaleEth: amount,
    },
  });
}

/**
 * Toggle wallet display.
 */
export async function setBuyBotShowWallet(
  groupId: string,
  enabled: boolean
): Promise<void> {
  await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      buyBotShowWallet: enabled,
    },
  });
}

/**
 * Toggle USD display.
 */
export async function setBuyBotShowUsd(
  groupId: string,
  enabled: boolean
): Promise<void> {
  await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      buyBotShowUsd: enabled,
    },
  });
}

/**
 * Toggle transaction display.
 */
export async function setBuyBotShowTx(
  groupId: string,
  enabled: boolean
): Promise<void> {
  await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      buyBotShowTx: enabled,
    },
  });
}

/**
 * Get buy bot settings.
 */
export async function getBuyBotSettings(
  groupId: string
) {
  const group =
    await prisma.group.findUnique({
      where: {
        id: groupId,
      },
    });

  if (!group) {
    throw new Error("Group not found");
  }

  return getSettings(group);
}

/**
 * Get recent buy alerts from GroupEvent.
 */
export async function getRecentBuyAlerts(
  groupId: string,
  limit = 20
) {
  const safeLimit = Math.min(
    Math.max(limit, 1),
    100
  );

  return prisma.groupEvent.findMany({
    where: {
      groupId,
      type: "BUY_ALERT",
    },
    orderBy: {
      createdAt: "desc",
    },
    take: safeLimit,
  });
}

/**
 * Remove duplicate/stale alerts.
 */
export async function clearBuyBotAlerts(
  groupId: string
): Promise<number> {
  const result =
    await prisma.groupEvent.deleteMany({
      where: {
        groupId,
        type: "BUY_ALERT",
      },
    });

  return result.count;
}

/**
 * Health check.
 */
export async function buyBotHealth(): Promise<{
  running: boolean;
  rpc: boolean;
  block: number | null;
  token: string;
}> {
  let block: number | null = null;

  try {
    block =
      await getProvider().getBlockNumber();
  } catch {
    block = null;
  }

  return {
    running: watcherRunning,
    rpc: block !== null,
    block,
    token: getTokenAddress(),
  };
}
