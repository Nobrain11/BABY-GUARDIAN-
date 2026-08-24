import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing`);
  }

  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),

  databaseUrl: required("DATABASE_URL"),

  redisUrl: required("REDIS_URL"),

  port: Number(process.env.PORT || 3000),

  dashboardSecret: required("DASHBOARD_SECRET"),

  logChatId:
    process.env.LOG_CHAT_ID || "",

  adminIds:
    (process.env.ADMIN_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),

  // --------------------------------------------------
  // ROBINHOOD CHAIN
  // --------------------------------------------------

  rpcUrl: required("ROBINHOOD_RPC_URL"),

  chainId: Number(
    process.env.ROBINHOOD_CHAIN_ID || "4663"
  ),

  babyTokenAddress: required(
    "BABY_TOKEN_ADDRESS"
  ),

  // --------------------------------------------------
  // BUY BOT
  // --------------------------------------------------

  buyBotPollIntervalMs: Number(
    process.env.BUYBOT_POLL_INTERVAL_MS || "3000"
  ),

  explorerUrl:
    process.env.ROBINHOOD_EXPLORER_URL ||
    ""
};
