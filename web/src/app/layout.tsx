import type { Metadata } from 'next';
import './globals.css';
import { CccProvider } from '@/features/wallet';

export const metadata: Metadata = {
  title: 'PactAgent — Autonomous Payment Agreements on CKB',
  description: 'AI-powered agent for milestone-based payment agreements on Nervos CKB',
  icons: {
    icon: '/PA Symbol.svg',
    shortcut: '/PA Symbol.svg',
    apple: '/PA Symbol.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-agent-bg text-gray-100 antialiased">
        <CccProvider>{children}</CccProvider>
      </body>
    </html>
  );
}
