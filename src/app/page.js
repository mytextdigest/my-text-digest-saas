"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Sparkles, FileText, MessageSquare, Lock } from "lucide-react";
import { Button } from '@/components/ui/Button';
import { Card, CardContent} from '@/components/ui/Card';

export default function HomePage() {
  return (
    <div className="relative min-h-screen flex flex-col bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-800 dark:text-slate-100">
      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-900/30 to-transparent pointer-events-none" />

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center justify-center px-6 py-28 text-center">
        <motion.h1
          className="text-5xl md:text-6xl font-bold tracking-tight bg-gradient-to-r from-blue-500 via-indigo-400 to-purple-500 bg-clip-text text-transparent"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          Summarize Smarter. Search Deeper.
        </motion.h1>
        <motion.p
          className="mt-6 max-w-2xl text-lg md:text-xl text-slate-600 dark:text-slate-300"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          Transform your documents into instant, searchable insights — powered by GPT and built with your privacy in mind.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Link href="/dashboard">
            <Button
              size="lg"
              className="group bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-indigo-600 hover:to-blue-600 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-blue-500/30 transition-all duration-300"
            >
              Go to Dashboard
              <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>

          <Link href="/auth/signup">
            <Button
              variant="outline"
              size="lg"
              className="bg-white/50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium px-6 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-300"
            >
              Get Started
              <Sparkles className="ml-2 h-5 w-5 text-indigo-400" />
            </Button>
          </Link>
        </motion.div>
      </section>

      {/* Feature Section */}
      <section className="relative z-10 px-6 py-24 bg-gradient-to-b from-slate-100 to-white dark:from-slate-950 dark:to-slate-900">
        <div className="max-w-6xl mx-auto text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent">
            Everything You Need in One Place
          </h2>
          <p className="mt-4 text-slate-600 dark:text-slate-300">
            From document uploads to intelligent Q&A — all locally stored, all under your control.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {[
            {
              icon: FileText,
              title: "Smart Summaries",
              text: "Automatically generate concise summaries from long documents using GPT-powered processing.",
            },
            {
              icon: MessageSquare,
              title: "Interactive Q&A",
              text: "Ask questions directly about your files and get precise, context-aware answers instantly.",
            },
            {
              icon: Lock,
              title: "Privacy First",
              text: "Your documents never leave your system — only small, relevant text chunks are processed securely.",
            },
          ].map((feature, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              viewport={{ once: true }}
            >
              <Card className="p-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200/40 dark:border-slate-800/40 shadow-md hover:shadow-indigo-500/20 transition-all duration-300 rounded-2xl">
                <CardContent className="flex flex-col items-center text-center">
                  <feature.icon className="h-10 w-10 text-indigo-500 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                  <p className="text-slate-600 dark:text-slate-400">{feature.text}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Call to Action */}
      <section className="relative z-10 py-24 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white text-center">
        <motion.h2
          className="text-3xl md:text-4xl font-bold mb-6"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          Ready to Summarize Smarter?
        </motion.h2>
        <motion.div
          className="flex flex-col sm:flex-row justify-center gap-4"
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <Link href="/setup">
            <Button
              size="lg"
              className="bg-white text-blue-700 font-semibold rounded-xl px-6 py-3 hover:bg-slate-100 shadow-md hover:shadow-white/30 transition-all duration-300"
            >
              Get Started for Free
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button
              size="lg"
              variant="outline"
              className="border-white text-white hover:bg-white/10 rounded-xl px-6 py-3 transition-all duration-300"
            >
              Go to Dashboard
            </Button>
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
