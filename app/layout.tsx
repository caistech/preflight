import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://preflight-phi.vercel.app';
const DISPLAY_NAME = 'Preflight';
const TAGLINE = 'Pre-submission triage for DA drawing sets';
const DESCRIPTION =
  "Drafter-led pre-submission triage. Drop in a PDF, get back a one-page sheet flagging known recurring issues against the project's accumulated knowledge — before the set leaves your desk.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: DISPLAY_NAME,
  description: DESCRIPTION,
  openGraph: {
    title: `${DISPLAY_NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: DISPLAY_NAME,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${DISPLAY_NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
  },
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
