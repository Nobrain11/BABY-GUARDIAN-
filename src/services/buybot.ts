import { ethers } from "ethers";
import { prisma } from "../db.js";
import { config } from "../config.js";

const provider = new ethers.JsonRpcProvider(config.robinhoodRpcUrl);

const BUY_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

type BuyBotSettings = {
  buyBotEnabled: boolean;
  buyBotMinEth: number;
  buyBotWhaleEth: number;
  buyBotShowWallet: boolean;
  buyBotShowUsd: boolean;
  buyBotShowTx: boolean;
};

type BuyAlertData = {
  groupId: string;
  txHash: string;
  buyer: string;
  tokenAddress: string;
  nativeAmount: number;
  tokenAmount?: string;
  usdValue?: number;
  tokenSymbol?: string;
  tokenName?: string;
  blockNumber?: bigint;
  telegramMessageId?: number;
  isWhale?: boolean;
};

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function formatEth(value: number): string {
  if (!Number.isFinite(value)) return "0";

  if (value >= 1000) {
    return value.toLocaleString("en-US", {
      maximumFractionDigits: 2
    });
  }

  if (value >= 1) {
    return value.toLocaleString("en-US", {
      maximumFractionDigits: 4
    });
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortenAddress(address: string): string {
  if (address.length < 12) return address;

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getExplorerTxUrl(txHash: string): string {
  const base =
    process.env.ROBINHOOD_EXPLORER_URL ||
    "https://explorer.mainnet.chain.robinhood.com";

  return `${base.replace(/\/$/, "")}/tx/${txHash}`;
}

function getExplorerAddressUrl(address: string): string {
  const base =
    process.env.ROBINHOOD_EXPLORER_URL ||
    "https://explorer.mainnet.chain.robinhood.com";

  return `${base.replace(/\/$/, "")}/address/${address}`;
}

export async function getBuyBotSettings(
  groupId: string
): Promise<BuyBotSettings | null> {
  const group = await prisma.group.findUnique({
    where: {
      id: groupId
    },
    select: {
      buyBotEnabled: true,
      buyBotMinEth: true,
      buyBotWhaleEth: true,
      buyBotShowWallet: true,
      buyBotShowUsd: true,
      buyBotShowTx: true
    }
  });

  return group;
}

export async function updateBuyBotSettings(
  groupId: string,
  settings: Partial<BuyBotSettings>
) {
  return prisma.group.update({
    where: {
      id: groupId
    },
    data: {
      ...(settings.buyBotEnabled !== undefined && {
        buyBotEnabled: settings.buyBotEnabled
      }),

      ...(settings.buyBotMinEth !== undefined && {
        buyBotMinEth: Number(settings.buyBotMinEth)
      }),

      ...(settings.buyBotWhaleEth !== undefined && {
        buyBotWhaleEth: Number(settings.buyBotWhaleEth)
      }),

      ...(settings.buyBotShowWallet !== undefined && {
        buyBotShowWallet: settings.buyBotShowWallet
      }),

      ...(settings.buyBotShowUsd !== undefined && {
        buyBotShowUsd: settings.buyBotShowUsd
      }),

      ...(settings.buyBotShowTx !== undefined && {
        buyBotShowTx: settings.buyBotShowTx
      })
    }
  });
}

export async function enableBuyBot(groupId: string) {
  return updateBuyBotSettings(groupId, {
    buyBotEnabled: true
  });
}

export async function disableBuyBot(groupId: string) {
  return updateBuyBotSettings(groupId, {
    buyBotEnabled: false
  });
}

export async function setBuyBotMinimum(
  groupId: string,
  amount: number
) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Invalid minimum buy amount");
  }

  return updateBuyBotSettings(groupId, {
    buyBotMinEth: amount
  });
}

export async function setBuyBotWhaleThreshold(
  groupId: string,
  amount: number
) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Invalid whale threshold");
  }

  return updateBuyBotSettings(groupId, {
    buyBotWhaleEth: amount
  });
}

export async function saveBuyAlert(data: BuyAlertData) {
  return prisma.buyAlert.upsert({
    where: {
      groupId_txHash: {
        groupId: data.groupId,
        txHash: data.txHash
      }
    },

    create: {
      groupId: data.groupId,
      txHash: data.txHash,
      buyer: data.buyer,
      tokenAddress: data.tokenAddress,

      // IMPORTANT:
      // Prisma schema uses Float, so this MUST be a number.
      nativeAmount: Number(data.nativeAmount),

      tokenAmount: data.tokenAmount,
      usdValue:
        data.usdValue !== undefined
          ? Number(data.usdValue)
          : undefined,

      tokenSymbol: data.tokenSymbol,
      tokenName: data.tokenName,

      blockNumber: data.blockNumber,

      telegramMessageId: data.telegramMessageId,

      isWhale: data.isWhale ?? false
    },

    update: {
      buyer: data.buyer,
      tokenAddress: data.tokenAddress,

      nativeAmount: Number(data.nativeAmount),

      tokenAmount: data.tokenAmount,

      usdValue:
        data.usdValue !== undefined
          ? Number(data.usdValue)
          : undefined,

      tokenSymbol: data.tokenSymbol,
      tokenName: data.tokenName,

      blockNumber: data.blockNumber,

      telegramMessageId: data.telegramMessageId,

      isWhale: data.isWhale ?? false
    }
  });
}

export async function findBuyAlert(
  groupId: string,
  txHash: string
) {
  return prisma.buyAlert.findUnique({
    where: {
      groupId_txHash: {
        groupId,
        txHash
      }
    }
  });
}

export async function deleteBuyAlert(
  groupId: string,
  txHash: string
) {
  return prisma.buyAlert.deleteMany({
    where: {
      groupId,
      txHash
    }
  });
}

export async function getRecentBuyAlerts(
  groupId: string,
  limit = 20
) {
  return prisma.buyAlert.findMany({
    where: {
      groupId
    },
    orderBy: {
      timestamp: "desc"
    },
    take: Math.min(Math.max(limit, 1), 100)
  });
}

export async function getRecentWhaleBuys(
  groupId: string,
  limit = 20
) {
  return prisma.buyAlert.findMany({
    where: {
      groupId,
      isWhale: true
    },
    orderBy: {
      timestamp: "desc"
    },
    take: Math.min(Math.max(limit, 1), 100)
  });
}

export async function getBuyStats(groupId: string) {
  const alerts = await prisma.buyAlert.findMany({
    where: {
      groupId
    },
    select: {
      nativeAmount: true,
      isWhale: true
    }
  });

  let totalVolume = 0;
  let whaleVolume = 0;
  let whaleCount = 0;

  for (const alert of alerts) {
    const amount = Number(alert.nativeAmount);

    if (!Number.isFinite(amount)) continue;

    totalVolume += amount;

    if (alert.isWhale) {
      whaleVolume += amount;
      whaleCount++;
    }
  }

  return {
    totalBuys: alerts.length,
    totalVolume,
    whaleVolume,
    whaleCount
  };
}

export function isWhaleBuy(
  nativeAmount: number,
  whaleThreshold: number
): boolean {
  return (
    Number.isFinite(nativeAmount) &&
    Number.isFinite(whaleThreshold) &&
    nativeAmount >= whaleThreshold
  );
}

export function meetsMinimumBuy(
  nativeAmount: number,
  minimum: number
): boolean {
  return (
    Number.isFinite(nativeAmount) &&
    Number.isFinite(minimum) &&
    nativeAmount >= minimum
  );
}

export function buildBuyAlertMessage(
  alert: BuyAlertData,
  settings: BuyBotSettings
): string {
  const whale = Boolean(
    alert.isWhale ??
      isWhaleBuy(
        Number(alert.nativeAmount),
        Number(settings.buyBotWhaleEth)
      )
  );

  const emoji = whale ? "🐋" : "🟢";

  const amount = Number(alert.nativeAmount);

  let message = `${emoji} <b>${whale ? "WHALE BUY" : "BUY ALERT"}</b>\n\n`;

  message += `🍼 <b>${
    escapeHtml(alert.tokenSymbol || "BABY")
  }</b>`;

  if (alert.tokenName) {
    message += ` — ${escapeHtml(alert.tokenName)}`;
  }

  message += "\n\n";

  message += `💰 Buy: <b>${formatEth(amount)} ETH</b>\n`;

  if (
    settings.buyBotShowUsd &&
    alert.usdValue !== undefined &&
    Number.isFinite(Number(alert.usdValue))
  ) {
    message += `💵 Value: <b>$${Number(alert.usdValue).toLocaleString(
      "en-US",
      {
        maximumFractionDigits: 2
      }
    )}</b>\n`;
  }

  if (settings.buyBotShowWallet) {
    message += `👛 Buyer: <a href="${getExplorerAddressUrl(
      alert.buyer
    )}">${escapeHtml(shortenAddress(alert.buyer))}</a>\n`;
  }

  message += `🪙 Token: <code>${escapeHtml(
    alert.tokenAddress
  )}</code>\n`;

  if (settings.buyBotShowTx) {
    message += `\n🔗 <a href="${getExplorerTxUrl(
      alert.txHash
    )}">View Transaction</a>`;
  }

  return message;
}

export async function processBuy(
  groupId: string,
  data: {
    txHash: string;
    buyer: string;
    tokenAddress: string;
    nativeAmount: number | string;
    tokenAmount?: string;
    usdValue?: number | string;
    tokenSymbol?: string;
    tokenName?: string;
    blockNumber?: bigint;
  }
) {
  const settings = await getBuyBotSettings(groupId);

  if (!settings) {
    return {
      ignored: true,
      reason: "GROUP_NOT_FOUND"
    };
  }

  if (!settings.buyBotEnabled) {
    return {
      ignored: true,
      reason: "BUYBOT_DISABLED"
    };
  }

  const nativeAmount = Number(data.nativeAmount);

  if (!Number.isFinite(nativeAmount)) {
    return {
      ignored: true,
      reason: "INVALID_NATIVE_AMOUNT"
    };
  }

  if (
    !meetsMinimumBuy(
      nativeAmount,
      Number(settings.buyBotMinEth)
    )
  ) {
    return {
      ignored: true,
      reason: "BELOW_MINIMUM"
    };
  }

  const whale = isWhaleBuy(
    nativeAmount,
    Number(settings.buyBotWhaleEth)
  );

  const alert = await saveBuyAlert({
    groupId,
    txHash: data.txHash,
    buyer: normalizeAddress(data.buyer),
    tokenAddress: normalizeAddress(data.tokenAddress),

    // Always convert to number before Prisma.
    nativeAmount,

    tokenAmount: data.tokenAmount,

    usdValue:
      data.usdValue !== undefined
        ? Number(data.usdValue)
        : undefined,

    tokenSymbol: data.tokenSymbol,
    tokenName: data.tokenName,

    blockNumber: data.blockNumber,

    isWhale: whale
  });

  const message = buildBuyAlertMessage(
    {
      groupId,
      txHash: alert.txHash,
      buyer: alert.buyer,
      tokenAddress: alert.tokenAddress,
      nativeAmount: Number(alert.nativeAmount),
      tokenAmount: alert.tokenAmount ?? undefined,
      usdValue: alert.usdValue ?? undefined,
      tokenSymbol: alert.tokenSymbol ?? undefined,
      tokenName: alert.tokenName ?? undefined,
      blockNumber: alert.blockNumber ?? undefined,
      telegramMessageId:
        alert.telegramMessageId ?? undefined,
      isWhale: alert.isWhale
    },
    settings
  );

  return {
    ignored: false,
    whale,
    alert,
    message
  };
}

export async function scanTransaction(
  txHash: string,
  tokenAddress: string
) {
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    return [];
  }

  const token = normalizeAddress(tokenAddress);

  const iface = new ethers.Interface(BUY_ABI);

  const buys: Array<{
    txHash: string;
    buyer: string;
    tokenAddress: string;
    nativeAmount: number;
    tokenAmount: string;
    blockNumber: bigint;
  }> = [];

  for (const log of receipt.logs) {
    if (
      normalizeAddress(log.address) !== token
    ) {
      continue;
    }

    try {
      const parsed = iface.parseLog({
        topics: [...log.topics],
        data: log.data
      });

      if (!parsed) continue;

      if (parsed.name !== "Transfer") continue;

      const from = String(parsed.args[0]);
      const to = String(parsed.args[1]);
      const value = parsed.args[2] as bigint;

      if (
        normalizeAddress(from) ===
        "0x0000000000000000000000000000000000000000"
      ) {
        continue;
      }

      const tx = await provider.getTransaction(txHash);

      if (!tx) continue;

      const nativeAmount = Number(
        ethers.formatEther(tx.value)
      );

      if (!Number.isFinite(nativeAmount)) {
        continue;
      }

      buys.push({
        txHash,
        buyer: to,
        tokenAddress: token,
        nativeAmount,
        tokenAmount: value.toString(),
        blockNumber: receipt.blockNumber
          ? BigInt(receipt.blockNumber)
          : undefined
      });
    } catch {
      continue;
    }
  }

  return buys;
}

export async function cleanupOldBuyAlerts(
  groupId: string,
  days = 30
) {
  const cutoff = new Date(
    Date.now() -
      days * 24 * 60 * 60 * 1000
  );

  return prisma.buyAlert.deleteMany({
    where: {
      groupId,
      timestamp: {
        lt: cutoff
      }
    }
  });
}
