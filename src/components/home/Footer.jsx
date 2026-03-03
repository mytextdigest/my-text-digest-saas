import { FileText, Github, Twitter, Mail } from "lucide-react";
import Link from "next/link";

const footerLinks = {
  product: [
    { name: "Features", href: "/features" },
    { name: "Pricing", href: "/pricing" },
    { name: "Changelog", href: "/changelog" },
  ],
  resources: [
    { name: "Help Center", href: "/help" },
    { name: "Documentation", href: "/docs" },
    { name: "API", href: "/api" },
  ],
  company: [
    { name: "About", href: "/about" },
    { name: "Blog", href: "/blog" },
    { name: "Contact", href: "/contact" },
  ],
  legal: [
    { name: "Privacy", href: "/privacy" },
    { name: "Terms", href: "/terms" },
  ],
};

export default function Footer() {
  return (
    <footer className="bg-secondary/50 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8">
          {/* Brand */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-3 group mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-serif text-lg font-semibold text-foreground">
                My Text Digest
              </span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs mb-6">
              Privacy-first document intelligence. Turn your documents into organized, searchable knowledge.
            </p>
            <div className="flex items-center gap-4">
              <a 
                href="https://twitter.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-background border border-border flex items-center justify-center hover:border-primary/50 transition-colors"
              >
                <Twitter className="w-4 h-4 text-muted-foreground" />
              </a>
              <a 
                href="https://github.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-background border border-border flex items-center justify-center hover:border-primary/50 transition-colors"
              >
                <Github className="w-4 h-4 text-muted-foreground" />
              </a>
              <a 
                href="mailto:hello@mytextdigest.com"
                className="w-9 h-9 rounded-lg bg-background border border-border flex items-center justify-center hover:border-primary/50 transition-colors"
              >
                <Mail className="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-semibold text-foreground mb-4">Product</h4>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.name}>
                  <Link 
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Resources</h4>
            <ul className="space-y-3">
              {footerLinks.resources.map((link) => (
                <li key={link.name}>
                  <Link 
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Company</h4>
            <ul className="space-y-3">
              {footerLinks.company.map((link) => (
                <li key={link.name}>
                  <Link 
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Legal</h4>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.name}>
                  <Link 
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} My Text Digest. All rights reserved.
          </p>
          <p className="text-sm text-muted-foreground">
            Made with care for knowledge workers everywhere.
          </p>
        </div>
      </div>
    </footer>
  );
}