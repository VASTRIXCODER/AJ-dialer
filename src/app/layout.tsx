import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { MotionProvider } from "@/components/motion/motion-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const DESCRIPTION =
  "A powerful multichannel sales dialer, CRM, and team performance platform for any outbound sales team — power dialing, call intelligence, lead management, live monitoring, and leaderboards for only $30 per seat.";

export const metadata: Metadata = {
  title: {
    default: "AIATWORK · Sales Dialer, CRM & Team Performance Platform",
    template: "%s · AIATWORK",
  },
  description: DESCRIPTION,
  applicationName: "AIATWORK Sales Platform",
  // icon.svg, apple-icon.png and opengraph-image.jpg sit beside this file and
  // are picked up by convention — the product shipped with none of them, so
  // every tab was a blank page glyph and every shared link an empty card.
  openGraph: {
    type: "website",
    siteName: "AIATWORK",
    title: "AIATWORK · Sales Dialer, CRM & Team Performance Platform",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  // These paint the browser and OS chrome around the app, so they have to be
  // the actual app ground — --surface-void in each theme. They were #F3F6FB
  // and #070A12, from a palette that no longer exists.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F7F9" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0B0D" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <MotionProvider>
            <ToastProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
            </ToastProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
