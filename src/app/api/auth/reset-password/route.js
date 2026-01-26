import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

export async function POST(req) {
  const { email, otp, newPassword } = await req.json();

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

  const hashed = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { email },
    data: { password: hashed },
  });

  await prisma.otpToken.deleteMany({ where: { email } });

  return new Response("Password reset successful", { status: 200 });
}
