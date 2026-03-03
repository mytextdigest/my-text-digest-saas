"use client";

import { motion } from "framer-motion";
import { FileText, FolderOpen, MessageCircle, ArrowRight } from "lucide-react";

const comparison = [
  {
    type: "Document Chat",
    icon: FileText,
    description: "Ask questions about a single document",
    useCases: [
      "Understanding one PDF in depth",
      "Line-by-line reasoning",
      "Clarifying specific content",
    ],
    example: '"What are the key findings in this research paper?"',
  },
  {
    type: "Project Chat",
    icon: FolderOpen,
    description: "Ask questions across all documents in a project",
    useCases: [
      "Cross-referencing information",
      "Synthesis and comparison",
      "Big-picture understanding",
    ],
    example: '"How do these three contracts differ in terms of liability?"',
  },
];

export default function ChatComparison() {
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
            Two levels of intelligence
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Chat with a single document for precision, or across your entire project for synthesis.
          </p>
        </motion.div>

        {/* Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {comparison.map((item, index) => (
            <motion.div
              key={item.type}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.08 }}
              className="group"
            >
              <div
                className="
                  h-full bg-card border border-slate-200 dark:border-slate-700
                  rounded-2xl p-8
                  transition-all duration-300
                  hover:-translate-y-1
                  hover:border-primary-400
                  hover:shadow-[0_12px_30px_rgba(59,130,246,0.12)]
                  dark:hover:shadow-[0_12px_30px_rgba(59,130,246,0.25)]
                "
              >
                {/* Header */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center transition-all duration-300 group-hover:bg-primary-200 group-hover:scale-110">
                    <item.icon className="w-7 h-7 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold text-foreground">
                      {item.type}
                    </h3>
                    <p className="text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>

                {/* Use cases */}
                <div className="space-y-3 mb-6">
                  {item.useCases.map((useCase) => (
                    <div key={useCase} className="flex items-start gap-3">
                      <ArrowRight className="w-4 h-4 mt-1 text-primary-600 flex-shrink-0" />
                      <span className="text-muted-foreground">
                        {useCase}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Example */}
                <div className="rounded-xl p-4 bg-secondary/50 transition-colors duration-300 group-hover:bg-secondary">
                  <div className="flex items-start gap-3">
                    <MessageCircle className="w-5 h-5 mt-0.5 text-primary-600 flex-shrink-0" />
                    <p className="text-sm italic text-foreground">
                      {item.example}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
