import { PrismaPg } from "@prisma/adapter-pg";
import { ENV_PRIVATE } from "@/config/env-private";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};
const adapter = new PrismaPg({
  connectionString: ENV_PRIVATE.DATABASE_URL,
});
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
