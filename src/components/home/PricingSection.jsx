"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useRouter } from "next/navigation";

function PricingSkeleton() {
  return (
    <div
      className="
        h-full bg-card border border-border rounded-2xl p-6
        animate-pulse flex flex-col
      "
    >
      <div className="h-6 w-32 bg-muted rounded mb-2" />
      <div className="h-4 w-48 bg-muted rounded mb-6" />

      <div className="h-10 w-24 bg-muted rounded mb-6" />

      <div className="space-y-3 flex-grow">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-4 bg-muted rounded" />
        ))}
      </div>

      <div className="h-10 bg-muted rounded mt-6" />
    </div>
  );
}

export default function PricingSection() {
  const router = useRouter();
  const [plans, setPlans] = useState([]);
  const [billing, setBilling] = useState("month");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch("/api/plans");
        const data = await res.json();
        setPlans(data);
      } catch (e) {
        console.error("Failed to load plans", e);
      } finally {
        setLoading(false);
      }
    }
    loadPlans();
  }, []);

  const visiblePlans = useMemo(
    () => plans.filter((p) => p.billingInterval === billing),
    [plans, billing]
  );

  const popularPlanId = useMemo(() => {
    const paid = visiblePlans.filter((p) => p.priceCents > 0);
    return paid.length ? paid[paid.length - 1].id : null;
  }, [visiblePlans]);

  return (
    <section id="pricing" className="py-24 relative overflow-hidden bg-secondary/40">
      {/* Background accents */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary-100/40 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-100/40 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4">
            Simple, storage-based pricing
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Upgrade only when you need more space. Unlimited questions on all plans.
          </p>
        </motion.div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex rounded-full border border-border bg-card p-1">
            {["month", "year"].map((value) => (
              <button
                key={value}
                onClick={() => setBilling(value)}
                className={`px-4 py-1.5 text-sm rounded-full transition-all ${
                  billing === value
                    ? "bg-primary-600 text-white shadow-md"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {value === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div
          className="
            grid
            grid-cols-[repeat(auto-fit,minmax(280px,1fr))]
            gap-8
            max-w-5xl
            mx-auto
            items-stretch
          "
        >
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <PricingSkeleton key={i} />
              ))
            : visiblePlans.map((plan) => {
                const isPopular = plan.id === popularPlanId;
                const price =
                  plan.priceCents === 0
                    ? "Free"
                    : `${plan.currency} ${(plan.priceCents / 100).toFixed(2)}`;

                return (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.45 }}
                    className="h-full"
                  >
                    <Card
                      className={`
                        h-full bg-card border
                        ${isPopular
                          ? "border-primary-400"
                          : "border-slate-200 dark:border-slate-700"}
                        transition-all duration-300
                        hover:-translate-y-1
                        hover:shadow-[0_12px_30px_rgba(59,130,246,0.12)]
                        dark:hover:shadow-[0_12px_30px_rgba(59,130,246,0.25)]
                        relative
                      `}
                    >
                      {isPopular && (
                        <div className="absolute top-4 right-4 flex items-center gap-1 text-xs font-semibold bg-primary-600 text-white px-3 py-1 rounded-full shadow-md">
                          <Sparkles className="w-3 h-3" />
                          Popular
                        </div>
                      )}

                      <CardContent className="p-6 flex flex-col h-full">
                        <div className="mb-6">
                          <h3 className="text-2xl font-semibold text-foreground mb-1">
                            {plan.name}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {plan.description}
                          </p>
                        </div>

                        <div className="mb-6">
                          <span className="text-4xl font-bold text-foreground">
                            {price}
                          </span>
                          {plan.priceCents > 0 && (
                            <span className="text-muted-foreground">
                              /{plan.billingInterval}
                            </span>
                          )}
                        </div>

                        <ul className="space-y-3 mb-8 flex-grow">
                          <li className="flex gap-3 text-sm text-muted-foreground">
                            <Check className="w-4 h-4 text-primary-600" />
                            {plan.storageLimitGb} GB storage
                          </li>
                          <li className="flex gap-3 text-sm text-muted-foreground">
                            <Check className="w-4 h-4 text-primary-600" />
                            Secure cloud storage
                          </li>
                          <li className="flex gap-3 text-sm text-muted-foreground">
                            <Check className="w-4 h-4 text-primary-600" />
                            Multi-device access
                          </li>
                          <li className="flex gap-3 text-sm text-muted-foreground">
                            <Check className="w-4 h-4 text-primary-600" />
                            Project-based organization
                          </li>
                          <li className="flex gap-3 text-sm text-muted-foreground">
                            <Check className="w-4 h-4 text-primary-600" />
                            Document & Project Chat
                          </li>
                          <li className="flex gap-3 text-sm text-muted-foreground">
                            <Check className="w-4 h-4 text-primary-600" />
                            Encrypted cloud processing
                          </li>
                        </ul>

                        <Button
                          onClick={() => router.push("/auth/signup")}
                          variant={isPopular ? "default" : "outline"}
                          className={isPopular ? "bg-primary-600 hover:opacity-90" : ""}
                        >
                          {plan.priceCents === 0 ? "Get Started" : "Sign Up Now"}
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
        </div>
      </div>
    </section>
  );
}
