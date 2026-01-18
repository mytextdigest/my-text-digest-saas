import prisma from "@/lib/prisma";

export async function requireActiveSubscriptionApi(userId) {
  const subscription = await prisma.subscription.findUnique({
    where: { userId }
  });

  if (!subscription) {
    throw new Error("NO_SUBSCRIPTION");
  }

  if (!["active", "trialing"].includes(subscription.status)) {
    throw new Error("SUBSCRIPTION_INACTIVE");
  }

  return subscription;
}
