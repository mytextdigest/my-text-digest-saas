"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "./Button";

export default function LogoutButton() {
  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/auth/signin" })}
      className="w-full flex items-center gap-2 mt-4 py-3 text-base"
    >
      <LogOut size={18} />
      Log out
    </Button>
  );
}
