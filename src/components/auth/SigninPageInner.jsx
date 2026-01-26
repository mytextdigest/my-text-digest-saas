"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Mail, Lock, LogIn, EyeOff, Eye } from "lucide-react";

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
      router.push(callbackUrl);  // IMPORTANT
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <Card className="w-[90vw] max-w-md shadow-xl rounded-2xl backdrop-blur-md bg-white/80 dark:bg-gray-900/80">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-semibold flex items-center justify-center gap-2">
              <LogIn className="w-6 h-6 text-blue-600" />
              Sign In
            </CardTitle>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSignin} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Email</label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
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

              <div>
                <label className="text-sm font-medium">Password</label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
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
                    className="absolute right-3 top-2.5 text-gray-400"
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>

                {/* Forgot password */}
                <div className="flex justify-end mt-1">
                  <button
                    type="button"
                    onClick={() => router.push("/auth/forgot-password")}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              {error && <p className="text-red-600 text-sm text-center">{error}</p>}

              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <p className="text-sm text-center mt-4">
              Don’t have an account?{" "}
              <button
                onClick={() => router.push("/auth/signup")}
                className="text-blue-600 hover:underline"
              >
                Sign up
              </button>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
