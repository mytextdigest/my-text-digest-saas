"use client";

import { motion } from "framer-motion";
import { ArrowRight, Globe, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";

export default function HeroSection() {
  const router = useRouter();

  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Soft background blobs (aligned with globals.css) */}
        <div className="absolute top-1/4 left-1/4 w-[420px] h-[420px] bg-primary-100/60 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[360px] h-[360px] bg-primary-200/40 rounded-full blur-3xl" />

        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(0,0,0,0.04) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(0,0,0,0.04) 1px, transparent 1px)
            `,
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6 flex justify-center"
        >
          <div
            className="
              inline-flex items-center gap-2
              px-5 py-2
              rounded-full
              bg-gradient-to-r from-primary-500/20 to-primary-600/20
              border border-primary-500/40
              text-primary-300
              text-sm font-semibold tracking-wide
              backdrop-blur-md
              shadow-[0_0_25px_rgba(59,130,246,0.25)]
            "
          >
            {/* <Download className="w-4 h-4" /> */}
            WEB VERSION
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-tight tracking-tight"
        >
          Your Knowledge.
          <br />
          <span className="text-primary-600">
            Accessible Anywhere.
          </span>
          <br />
          <span className="text-muted-foreground">
            Secured in the Cloud.
          </span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
        >
          Structure, search, and scale your information with secure cloud intelligence —
          designed for individuals and teams that value context and control. 
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-12 flex flex-col sm:flex-row justify-center gap-4"
        >
          <Button
            size="lg"
            onClick={() => router.push("/auth/signup")}
            className="
              bg-gradient-to-r
              from-primary-500
              to-primary-600
              hover:brightness-110
              text-white
              px-8 py-6
              shadow-[0_15px_50px_rgba(59,130,246,0.45)]
              hover:shadow-[0_20px_60px_rgba(59,130,246,0.65)]
              transition-all duration-300
              group
            "
          >
            <Globe className="mr-2 w-4 h-4" />
            Sign Up For Web Version
          </Button>

          {/* <Button
            size="lg"
            onClick={() => router.push("/dashboard")}
            className="
              bg-transparent
              border border-white/30
              text-white
              hover:bg-white/10
              hover:border-white/50
              px-8 py-6
              transition-all duration-300
              group
            "
          >
            Watch Demo
            <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Button> */}


        </motion.div>

      </div>

      {/* Decorative cards (static, safe) */}
      <div className="hidden lg:block absolute left-[6%] top-1/3">
        <div className="glass rounded-xl p-4 shadow-md w-48">
          <div className="w-full h-2 bg-primary-200 rounded mb-2" />
          <div className="w-3/4 h-2 bg-muted rounded mb-2" />
          <div className="w-5/6 h-2 bg-muted rounded" />
        </div>
      </div>

      <div className="hidden lg:block absolute right-[6%] top-1/2">
        <div className="glass rounded-xl p-4 shadow-md w-52">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-primary-500" />
            <div className="w-20 h-2 bg-muted rounded" />
          </div>
          <div className="w-full h-2 bg-muted rounded mb-2" />
          <div className="w-2/3 h-2 bg-muted rounded" />
        </div>
      </div>
    </section>
  );
}
