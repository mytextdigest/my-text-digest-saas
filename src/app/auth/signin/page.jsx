"use client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

import { Suspense } from "react";
import SigninPageInner from "./SigninPageInner";

export default function SigninPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SigninPageInner />
    </Suspense>
  );
}
