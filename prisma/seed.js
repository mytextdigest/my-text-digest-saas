const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    await prisma.plan.update({
        where: { name: "Starter" },
        data: {
          priceCents: 300,
          currency: "USD"
        }
      });
      
      await prisma.plan.update({
        where: { name: "Pro" },
        data: {
          priceCents: 500,
          currency: "USD"
        }
      });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
