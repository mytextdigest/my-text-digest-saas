import { getServerSession } from "next-auth";
import { authOptions } from "../[...nextauth]/route";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { currentPassword, newPassword } = await req.json();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    return new Response("Current password is incorrect", { status: 400 });
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed },
  });

  return new Response("Password updated", { status: 200 });
}
