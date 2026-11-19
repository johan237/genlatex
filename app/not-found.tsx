import type { Metadata } from "next";
import Link from "next/link";
import Navigation from "@/components/layout/Navigation";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Page not found | GenLaTeX",
  description: "The page you are looking for could not be found.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col">
      <Navigation />
      <section className="flex-1 flex items-center justify-center pt-32 pb-24 px-6">
        <div className="relative max-w-hero mx-auto text-center">
          <p className="font-heading text-[8rem] md:text-[10rem] font-bold bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent opacity-80 leading-none">
            404
          </p>
          <h1 className="font-heading text-2xl md:text-3xl font-semibold text-foreground mt-4 mb-2">
            Page not found
          </h1>
          <p className="text-secondary max-w-md mx-auto mb-8">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent px-6 py-3 text-sm font-medium text-white shadow-lg shadow-primary/30 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-opacity"
          >
            Back to home
          </Link>
        </div>
      </section>
      <Footer />
    </main>
  );
}
