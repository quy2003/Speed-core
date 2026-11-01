import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Speed Core - Backlink Console",
  description: "Internal SEO automation console",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
