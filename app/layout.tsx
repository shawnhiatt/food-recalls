import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { BottomNav } from "@/components/BottomNav";
import { Header } from "@/components/Header";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Food Recalls",
  description: "Recalls that actually apply to you.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Food Recalls",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2b7ea7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" className={publicSans.variable}>
        <body>
          <ConvexClientProvider>
            <Header />
            <div
              className="mx-auto max-w-lg"
              style={{ paddingBottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
            >
              {children}
            </div>
            <BottomNav />
          </ConvexClientProvider>
          <ServiceWorkerRegister />
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
