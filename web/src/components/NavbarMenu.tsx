'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { WalletConnect } from './WalletConnect';

export function NavbarMenu({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="hidden md:flex items-center gap-4">
        {children}
        <WalletConnect />
      </div>

      <div className="relative md:hidden">
        <button
          type="button"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-agent-accent/40 bg-slate-900/90 text-white shadow-lg shadow-black/30 transition-colors hover:border-agent-accent hover:bg-slate-900"
        >
          {open ? (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden="true" />
            <div className="absolute right-0 top-full z-50 mt-3 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-agent-accent/35 bg-slate-900/95 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.55)] ring-1 ring-white/10 backdrop-blur">
              {children ? (
                <div className="mb-4 flex flex-col items-stretch gap-2 border-b border-white/10 pb-4 text-sm">
                  {children}
                </div>
              ) : null}
              <div className="flex flex-col items-stretch gap-3">
                <WalletConnect />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
