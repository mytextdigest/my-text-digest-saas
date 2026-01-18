import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getUserSubscription, isSubscriptionActive } from "@/lib/subscription";
import { getUserOpenAIKey } from "@/utils/key_helper";

export default async function AppLayout({ children }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const subscription = await getUserSubscription(session.user.id);

  if (!isSubscriptionActive(subscription)) {
    redirect("/subscribe");
  }

  const apiKey = await getUserOpenAIKey(session.user.id);
  if (!apiKey) {
    redirect("/setup");
  }

  return <>{children}</>;
}
