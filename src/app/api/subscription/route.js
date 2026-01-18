import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(null);
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    include: {
      plan: true,
      user: {
        select: {
          storageUsedBytes: true
        }
      }
    }
  });

  if (!subscription) {
    return NextResponse.json(null);
  }

  // 🔑 Convert BigInt → string
  return NextResponse.json({
    ...subscription,
    user: {
      ...subscription.user,
      storageUsedBytes: subscription.user.storageUsedBytes.toString()
    }
  });
}
