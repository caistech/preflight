'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LayoutGrid, FileCheck, Settings, LogOut, Menu, X } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Icon: any;
  /** Optional unread / pending count rendered as a small pill. */
  badge?: number;
}

interface Props {
  email: string | null;
  pendingReviewCount: number;
}

export function Sidebar({ email, pendingReviewCount }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const navItems: NavItem[] = [
    { href: '/projects', label: 'Projects', Icon: LayoutGrid },
    { href: '/reviews', label: 'Reviews', Icon: FileCheck, badge: pendingReviewCount },
    { href: '/settings', label: 'Settings', Icon: Settings },
  ];

  const navContent = (
    <>
      <div className="px-4 py-5">
        <Link
          href="/projects"
          className="block text-lg font-semibold text-gray-100"
          onClick={() => setMobileOpen(false)}
        >
          Preflight
          <span className="block text-xs font-normal text-gray-500">DA pre-submission triage</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-gray-300 hover:bg-gray-800/60 hover:text-gray-100'
              }`}
            >
              <item.Icon size={16} />
              <span className="flex-1">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-mono text-amber-200">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-gray-800 px-2 py-3">
        {email && (
          <div className="mb-2 px-3 text-xs text-gray-500" title={email}>
            <span className="block truncate">{email}</span>
          </div>
        )}
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800/60 hover:text-red-400"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger — visible below md */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="fixed left-4 top-4 z-30 rounded-lg border border-gray-700 bg-gray-900/80 p-2 text-gray-300 backdrop-blur md:hidden"
      >
        <Menu size={18} />
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-gray-950/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-gray-900 shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 rounded p-1 text-gray-400 hover:text-gray-100"
            >
              <X size={18} />
            </button>
            {navContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar — fixed left rail */}
      <aside className="hidden h-screen w-60 flex-col border-r border-gray-800 bg-gray-900/30 md:fixed md:inset-y-0 md:left-0 md:flex">
        {navContent}
      </aside>
    </>
  );
}
