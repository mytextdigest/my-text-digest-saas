"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/layout/Navbar";
import { motion } from "framer-motion";
import { 
  ArrowRight, Check, MessageSquare, ShieldCheck, 
  Layers, Database, Sparkles, Zap, Search, Lock
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import HeroSection from "@/components/home/HeroSection";
import TrustStrip from "@/components/home/TrustStrip";
import FeaturesSection from "@/components/home/FeaturesSection";
import HowItWorks from "@/components/home/HowItWorks";
import ChatComparison from "@/components/home/ChatComparison";
import PricingSection from "@/components/home/PricingSection";
import CTASection from "@/components/home/CTASection";
import Footer from "@/components/home/Footer";

export default function HomePage() {
  const [plans, setPlans] = useState([]);
  const [isYearly, setIsYearly] = useState(true);

  useEffect(() => {
    fetch("/api/plans")
      .then((res) => res.json())
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Page offset for fixed navbar */}
      <main className="pt-24">
        <HeroSection />
        <TrustStrip />
        <FeaturesSection />
        <HowItWorks />
        <ChatComparison />
        <PricingSection />
        <CTASection />
      </main>
      
      <Footer />
    </div>
  );
}

function TrustItem({ icon, text }) {
  return (
    <div className="flex items-center gap-2 text-sm font-bold tracking-tight text-foreground">
      <span className="text-primary-500">{icon}</span>
      {text}
    </div>
  );
}

function PricingCard({ plan, isYearly }) {
  const isFree = plan.priceCents === 0;
  const monthlyPrice = (plan.priceCents / 100).toFixed(2);
  const displayPrice = isFree ? "0" : isYearly ? (monthlyPrice * 0.8).toFixed(2) : monthlyPrice;

  return (
    <Card className={`p-8 bg-card border-border flex flex-col h-full hover:shadow-xl hover:shadow-primary-50 transition-all ${!isFree ? 'border-primary-100 ring-1 ring-primary-100' : ''}`}>
      <div className="mb-8">
        <h3 className="text-lg font-black uppercase tracking-widest text-primary-600 mb-2">{plan.name}</h3>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-black text-foreground">${displayPrice}</span>
          {!isFree && <span className="text-muted-foreground text-sm font-medium">/mo</span>}
        </div>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{plan.description}</p>
      </div>
      
      <div className="space-y-4 mb-8 flex-grow">
        <FeatureItem text={`${plan.storageLimitGb} GB Private Storage`} bold />
        <FeatureItem text="Unlimited Projects" />
        <FeatureItem text="Document + Project Chat" />
        <FeatureItem text="Persistent History" />
      </div>

      <Button className={`w-full h-12 rounded-xl font-bold transition-transform active:scale-95 ${isFree ? 'bg-secondary text-secondary-foreground hover:bg-muted' : 'bg-primary-500 text-white shadow-lg shadow-primary-100 hover:bg-primary-600'}`}>
        {isFree ? 'Get Started' : 'Go Pro'}
      </Button>
    </Card>
  );
}

function FeatureItem({ text, bold = false }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex-shrink-0">
        <div className="h-4 w-4 rounded-full bg-success-100 flex items-center justify-center">
          <Check size={10} className="text-success-600" />
        </div>
      </div>
      <span className={`text-sm ${bold ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{text}</span>
    </div>
  );
}