import type { Metadata } from "next";
import "./globals.css";
import "./access.css";
import "./advanced.css";
export const metadata: Metadata = { title: "Source — Créateur de flux RSS", description: "Transformez une page publique en flux RSS, localement." };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="fr"><body>{children}</body></html>; }
