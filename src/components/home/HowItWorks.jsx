"use client";

import { motion } from "framer-motion";
import { Upload, FolderPlus, MessageCircle, Brain } from "lucide-react";

const steps = [
  {
    icon: Upload,
    step: "01",
    title: "Upload Documents",
    description: "Drop PDFs, text files, or notes. We'll process them automatically.",
  },
  {
    icon: FolderPlus,
    step: "02",
    title: "Organize into Projects",
    description: "Group related documents together for cross-document intelligence.",
  },
  {
    icon: Brain,
    step: "03",
    title: "Get Smart Summaries",
    description: "Each document is summarized and embedded for instant retrieval.",
  },
  {
    icon: MessageCircle,
    step: "04",
    title: "Chat & Ask Questions",
    description: "Ask anything — at document level or across your entire project.",
  },
];

export default function HowItWorks() {
  return (
    <section className="py-24 bg-secondary/40 relative overflow-hidden">
      {/* Soft background accent */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-primary-100/40 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4">
            How it works
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            From upload to insight in minutes, not hours.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.08 }}
              className="relative group"
            >
              {/* Connector (desktop only) */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-10 left-[65%] w-full h-px bg-border/60" />
              )}

              <div
                className="
                  h-full bg-card border border-slate-200 dark:border-slate-700
                  rounded-2xl p-6 text-center
                  transition-all duration-300
                  hover:-translate-y-1
                  hover:border-primary-400
                  hover:shadow-[0_12px_30px_rgba(59,130,246,0.12)]
                  dark:hover:shadow-[0_12px_30px_rgba(59,130,246,0.25)]
                "
              >
                {/* Icon + step */}
                <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary-100 mb-6 transition-all duration-300 group-hover:bg-primary-200 group-hover:scale-105">
                  <step.icon className="w-9 h-9 text-primary-600" />
                  <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-primary-600 text-white text-xs font-semibold flex items-center justify-center shadow-md">
                    {step.step}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-lg font-semibold text-foreground mb-2 transition-colors group-hover:text-primary-700">
                  {step.title}
                </h3>

                {/* Description */}
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
