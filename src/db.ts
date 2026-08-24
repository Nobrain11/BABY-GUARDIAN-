import { PrismaClient } from "@prisma/client";

export const prisma =
  new PrismaClient();

export async function connectDatabase() {
  await prisma.$connect();

  console.log(
    "🗄️ PostgreSQL connected"
  );
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
