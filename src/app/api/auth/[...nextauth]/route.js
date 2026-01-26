import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) throw new Error("No user found");

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) throw new Error("Invalid password");

        if (!user.emailVerified) {
          throw new Error("EMAIL_NOT_VERIFIED");
        }

        return user;
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token) session.user.id = token.id;
      return session;
    },
    async redirect({ url, baseUrl }) {
      // 1. Allow relative URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
    
      // 2. Only allow production domain
      try {
        const host = new URL(url).host;
        if (host === "my-text-digest-saas.vercel.app") return url;
      } catch {}
    
      // Fallback
      return baseUrl;
    }
  },
  pages: {
    signIn: "/auth/signin",
    newUser: "/auth/signup",
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
