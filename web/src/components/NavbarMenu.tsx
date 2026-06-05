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
      <div className="hidden items-center gap-3 lg:flex">
        <div className="flex items-center gap-1.5 rounded-full border border-agent-border bg-agent-bg/55 p-1">
          {children}
          <LinkButton href="/settings/profile" label="Profile" />
          <LinkButton href="/settings/webhooks" label="Webhooks" />
        </div>
        <WalletConnect compact />
      </div>

      <div className="relative lg:hidden">
        <button
          type="button"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setOpen((value) => !value)}
          data-open={open ? 'true' : 'false'}
          className="ui-icon-button relative z-50"
        >
          {open ? (
            <svg className="h-6 w-6 drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
            <div className="ui-mobile-panel absolute right-0 top-full z-50 mt-3 w-[min(18rem,calc(100vw-2rem))]">
              <div className="mb-4 flex flex-col items-stretch gap-2 border-b border-white/10 pb-4 text-sm">
                {children}
                <LinkButton href="/settings/profile" label="Profile" />
                <LinkButton href="/settings/webhooks" label="Webhooks" />
              </div>
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

function LinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="app-nav-link">
      {label}
    </a>
  );
}
