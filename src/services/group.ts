import { prisma } from "../db.js";

export async function getOrCreateGroup(
  telegramId: string,
  title?: string
) {
  return prisma.group.upsert({
    where: {
      telegramId
    },

    create: {
      telegramId,
      title
    },

    update: {
      title:
        title || undefined
    }
  });
}

export function getBlockedWords(
  words: string
) {
  return words
    .split(",")
    .map(word =>
      word.trim().toLowerCase()
    )
    .filter(Boolean);
}
