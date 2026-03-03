"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { FileText, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";

const useAuth = () => ({ isAuthenticated: false });

export default function Navbar() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-primary-100 glass">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          
          {/* Logo */}
          <motion.div 
            onClick={() => router.push(isAuthenticated ? "/dashboard" : "/")}
            className="flex cursor-pointer items-center gap-2.5"
            whileHover={{ scale: 1.02 }}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500 text-white shadow-lg shadow-primary-200">
              <FileText size={20} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold leading-none text-foreground">
                My Text Digest
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Knowledge Systems
              </span>
            </div>
          </motion.div>

          {/* Center Links */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-primary-600 transition-colors">Features</a>
            <a href="#intelligence" className="hover:text-primary-600 transition-colors">Intelligence</a>
            <a href="#pricing" className="hover:text-primary-600 transition-colors">Pricing</a>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Button onClick={() => router.push("/dashboard")} className="rounded-full px-6 bg-primary-500 hover:bg-primary-600">
                Dashboard
              </Button>
            ) : (
              <>
                <Button variant="ghost" className="hidden sm:inline-flex text-muted-foreground">
                  Log in
                </Button>
                <Button className="rounded-full bg-primary-500 px-6 hover:bg-primary-600 text-white shadow-md">
                  Get Started <Zap className="ml-2 h-4 w-4 fill-current" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}