import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/auth/signin" },
  callbacks: {
    authorized({ req, token }) {
      const { pathname } = req.nextUrl;

      // Allow the auth pages to load without redirecting
      if (pathname.startsWith("/auth")) return true;

      // For all protected routes, require auth
      return !!token;
    },
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/project/:path*",
    "/document/:path*",
  ],
};
