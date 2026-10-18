import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "San Doc Convert — PDFs & images, on your device",
  description:
    "Convert PDFs and images, merge documents, extract pages, and rotate PDFs in your browser. Your files stay on your device.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
