import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req) {
  const { email, otp } = await req.json();

  const record = await prisma.otpToken.findFirst({
    where: {
      email,
      token: otp,
      expiresAt: { gt: new Date() },
    },
  });

  if (!record) {
    return new Response("Invalid or expired OTP", { status: 400 });
  }

  await prisma.user.update({
    where: { email },
    data: { emailVerified: true },
  });

  await prisma.otpToken.deleteMany({
    where: { email },
  });

  return new Response("Email verified", { status: 200 });
}
