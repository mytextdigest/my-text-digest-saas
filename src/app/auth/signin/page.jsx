export const dynamic = "force-dynamic";
export const runtime = "nodejs"; 
export const preferredRegion = "auto";
export const fetchCache = "force-no-store";
export const revalidate = 0;

import SigninPageInner from "@/components/auth/SigninPageInner";
import { Suspense } from "react";

export default function SigninPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SigninPageInner />
    </Suspense>
  );
}
