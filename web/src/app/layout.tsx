import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { RunWatcher } from "@/components/shell/RunWatcher";
import { ShortcutHelp } from "@/components/shell/ShortcutHelp";
import { TopBar } from "@/components/shell/TopBar";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Mosaic GCS", template: "%s · Mosaic GCS" },
  description: "UAV video mosaicking pipeline — upload, monitor, inspect.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#eef0f3" },
  ],
};

// Applies the stored theme before first paint (dark is the default, not the OS preference).
const themeScript = `(function(){try{var t=localStorage.getItem("uav-theme")||"dark";if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <TopBar />
        <main className="mx-auto w-full max-w-[1680px] px-3 pt-3 pb-8 sm:px-4">{children}</main>
        <Toaster />
        <RunWatcher />
        <ShortcutHelp />
      </body>
    </html>
  );
}
