import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import stripe from "@/lib/stripe";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await req.json();

  const plan = await prisma.plan.findUnique({
    where: { id: planId }
  });

  if (!plan || !plan.isActive) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  // Optional: prevent double subscription
  const existing = await prisma.subscription.findUnique({
    where: { userId: session.user.id }
  });

  if (existing && ["active", "trialing"].includes(existing.status)) {
    return NextResponse.json(
      { error: "Subscription already active" },
      { status: 400 }
    );
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: session.user.email,

    line_items: [
      {
        price: plan.stripePriceId,
        quantity: 1
      }
    ],

    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscribe`,

    metadata: {
      userId: session.user.id,
      planId: plan.id
    }
  });

  return NextResponse.json({ url: checkoutSession.url });
}
