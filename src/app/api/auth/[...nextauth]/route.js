// src/app/api/auth/[...nextauth]/route.js
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
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) throw new Error("No user found");

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) throw new Error("Invalid password");

        // Return user object without password
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          // Add any other user fields you need in the session
        };
      },
    }),
  ],
  session: { 
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // Add user id to token on sign in
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }

      // Handle session update if needed
      if (trigger === "update" && session) {
        token = { ...token, ...session };
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.email = token.email;
        session.user.name = token.name;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Handle relative callback URLs
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }
      // Allow callback URLs on the same origin
      else if (new URL(url).origin === baseUrl) {
        return url;
      }
      // Fallback to base URL
      return baseUrl;
    },
  },
  pages: {
    signIn: "/auth/signin",
    signUp: "/auth/signup", // Changed from newUser to signUp for consistency
    error: "/auth/error", // Add error page for better UX
  },
  // Vercel Production Fixes
  debug: process.env.NODE_ENV === "development",
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax", // Changed to lax for better cross-origin support
        path: "/",
        secure: process.env.NODE_ENV === "production",
        domain: process.env.NODE_ENV === "production" ? ".vercel.app" : undefined,
      },
    },
  },
  // Ensure NEXTAUTH_URL is properly set
  // theme: {
  //   colorScheme: "auto",
  //   brandColor: "#000000",
  //   logo: "/logo.png",
  // },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };