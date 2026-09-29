import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

// Both are self-hosted by vinext at build time (the CSP allows fonts only
// from this origin). DM Sans's optical-size axis sharpens small text.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
});

// DM Serif Display ships a single (400) weight: headings must not ask for
// bold, or browsers would synthesize a smeared faux-bold.
const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif-display",
  subsets: ["latin", "latin-ext"],
  weight: "400",
});

// Browser chrome follows the device theme (the page colours in globals.css);
// the page draws under the notch and home indicator and pads itself with
// safe-area insets.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f1f2" },
    { media: "(prefers-color-scheme: dark)", color: "#170511" },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
};

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
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32" },
        { url: "/icons/icon.svg", type: "image/svg+xml" },
      ],
      apple: "/icons/apple-touch-icon.png",
    },
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
          width: 1731,
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
        className={`${dmSans.variable} ${dmSerifDisplay.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
