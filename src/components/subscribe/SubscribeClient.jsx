"use client";

import { useState } from "react";
import Layout from "../layout/Layout";
import SubscriptionLayout from "../layout/SubscriptionLayout";

export default function SubscribeClient({ plans }) {
  const [interval, setInterval] = useState("month"); // month | year

  const filteredPlans = plans.filter(
    (plan) => plan.billingInterval === interval
  );

  return (
    <SubscriptionLayout>
      <div className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-6">Choose a Plan</h1>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-lg border p-1">
            <button
              onClick={() => setInterval("month")}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                interval === "month"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setInterval("year")}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                interval === "year"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600"
              }`}
            >
              Yearly
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPlans.map((plan) => (
            <div key={plan.id} className="border p-6 rounded-lg">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="text-sm text-gray-500">{plan.description}</p>

              <p className="mt-3">
                Storage: <strong>{plan.storageLimitGb} GB</strong>
              </p>

              <p className="mt-4 text-2xl font-bold">
                ${(plan.priceCents / 100).toFixed(2)}
                <span className="text-sm font-normal text-gray-500">
                  {" "}
                  / {plan.billingInterval}
                </span>
              </p>

              <button
                onClick={async () => {
                  const res = await fetch("/api/stripe/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ planId: plan.id })
                  });

                  const data = await res.json();
                  window.location.href = data.url;
                }}
                className="mt-6 w-full bg-blue-600 text-white py-2 rounded-md"
              >
                Subscribe
              </button>
            </div>
          ))}
        </div>
      </div>
    </SubscriptionLayout>
    
  );
}
