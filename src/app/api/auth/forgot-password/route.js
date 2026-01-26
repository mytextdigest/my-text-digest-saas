import { PrismaClient } from "@prisma/client";
import { sendOtpEmail } from "@/lib/mailer";

const prisma = new PrismaClient();

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req) {
  const { email } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });

  // IMPORTANT: Do NOT reveal if user exists
  if (!user) {
    return new Response("If the email exists, OTP has been sent", { status: 200 });
  }

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

  return new Response("If the email exists, OTP has been sent", { status: 200 });
}
