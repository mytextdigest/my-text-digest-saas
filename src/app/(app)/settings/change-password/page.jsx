"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Eye, EyeOff, ArrowLeft } from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function ChangePasswordPage() {
  const router = useRouter();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (next !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: current,
        newPassword: next,
      }),
    });

    if (res.ok) {
      setMessage("Password updated successfully");
      setCurrent("");
      setNext("");
      setConfirm("");
    } else {
      setError(await res.text());
    }

    setLoading(false);
  };

  return (
    <Layout>
      {/* Full-height centering inside layout content */}
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
        <div className="w-full max-w-lg space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Security</h1>

            <Button
              variant=""
              className="flex items-center gap-2 text-sm"
              onClick={() => router.push("/dashboard")}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Button>
          </div>

          {/* Card */}
          <Card className="shadow-lg rounded-2xl">
            <CardContent className="p-8 space-y-6">
              <div>
                <h2 className="text-lg font-medium">Change password</h2>
                <p className="text-sm text-gray-500">
                  Update your account password below
                </p>
              </div>

              {/* Current password */}
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Current password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <Input
                    type={showCurrent ? "text" : "password"}
                    className="pl-10 pr-10"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div>
                <label className="text-sm font-medium mb-1 block">
                  New password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <Input
                    type={showNext ? "text" : "password"}
                    className="pl-10 pr-10"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNext((v) => !v)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showNext ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Confirm new password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <Input
                    type={showConfirm ? "text" : "password"}
                    className="pl-10 pr-10"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Messages */}
              {error && <p className="text-red-600 text-sm">{error}</p>}
              {message && <p className="text-green-600 text-sm">{message}</p>}

              {/* Actions */}
              <div className="flex justify-end">
                <Button
                  onClick={submit}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                >
                  {loading ? "Updating..." : "Update password"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
