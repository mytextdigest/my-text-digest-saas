"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);

    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setMessage("If the email exists, a verification code has been sent.");
    setTimeout(() => {
      router.push(`/auth/reset-password?email=${encodeURIComponent(email)}`);
    }, 1200);

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 px-4">
      <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="w-full max-w-md shadow-xl rounded-2xl bg-white/80 dark:bg-gray-900/80">
          <CardHeader className="text-center space-y-2">
            <ShieldAlert className="mx-auto h-8 w-8 text-blue-600" />
            <CardTitle className="text-2xl font-semibold">
              Forgot password
            </CardTitle>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Enter your email to receive a reset code
            </p>
          </CardHeader>

          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                <Input
                  type="email"
                  required
                  className="pl-10"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {message && (
                <p className="text-green-600 text-sm text-center">
                  {message}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? "Sending..." : "Send reset code"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
