import type { Metadata } from "next";
import { Lexend_Deca, Roboto_Mono } from "next/font/google";
import "./globals.css";

// Same faces Monkeytype ships by default: Roboto Mono for everything, Lexend Deca for the wordmark.
const robotoMono = Roboto_Mono({ variable: "--font-roboto-mono", subsets: ["latin"] });
const lexendDeca = Lexend_Deca({ variable: "--font-lexend-deca", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TypeDuel | a minimalistic typing test",
  description: "A minimalistic typing test with 1v1 races.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${robotoMono.variable} ${lexendDeca.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
