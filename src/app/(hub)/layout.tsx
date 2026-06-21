import { AmbientBackground } from "@/components/layout/ambient-background";

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <AmbientBackground />
      <div className="relative mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </div>
    </div>
  );
}
