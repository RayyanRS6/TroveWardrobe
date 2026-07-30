import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;

  return {
    metadataBase: new URL(baseUrl),
    title: "Trove — Your wardrobe, remembered",
    description:
      "Organize your clothes, build outfits, and remember everything you own.",
    manifest: "/manifest.webmanifest",
    themeColor: "#f5f1e9",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Trove",
    },
    openGraph: {
      title: "Trove — Your wardrobe, remembered",
      description:
        "Organize your clothes, build outfits, and remember everything you own.",
      type: "website",
      images: [
        {
          url: `${baseUrl}/og.png`,
          width: 1733,
          height: 909,
          alt: "Trove wardrobe organizer",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Trove — Your wardrobe, remembered",
      description:
        "Organize your clothes, build outfits, and remember everything you own.",
      images: [`${baseUrl}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
