import {
  Contract,
  JsonRpcProvider,
  formatEther,
  formatUnits
} from "ethers";

import {
  config
} from "../config.js";

import {
  prisma
} from "../db.js";

const provider =
  new JsonRpcProvider(
    config.rpcUrl,
    config.chainId
  );

const ERC20_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const token =
  new Contract(
    config.babyTokenAddress,
    ERC20_ABI,
    provider
  );

let lastBlock = 0;

interface BuyEvent {
  from: string;
  to: string;
  amount: bigint;
  txHash: string;
  blockNumber: number;
}

/*
|--------------------------------------------------------------------------
| INITIALIZE
|--------------------------------------------------------------------------
*/

export async function initializeBuyBot() {
  lastBlock =
    await provider.getBlockNumber();

  console.log(
    `🍼 Buy Bot initialized at block ${lastBlock}`
  );
}

/*
|--------------------------------------------------------------------------
| FORMAT WALLET
|--------------------------------------------------------------------------
*/

function shortAddress(
  address: string
): string {
  return `${address.slice(
    0,
    6
  )}...${address.slice(-4)}`;
}

/*
|--------------------------------------------------------------------------
| GET ETH PRICE
|--------------------------------------------------------------------------
|
| We intentionally don't fake USD pricing here.
| USD display is omitted unless a real price
| provider is added.
|
|--------------------------------------------------------------------------
*/

async function getEthUsdPrice(): Promise<number | null> {
  return null;
}

/*
|--------------------------------------------------------------------------
| BUILD BUY MESSAGE
|--------------------------------------------------------------------------
*/

async function buildBuyMessage(
  group: any,
  event: BuyEvent
): Promise<string> {
  const decimals =
    Number(
      await token.decimals()
    );

  const symbol =
    await token.symbol();

  const amount =
    Number(
      formatUnits(
        event.amount,
        decimals
      )
    );

  const ethPrice =
    await getEthUsdPrice();

  const lines: string[] = [
    "🍼💚 BABY BUY",
    "",
    `🍼 ${amount.toLocaleString()} ${symbol}`
  ];

  if (
    group.buyBotShowWallet
  ) {
    lines.push(
      "",
      `👛 Buyer: ${shortAddress(event.from)}`
    );
  }

  if (
    group.buyBotShowUsd &&
    ethPrice !== null
  ) {
    lines.push(
      `💵 Value: $${ethPrice.toLocaleString()}`
    );
  }

  if (
    group.buyBotShowTx
  ) {
    const txUrl =
      config.explorerUrl
        ? `${config.explorerUrl}/tx/${event.txHash}`
        : event.txHash;

    lines.push(
      "",
      `🔗 TX: ${txUrl}`
    );
  }

  if (
    amount >= group.buyBotWhaleEth
  ) {
    lines.unshift(
      "🐋 WHALE BUY DETECTED"
    );
  }

  return lines.join("\n");
}

/*
|--------------------------------------------------------------------------
| GET ENABLED GROUPS
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

export async function announceBuy(
  telegram: any,
  event: BuyEvent
) {
  const groups =
    await getEnabledGroups();

  for (
    const group of groups
  ) {
    try {
      const message =
        await buildBuyMessage(
          group,
          event
        );

      await telegram.sendMessage(
        Number(group.telegramId),
        message
      );
    } catch (error) {
      console.error(
        `Buy alert failed for ${group.telegramId}:`,
        error
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| SCAN TRANSFERS
|--------------------------------------------------------------------------
*/

export async function scanBuyTransactions(
  telegram: any
) {
  const currentBlock =
    await provider.getBlockNumber();

  if (
    currentBlock <= lastBlock
  ) {
    return;
  }

  const fromBlock =
    lastBlock + 1;

  const toBlock =
    currentBlock;

  console.log(
    `🍼 Scanning BABY blocks ${fromBlock}-${toBlock}`
  );

  const logs =
    await token.queryFilter(
      token.filters.Transfer(),
      fromBlock,
      toBlock
    );

  for (
    const log of logs
  ) {
    const parsed =
      log.args;

    if (!parsed) {
      continue;
    }

    const from =
      String(parsed[0]);

    const to =
      String(parsed[1]);

    const amount =
      BigInt(parsed[2].toString());

    /*
     * Transfer events alone do NOT prove
     * that a transaction was a BUY.
     *
     * We therefore don't announce every
     * transfer as a buy.
     *
     * The next adapter should identify
     * the actual BABY DEX pool/router.
     */

    const event: BuyEvent = {
      from,
      to,
      amount,
      txHash:
        log.transactionHash,
      blockNumber:
        log.blockNumber
    };

    /*
     * Placeholder intentionally disabled.
     *
     * Once the actual BABY liquidity pool/
     * Universal Router address is configured,
     * only confirmed swaps will reach announceBuy().
     */

    void event;
  }

  lastBlock =
    currentBlock;
}

/*
|--------------------------------------------------------------------------
| START WATCHER
|--------------------------------------------------------------------------
*/

let timer:
  ReturnType<typeof setInterval> |
  undefined;

export function startBuyBotWatcher(
  telegram: any
) {
  if (timer) {
    return;
  }

  timer =
    setInterval(
      () => {
        scanBuyTransactions(
          telegram
        ).catch(
          (error) => {
            console.error(
              "Buy Bot scanner error:",
              error
            );
          }
        );
      },
      config.buyBotPollIntervalMs
    );

  console.log(
    "🟢 BABY Buy Bot watcher started"
  );
}

/*
|--------------------------------------------------------------------------
| STOP WATCHER
|--------------------------------------------------------------------------
*/

export function stopBuyBotWatcher() {
  if (!timer) {
    return;
  }

  clearInterval(timer);

  timer =
    undefined;

  console.log(
    "🔴 BABY Buy Bot watcher stopped"
  );
}
