"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { FileText, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Image from "next/image";

const useAuth = () => ({ isAuthenticated: false });

export default function Navbar() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      {/* Outer spacing to create floating effect */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-4">
        {/* Floating container */}
        <div className="rounded-2xl bg-white/80 backdrop-blur-xl shadow-lg shadow-slate-900/5 ring-1 ring-slate-200/60">
          <div className="flex h-16 items-center justify-between px-6">
            
            {/* Logo */}
            <motion.div
              onClick={() => router.push(isAuthenticated ? "/dashboard" : "/")}
              className="flex cursor-pointer items-center gap-2.5"
              whileHover={{ opacity: 0.85 }}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl shadow-md">
                <Image
                  src="/logo.png"
                  alt="My Text Digest Logo"
                  width={40}
                  height={40}
                  className="object-contain"
                />
              </div>
              <div>
                <span className="block text-lg font-bold leading-none text-slate-900">
                  My Text Digest
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Document Intelligence
                </span>
              </div>
            </motion.div>

            {/* Nav Links */}
            <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
              <a href="#features" className="hover:text-indigo-600 transition-colors">
                Features
              </a>
              <a href="#pricing" className="hover:text-indigo-600 transition-colors">
                Pricing
              </a>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <Button
                  onClick={() => router.push("/dashboard")}
                  className="rounded-full px-6"
                >
                  Dashboard
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    className="hidden sm:inline-flex text-slate-600"
                    onClick={() => router.push("/auth/signin")}
                  >
                    Login
                  </Button>
                  <Button
                    className="rounded-full bg-indigo-600 px-6 hover:bg-indigo-700 shadow-md"
                    onClick={() => router.push("/auth/signup")}
                  >
                    Get Started
                    <Zap className="ml-2 h-4 w-4" />
                  </Button>
                </>
              )}
            </div>

          </div>
        </div>
      </div>
    </nav>
  );
}
