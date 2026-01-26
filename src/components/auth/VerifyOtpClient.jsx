"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Mail, RefreshCcw, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";


export default function VerifyOtpClient() {
  const params = useSearchParams();
  const email = params.get("email");
  const router = useRouter();

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(30);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;

    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async () => {
    if (!otp) return;

    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp }),
    });

    if (res.ok) {
      router.push("/auth/signin");
    } else {
      setError(await res.text());
    }

    setLoading(false);
  };

  const resendOtp = async () => {
    setResending(true);
    setError("");

    const res = await fetch("/api/auth/resend-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      setError(await res.text());
    } else {
      setCooldown(30);
    }

    setResending(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 px-4">
      <motion.div
        initial={{ opacity: 0, y: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="shadow-xl rounded-2xl backdrop-blur-md bg-white/80 dark:bg-gray-900/80">
          <CardHeader className="text-center space-y-2">
            <ShieldCheck className="mx-auto h-8 w-8 text-blue-600" />
            <CardTitle className="text-2xl font-semibold">
              Verify your email
            </CardTitle>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              We sent a 6-digit verification code to
            </p>
            <div className="flex items-center justify-center gap-1 text-sm font-medium text-gray-800 dark:text-gray-200">
              <Mail className="h-4 w-4 text-gray-400" />
              {email}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter 6-digit OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="text-center tracking-widest text-lg"
            />

            {error && (
              <p className="text-red-600 text-sm text-center">{error}</p>
            )}

            <Button
              onClick={submit}
              disabled={loading || otp.length !== 6}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              {loading ? "Verifying..." : "Verify Email"}
            </Button>

            <div className="text-center text-sm text-gray-600 dark:text-gray-400">
              Didn’t receive the code?
            </div>

            <Button
              variant="ghost"
              disabled={cooldown > 0 || resending}
              onClick={resendOtp}
              className="w-full flex items-center gap-2"
            >
              <RefreshCcw className="h-4 w-4" />
              {cooldown > 0
                ? `Resend OTP in ${cooldown}s`
                : resending
                ? "Resending..."
                : "Resend OTP"}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
