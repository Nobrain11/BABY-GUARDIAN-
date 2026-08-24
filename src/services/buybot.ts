import { ethers } from "ethers";
import { prisma } from "../db.js";
import { config } from "../config.js";

type TelegramLike = {
  sendMessage: (
    chatId: string | number,
    text: string,
    options?: Record<string, unknown>
  ) => Promise<unknown>;
};

type BotLike = {
  telegram?: TelegramLike;
};

type TelegramOrBot = TelegramLike | BotLike;

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

const botRegistry = new Map<string, TelegramLike>();

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(
      config.robinhoodRpcUrl
    );
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

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatEth(value: bigint): string {
  const amount = Number(ethers.formatEther(value));

  if (!Number.isFinite(amount)) {
    return "0";
  }

  if (amount >= 1000) {
    return amount.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  }

  if (amount >= 1) {
    return amount.toFixed(2);
  }

  if (amount >= 0.1) {
    return amount.toFixed(3);
  }

  if (amount >= 0.01) {
    return amount.toFixed(4);
  }

  return amount.toFixed(6);
}

function formatTokenAmount(amount: bigint): string {
  try {
    const value = Number(
      ethers.formatUnits(amount, 18)
    );

    if (!Number.isFinite(value)) {
      return amount.toString();
    }

    return value.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  } catch {
    return amount.toString();
  }
}

function explorerBase(): string {
  return (
    process.env.ROBINHOOD_EXPLORER_URL ||
    "https://explorer.mainnet.chain.robinhood.com"
  ).replace(/\/$/, "");
}

function explorerTx(txHash: string): string {
  return `${explorerBase()}/tx/${txHash}`;
}

function explorerAddress(address: string): string {
  return `${explorerBase()}/address/${address}`;
}

function extractTelegram(
  bot: TelegramOrBot
): TelegramLike | undefined {
  if ("sendMessage" in bot) {
    return bot;
  }

  return bot.telegram;
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

export async function initializeBuyBot(
  bot?: TelegramOrBot
): Promise<void> {
  if (bot) {
    const telegram = extractTelegram(bot);

    if (telegram) {
      botRegistry.set("default", telegram);
    }
  }

  try {
    console.log("[BUYBOT] Initializing...");
    console.log(
      `[BUYBOT] RPC: ${config.robinhoodRpcUrl}`
    );
    console.log(
      `[BUYBOT] BABY: ${config.babyTokenAddress}`
    );

    const network =
      await getProvider().getNetwork();

    console.log(
      `[BUYBOT] Chain ID: ${network.chainId.toString()}`
    );

    const block =
      await getProvider().getBlockNumber();

    lastProcessedBlock = block;

    console.log(
      `[BUYBOT] Starting from block: ${block}`
    );
  } catch (error) {
    console.error(
      "[BUYBOT] Initialization failed:",
      error
    );
  }
}

export function startBuyBotWatcher(
  bot?: TelegramOrBot
): void {
  if (bot) {
    const telegram = extractTelegram(bot);

    if (telegram) {
      botRegistry.set("default", telegram);
    }
  }

  if (watcherRunning) {
    console.log(
      "[BUYBOT] Watcher already running"
    );
    return;
  }

  watcherRunning = true;

  console.log(
    "[BUYBOT] Blockchain watcher started"
  );

  watcherTimer = setInterval(() => {
    void scanBuyTransactions();
  }, 3000);

  void scanBuyTransactions();
}

export function stopBuyBotWatcher(): void {
  watcherRunning = false;

  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }

  console.log(
    "[BUYBOT] Blockchain watcher stopped"
  );
}

async function scanBuyTransactions(): Promise<void> {
  if (
    !watcherRunning &&
    lastProcessedBlock !== null
  ) {
    return;
  }

  const rpc = getProvider();

  let currentBlock: number;

  try {
    currentBlock =
      await rpc.getBlockNumber();
  } catch (error) {
    console.error(
      "[BUYBOT] Failed to get block:",
      error
    );
    return;
  }

  if (lastProcessedBlock === null) {
    lastProcessedBlock = currentBlock;
    return;
  }

  if (currentBlock <= lastProcessedBlock) {
    return;
  }

  const fromBlock =
    lastProcessedBlock + 1;

  const toBlock = Math.min(
    currentBlock,
    fromBlock + 20
  );

  const tokenAddress =
    getTokenAddress();

  try {
    const logs = await rpc.getLogs({
      address: tokenAddress,
      fromBlock,
      toBlock,
      topics: [ERC20_TRANSFER_TOPIC],
    });

    console.log(
      `[BUYBOT] Blocks ${fromBlock}-${toBlock}: ${logs.length} transfer events`
    );

    for (const log of logs) {
      await processTransferLog(
        log,
        tokenAddress
      );
    }

    lastProcessedBlock = toBlock;
  } catch (error) {
    console.error(
      "[BUYBOT] Failed scanning logs:",
      error
    );
  }
}

async function processTransferLog(
  log: ethers.Log,
  tokenAddress: string
): Promise<void> {
  if (
    !log.topics ||
    log.topics.length < 3
  ) {
    return;
  }

  if (!log.transactionHash) {
    return;
  }

  const fromTopic = log.topics[1];
  const toTopic = log.topics[2];

  if (!fromTopic || !toTopic) {
    return;
  }

  let from: string;
  let to: string;

  try {
    from = normalizeAddress(
      ethers.dataSlice(fromTopic, 12)
    );

    to = normalizeAddress(
      ethers.dataSlice(toTopic, 12)
    );
  } catch {
    return;
  }

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

  let transaction:
    | ethers.TransactionResponse
    | null;

  try {
    transaction =
      await getProvider().getTransaction(
        log.transactionHash
      );
  } catch {
    return;
  }

  if (!transaction) {
    return;
  }

  if (
    !transaction.value ||
    transaction.value <= 0n
  ) {
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
    transaction.value
  );
}

async function handleCandidateBuy(
  record: TransferRecord,
  nativeAmount: bigint
): Promise<void> {
  const groups =
    await prisma.group.findMany({
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

    const duplicate =
      await prisma.groupEvent.findFirst({
        where: {
          groupId: group.id,
          type: "BUY_ALERT",
          payload: {
            contains: record.txHash,
          },
        },
      });

    if (duplicate) {
      continue;
    }

    const whale =
      nativeEth >= settings.whaleEth;

    const message =
      buildBuyMessage(
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
          tokenAddress:
            record.tokenAddress,
          nativeAmount: nativeEth,
          tokenAmount:
            record.amount.toString(),
          blockNumber:
            record.blockNumber,
          whale,
        }),
      },
    });

    const telegram =
      botRegistry.get("default");

    if (!telegram) {
      console.warn(
        "[BUYBOT] Telegram instance not registered"
      );
      continue;
    }

    try {
      await telegram.sendMessage(
        group.telegramId,
        message,
        {
          disable_web_page_preview: true,
        }
      );
    } catch (error) {
      console.error(
        `[BUYBOT] Telegram send failed for ${group.telegramId}:`,
        error
      );
    }
  }
}

function buildBuyMessage(
  record: TransferRecord,
  nativeAmount: bigint,
  settings: BuyBotSettings,
  whale: boolean
): string {
  const title = whale
    ? "🐋🍼 BIG BABY BUY!"
    : "🍼💚 BABY BUY!";

  const lines: string[] = [
    title,
    "",
    `💰 Buy: ${formatEth(nativeAmount)} ETH`,
    `🪙 BABY: ${formatTokenAmount(record.amount)}`,
  ];

  if (settings.showWallet) {
    lines.push(
      `👤 Buyer: ${shortenAddress(record.buyer)}`
    );
  }

  lines.push("");

  if (settings.showTx) {
    lines.push(
      `🔗 Transaction: ${explorerTx(record.txHash)}`
    );
  }

  if (settings.showWallet) {
    lines.push(
      `👛 Wallet: ${explorerAddress(record.buyer)}`
    );
  }

  lines.push(
    "",
    "🍼 $BABY is trading live on Robinhood Chain."
  );

  return lines.join("\n");
}

export async function enableBuyBot(
  groupId: string
): Promise<void> {
  await prisma.group.update({
    where: { id: groupId },
    data: {
      buyBotEnabled: true,
    },
  });
}

export async function disableBuyBot(
  groupId: string
): Promise<void> {
  await prisma.group.update({
    where: { id: groupId },
    data: {
      buyBotEnabled: false,
    },
  });
}

export async function setBuyBotMinEth(
  groupId: string,
  amount: number
): Promise<void> {
  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error(
      "Invalid minimum ETH amount"
    );
  }

  await prisma.group.update({
    where: { id: groupId },
    data: {
      buyBotMinEth: amount,
    },
  });
}

export async function setBuyBotWhaleEth(
  groupId: string,
  amount: number
): Promise<void> {
  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Invalid whale threshold"
    );
  }

  await prisma.group.update({
    where: { id: groupId },
    data: {
      buyBotWhaleEth: amount,
    },
  });
}

export async function setBuyBotShowWallet(
  groupId: string,
  enabled: boolean
): Promise<void> {
  await prisma.group.update({
    where: { id: groupId },
    data: {
      buyBotShowWallet: enabled,
    },
  });
}

export async function setBuyBotShowUsd(
  groupId: string,
  enabled: boolean
): Promise<void> {
  await prisma.group.update({
    where: { id: groupId },
    data: {
      buyBotShowUsd: enabled,
    },
  });
}

export async function setBuyBotShowTx(
  groupId: string,
  enabled: boolean
): Promise<void> {
  await prisma.group.update({
    where: { id: groupId },
    data: {
      buyBotShowTx: enabled,
    },
  });
}

export async function getBuyBotSettings(
  groupId: string
) {
  const group =
    await prisma.group.findUnique({
      where: { id: groupId },
    });

  if (!group) {
    throw new Error("Group not found");
  }

  return getSettings(group);
}

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
