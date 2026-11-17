import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kisan4U — Admin & Seller Dashboard",
  description: "Kisan4U admin and seller operations dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
