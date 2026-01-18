'use client';

import { useEffect, useState } from 'react';
import Layout from '@/components/layout/Layout';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';

export default function ManageSubscriptionPage() {
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [plansRes, subRes] = await Promise.all([
        fetch('/api/plans'),
        fetch('/api/subscription')
      ]);

      const plansData = await plansRes.json();
      const subData = await subRes.json();

      setPlans(plansData);
      setSubscription(subData);
    } catch (err) {
      console.error('Failed to load subscription data', err);
    } finally {
      setLoading(false);
    }
  }

  const currentPlan = subscription?.plan;

  return (


  <Layout>
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Manage Subscription
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Upgrade your plan or manage billing
        </p>
      </div>

      {/* Stripe Portal Button */}
      <div className="flex justify-center mb-10">
        <Button
          variant="outline"
          onClick={async () => {
            const res = await fetch('/api/stripe/portal', { method: 'POST' });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
          }}
        >
          Manage billing & payment
        </Button>
      </div>

      {loading && <p className="text-center">Loading plans...</p>}

      {!loading && (
        <div className="flex justify-center">
          <div
            className="
              grid gap-6
              w-full
              max-w-4xl
              grid-cols-[repeat(auto-fit,minmax(280px,1fr))]
            "
          >
            {plans.map((plan) => {
              const isCurrent =
                currentPlan && plan.id === currentPlan.id;

              const isLowerOrSame =
                currentPlan &&
                plan.storageLimitGb <= currentPlan.storageLimitGb;

              const disabled = isLowerOrSame;

              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border rounded-lg p-6 bg-white dark:bg-gray-900"
                >
                  <h2 className="text-lg font-semibold mb-1">
                    {plan.name}
                  </h2>

                  <p className="text-sm text-gray-500 mb-4">
                    {plan.description}
                  </p>

                  <p className="text-sm mb-2">
                    <strong>{plan.storageLimitGb} GB</strong> storage
                  </p>

                  <p className="text-xl font-bold mb-6">
                    ${(plan.priceCents / 100).toFixed(2)}
                    <span className="text-sm font-normal text-gray-500">
                      {' '} / {plan.billingInterval}
                    </span>
                  </p>

                  {isCurrent ? (
                    <Button disabled className="w-full">
                      Current Plan
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={disabled}
                      onClick={async () => {
                        const res = await fetch('/api/stripe/portal', {
                          method: 'POST'
                        });
                        const data = await res.json();
                        if (data.url) window.location.href = data.url;
                      }}
                    >
                      {disabled ? 'Not Available' : 'Upgrade'}
                    </Button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  </Layout>
  );
}
