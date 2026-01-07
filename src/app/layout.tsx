import type { Metadata } from "next";
import "./globals.css";

import { DM_Mono } from "next/font/google";

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mechaverse",
  description:
    "Upload and view your MJCF, URDF, and USD robots and environments in a 3D environment.",
  openGraph: {
    title: "Mechaverse",
    description:
      "Upload and view your MJCF, URDF, and USD robots and environments in a 3D environment.",
    url: "https://mechaverse.dev",
    siteName: "Mechaverse",
    images: [
      { url: "https://mechaverse.dev/og.jpeg", width: 4518, height: 2567 },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`min-h-screen bg-background text-foreground ${dmMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
