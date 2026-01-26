import { PrismaClient } from "@prisma/client";
import { sendOtpEmail } from "@/lib/mailer";

const prisma = new PrismaClient();

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req) {
  const { email } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  if (user.emailVerified) {
    return new Response("Email already verified", { status: 400 });
  }

  // Invalidate old OTPs
  await prisma.otpToken.deleteMany({ where: { email } });

  const otp = generateOtp();

  await prisma.otpToken.create({
    data: {
      email,
      token: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  await sendOtpEmail(email, otp);

  return new Response("OTP resent", { status: 200 });
}
