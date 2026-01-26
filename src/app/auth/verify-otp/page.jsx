import VerifyOtpClient from "@/components/auth/VerifyOtpClient";
import { Suspense } from "react";

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<div />}>
      <VerifyOtpClient />
    </Suspense>
  );
}