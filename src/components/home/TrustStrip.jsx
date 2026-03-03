"use client";

import { motion } from "framer-motion";
import { Shield, Zap, Lock, Cloud } from "lucide-react";

const trustItems = [
  { icon: Lock, text: "Local-first storage" },
  { icon: Zap, text: "GPT-powered summaries" },
  { icon: Shield, text: "Private by design" },
  { icon: Cloud, text: "No vendor lock-in" },
];

export default function TrustStrip() {
  return (
    <section className="py-12 border-y border-border bg-secondary/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="flex flex-wrap items-center justify-center gap-8 md:gap-16"
        >
          {trustItems.map((item, index) => (
            <motion.div
              key={item.text}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.08 }}
              className="group flex items-center gap-3 cursor-default"
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center
                              transition-all duration-300
                              group-hover:border-primary-400
                              group-hover:bg-primary-50
                              group-hover:shadow-md
                              group-hover:scale-105">
                <item.icon className="w-5 h-5 text-primary-500 transition-colors duration-300 group-hover:text-primary-600" />
              </div>

              {/* Text */}
              <span className="text-sm font-medium text-muted-foreground
                               transition-all duration-300
                               group-hover:text-foreground
                               group-hover:translate-x-0.5">
                {item.text}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
