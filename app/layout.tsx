import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Preflight — pre-submission triage for DA drawing sets',
  description:
    'Drafter-led pre-submission triage. Drop in a PDF, get back a one-page sheet flagging known recurring issues against the project\'s accumulated knowledge — before the set leaves your desk.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
