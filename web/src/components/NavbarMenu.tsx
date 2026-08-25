'use client';

import { ReactNode, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { WalletConnect } from '@/features/wallet';

export function NavbarMenu({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="hidden items-center gap-3 lg:flex">
        <div className="flex items-center gap-1.5 rounded-full border border-agent-border bg-agent-bg/55 p-1">
          {children}
        </div>
        <WalletConnect compact />
      </div>
      <button
        type="button"
        className="ui-icon-button lg:hidden"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open ? (
        <div className="ui-mobile-panel fixed inset-x-3 top-[5.25rem] z-[75] mx-auto max-w-md lg:hidden">
          <div className="mb-3 flex flex-wrap gap-2" onClick={() => setOpen(false)}>{children}</div>
          <WalletConnect />
        </div>
      ) : null}
    </>
  );
}
