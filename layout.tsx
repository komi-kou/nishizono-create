import type { Metadata } from "next";
import { Inter } from "next/font/google";
import '../globals.css';
import { Providers } from '../providers';
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Task Management Tool',
  description: 'Cursor management application',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={inter.className}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
