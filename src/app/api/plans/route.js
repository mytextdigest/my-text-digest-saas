import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { storageLimitGb: 'asc' }
  });

  return NextResponse.json(plans);
}
