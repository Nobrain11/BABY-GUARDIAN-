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

  robinhoodRpcUrl: required("ROBINHOOD_RPC_URL"),

  babyTokenAddress: required("BABY_TOKEN_ADDRESS"),

  port: Number(process.env.PORT || 3000),

  dashboardSecret: required("DASHBOARD_SECRET"),

  logChatId: process.env.LOG_CHAT_ID || "",

  adminIds: (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),

  robinhoodExplorerUrl:
    process.env.ROBINHOOD_EXPLORER_URL ||
    "https://explorer.mainnet.chain.robinhood.com"
};
