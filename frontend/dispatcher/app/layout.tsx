import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FreightProof SA — Dispatcher",
  description: "Cargo theft and disputed delivery evidence platform — dispatcher console",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
