"use client";

import { motion } from "framer-motion";
import {
  FileText,
  MessageSquare,
  Lock,
  Database,
  FolderOpen,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

const features = [
  {
    icon: FileText,
    title: "Smart Summaries",
    description:
      "Long documents distilled into clean, readable insights you can scan in seconds.",
  },
  {
    icon: MessageSquare,
    title: "Chat with Documents",
    description:
      "Ask questions about any document using context-aware, conversational Q&A.",
  },
  {
    icon: FolderOpen,
    title: "Project-Based Organization",
    description:
      "Group related documents into projects and chat across all files at once.",
  },
  {
    icon: Lock,
    title: "Privacy First",
    description:
      "Only relevant text chunks are processed — your files stay private and secure.",
  },
  {
    icon: Database,
    title: "Structured Storage",
    description:
      "Documents, summaries, and embeddings — all neatly organized and persistent.",
  },
  {
    icon: Layers,
    title: "Multi-Document Synthesis",
    description:
      "Ask questions that span multiple documents for deeper insights and connections.",
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 relative overflow-hidden">
      {/* Soft background accent */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[720px] bg-primary-100/40 rounded-full blur-3xl" />
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
            Everything you need for
            <br />
            <span className="text-primary-600">deep document work</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Designed for focus, not clutter. Built for researchers, professionals,
            and anyone who works with documents.
          </p>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.06 }}
            >
              <Card
                className="
                  h-full bg-card
                  border border-slate-200 dark:border-slate-700
                  transition-all duration-300
                  hover:border-primary-400
                  hover:-translate-y-1
                  hover:shadow-[0_10px_30px_rgba(59,130,246,0.12)]
                  dark:hover:shadow-[0_10px_30px_rgba(59,130,246,0.25)]
                  group
                "
              >
                <CardContent className="p-6 flex flex-col h-full">
                  {/* Icon */}
                  <div
                    className="
                      w-12 h-12 rounded-xl
                      bg-primary-100
                      flex items-center justify-center mb-4
                      transition-all duration-300
                      group-hover:bg-primary-200
                      group-hover:scale-110
                    "
                  >
                    <feature.icon className="w-6 h-6 text-primary-600" />
                  </div>

                  {/* Title */}
                  <h3 className="text-xl font-semibold text-foreground mb-2 transition-colors group-hover:text-primary-700">
                    {feature.title}
                  </h3>

                  {/* Description */}
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
