import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/auth/signin" },
  callbacks: {
    authorized({ req, token }) {
      console.log("Middleware check:", token ? "✅ Authenticated" : "❌ Not authenticated");
      return !!token;
    },
  },
});

export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*", "/documents/:path*"],
};
