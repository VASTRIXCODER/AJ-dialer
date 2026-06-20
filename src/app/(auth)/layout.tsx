import { AmbientBackground } from "@/components/layout/ambient-background";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <AmbientBackground />
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}
