import type { Metadata } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { PwaStandaloneProvider } from "@/components/pwa/PwaStandaloneProvider";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";
import { cn } from "@/lib/utils";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans-face",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-display-face",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BHB International ERP",
    template: "%s · BHB International",
  },
  description:
    "School ERP for BHB International School — fees, SIS, attendance, accounts.",
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: "/logo.png",
  },
  other: {
    "theme-color": "#203050",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", plusJakarta.variable)}
    >
      <body
        className={`${plusJakarta.variable} ${fraunces.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeScript />
        <PwaStandaloneProvider />
        {children}
      </body>
    </html>
  );
}
