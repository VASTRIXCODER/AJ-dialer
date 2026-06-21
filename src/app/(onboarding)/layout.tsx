import { AmbientBackground } from "@/components/layout/ambient-background";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-4 sm:p-6">
      <AmbientBackground />
      <div className="relative w-full max-w-xl">{children}</div>
    </div>
  );
}
