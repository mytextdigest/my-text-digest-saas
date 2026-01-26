import ResetPasswordClient from "@/components/auth/ResetPasswordClient";
import { Suspense } from "react";

export default function ResetPasswordPage() {

  return (
    <Suspense fallback={<div />}>
      <ResetPasswordClient />
    </Suspense>
  );
}