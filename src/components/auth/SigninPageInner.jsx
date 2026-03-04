"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Mail, Lock, EyeOff, Eye } from "lucide-react";

export default function SigninPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSignin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await signIn("credentials", {
      redirect: false,
      email,
      password,
      callbackUrl,
    });

    setLoading(false);

    if (res?.error) {
      if (res.error === "EMAIL_NOT_VERIFIED") {
        router.push(`/auth/verify-otp?email=${encodeURIComponent(email)}`);
        return;
      }
      setError(res.error);
    } else {
      router.push(callbackUrl);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        {/* Product Context */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">
            My Text Digest
          </h1>
          <p className="text-sm text-primary-600 font-medium mt-1">
            Cloud Version
          </p>
          <p className="text-muted-foreground text-sm mt-3">
            Sign in to access your projects, documents, and chat history.
          </p>
        </div>

        <Card className="shadow-lg border border-border bg-card">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl font-semibold text-foreground">
              Sign In
            </CardTitle>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSignin} className="space-y-4">
              {/* Email */}
              <div>
                <label className="text-sm font-medium text-foreground">
                  Email
                </label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input
                    type="email"
                    value={email}
                    required
                    placeholder="you@example.com"
                    className="pl-10"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="text-sm font-medium text-foreground">
                  Password
                </label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    required
                    placeholder="••••••••"
                    className="pl-10 pr-10"
                    onChange={(e) => setPassword(e.target.value)}
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>

                {/* Forgot password */}
                <div className="flex justify-end mt-1">
                  <button
                    type="button"
                    onClick={() => router.push("/auth/forgot-password")}
                    className="text-sm text-primary-600 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-error-600 text-sm text-center">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 text-white"
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <p className="text-sm text-center mt-4 text-muted-foreground">
              Don’t have an account?{" "}
              <button
                onClick={() => router.push("/auth/signup")}
                className="text-primary-600 hover:underline font-medium"
              >
                Sign up
              </button>
            </p>

            {/* Desktop hint */}
            {/* <p className="text-xs text-center mt-6 text-muted-foreground">
              Looking for the desktop version?{" "}
              <button
                onClick={() => router.push("/desktop")}
                className="text-primary-600 hover:underline"
              >
                Click here
              </button>
            </p> */}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}