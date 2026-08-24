import { prisma } from "../db.js";

type TelegramUser = {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
};

export async function upsertMember(
  groupId: string,
  user: TelegramUser
) {
  return prisma.member.upsert({
    where: {
      groupId_telegramId: {
        groupId,
        telegramId:
          String(user.id)
      }
    },

    create: {
      groupId,

      telegramId:
        String(user.id),

      username:
        user.username,

      firstName:
        user.first_name,

      lastName:
        user.last_name
    },

    update: {
      username:
        user.username,

      firstName:
        user.first_name,

      lastName:
        user.last_name
    }
  });
}

export async function recordMessage(
  groupId: string,
  telegramId: number
) {
  return prisma.member.update({
    where: {
      groupId_telegramId: {
        groupId,

        telegramId:
          String(telegramId)
      }
    },

    data: {
      messages: {
        increment: 1
      },

      xp: {
        increment: 1
      },

      lastMessageAt:
        new Date()
    }
  });
}

export async function createWarning(
  groupId: string,
  memberId: string,
  reason: string,
  moderatorId?: string
) {
  const warning =
    await prisma.warning.create({
      data: {
        groupId,

        memberId,

        reason,

        moderatorId
      }
    });

  await prisma.member.update({
    where: {
      id: memberId
    },

    data: {
      warnings: {
        increment: 1
      }
    }
  });

  return warning;
}

export async function clearWarnings(
  groupId: string,
  telegramId: string
) {
  const member =
    await prisma.member.findUnique({
      where: {
        groupId_telegramId: {
          groupId,

          telegramId
        }
      }
    });

  if (!member) {
    return null;
  }

  await prisma.warning.deleteMany({
    where: {
      memberId: member.id
    }
  });

  return prisma.member.update({
    where: {
      id: member.id
    },

    data: {
      warnings: 0
    }
  });
}
