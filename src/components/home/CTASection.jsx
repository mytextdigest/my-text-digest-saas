import { motion } from "framer-motion";
import { ArrowRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";

export default function CTASection() {
  const router = useRouter();
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          {/* Card */}
          <div className="relative bg-primary-600 rounded-3xl p-12 md:p-16 text-center overflow-hidden shadow-glow">
            {/* Background Pattern */}
            <div 
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
                backgroundSize: '32px 32px'
              }}
            />

            {/* Floating Icons */}
            <div className="absolute top-8 left-8 opacity-20">
              <FileText className="w-16 h-16 text-primary-foreground" />
            </div>
            <div className="absolute bottom-8 right-8 opacity-20">
              <FileText className="w-12 h-12 text-primary-foreground" />
            </div>

            <div className="relative z-10">
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-primary-foreground mb-4"
              >
                Turn documents into knowledge
              </motion.h2>
              
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="text-lg text-primary-foreground/80 max-w-xl mx-auto mb-8"
              >
                Start free. No credit card required. Your documents, your control.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.3 }}
              >
                
                  <Button 
                    onClick={() => router.push("/register")}
                    size="lg" 
                    className="bg-background text-foreground hover:bg-background/90 px-8 py-6 text-base font-medium shadow-medium group"
                  >
                    Get Started Now
                    <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}