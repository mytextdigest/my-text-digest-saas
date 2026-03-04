"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Mail, Lock, EyeOff, Eye } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);


  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");

    if (!acceptedTerms) {
      setError("You must accept the Terms & Conditions to continue.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 201) {
        router.push(`/auth/verify-otp?email=${encodeURIComponent(email)}`);
      } else {
        const msg = await res.text();
        setError(msg || "Signup failed");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
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
            Create your account to organize, summarize, and chat with your documents online.
          </p>
        </div>

        <Card className="shadow-lg border border-border bg-card">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl font-semibold text-foreground">
              Create an Account
            </CardTitle>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSignup} className="space-y-4">
              {/* Email */}
              <div>
                <label className="text-sm font-medium text-foreground">
                  Email
                </label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    className="pl-10"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
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
                    placeholder="••••••••"
                    className="pl-10 pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
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
              </div>

              {error && (
                <p className="text-error-600 text-sm text-center">
                  {error}
                </p>
              )}

              {/* Accept Terms */}
              <div className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  id="terms"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="
                    mt-1 h-4 w-4 rounded
                    border-border
                    text-primary-600
                    focus:ring-primary-500
                  "
                />
                <label htmlFor="terms" className="text-muted-foreground leading-relaxed">
                  I agree to the{" "}
                  <a
                    href="https://my-text-digest-main-landing.vercel.app/terms"
                    target="_blank"
                    className="text-primary-600 hover:underline font-medium"
                  >
                    Terms & Conditions
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://my-text-digest-main-landing.vercel.app/privacy"
                    target="_blank"
                    className="text-primary-600 hover:underline font-medium"
                  >
                    Privacy Policy
                  </a>.
                </label>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 text-white"
              >
                {loading ? "Creating account..." : "Sign Up"}
              </Button>
            </form>

            <p className="text-sm text-center mt-4 text-muted-foreground">
              Already have an account?{" "}
              <button
                onClick={() => router.push("/auth/signin")}
                className="text-primary-600 hover:underline font-medium"
              >
                Sign in
              </button>
            </p>

            {/* Optional subtle desktop hint */}
            {/* <p className="text-xs text-center mt-6 text-muted-foreground">
              Looking for the desktop version?{" "}
              <button
                onClick={() => router.push("/desktop")}
                className="text-primary-600 hover:underline"
              >
                Click Here
              </button>
            </p> */}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}