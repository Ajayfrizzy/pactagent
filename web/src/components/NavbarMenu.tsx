'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  CircleEllipsisIcon,
  CircleUserIcon,
  FileInputIcon,
  HomeIcon,
  LayoutDashboardIcon,
  MenuIcon,
  ShieldCheckIcon,
  WebhookIcon,
} from './Icons';
import { WalletConnect } from './WalletConnect';
import { useStore } from '@/lib/store';

export function NavbarMenu({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isAdmin = useStore((s) => s.isAdmin);
  const homeActive = !open && pathname === '/';
  const dashboardActive = !open && (pathname === '/dashboard'
    || (pathname.startsWith('/agreement/') && pathname !== '/agreement/import-bounty'));
  const importActive = !open && pathname === '/agreement/import-bounty';
  const profileActive = !open && (pathname === '/settings/profile' || pathname.startsWith('/profiles/'));
  const moreActive = open || pathname === '/settings/webhooks' || pathname === '/admin';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpen(false);
    setWalletOpen(false);
  }, [pathname]);

  function closeMobilePanels() {
    setOpen(false);
    setWalletOpen(false);
  }

  const mobileNavigation = (
    <>
      {open || walletOpen ? (
        <div
          className="fixed inset-0 z-[65] bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
          onClick={closeMobilePanels}
          aria-hidden="true"
        />
      ) : null}

      {walletOpen ? (
        <div className="ui-mobile-panel fixed inset-x-3 top-[5.25rem] z-[75] mx-auto max-w-md lg:hidden">
          <WalletConnect />
        </div>
      ) : null}

      {open ? (
        <div className="ui-mobile-panel fixed inset-x-3 bottom-[calc(5.9rem+env(safe-area-inset-bottom))] z-[75] mx-auto max-w-md lg:hidden">
          <div className="flex flex-col items-stretch gap-2 text-sm">
            <MorePanelLink
              href="/settings/webhooks"
              label="Webhooks"
              icon={<WebhookIcon className="h-4 w-4" />}
              onNavigate={closeMobilePanels}
            />
            {isAdmin ? (
              <MorePanelLink
                href="/admin"
                label="Admin"
                icon={<ShieldCheckIcon className="h-4 w-4" />}
                onNavigate={closeMobilePanels}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <nav className="app-bottom-nav lg:hidden" aria-label="Primary mobile navigation">
        <MobileNavLink
          href="/"
          label="Home"
          active={homeActive}
          icon={<HomeIcon className="h-5 w-5" />}
          onNavigate={closeMobilePanels}
        />
        <MobileNavLink
          href="/dashboard"
          label="Dash"
          active={dashboardActive}
          icon={<LayoutDashboardIcon className="h-5 w-5" />}
          onNavigate={closeMobilePanels}
        />
        <MobileNavLink
          href="/agreement/import-bounty"
          label="Import"
          active={importActive}
          icon={<FileInputIcon className="h-5 w-5" />}
          onNavigate={closeMobilePanels}
        />
        <MobileNavLink
          href="/settings/profile"
          label="Profile"
          active={profileActive}
          icon={<CircleUserIcon className="h-5 w-5" />}
          onNavigate={closeMobilePanels}
        />
        <button
          type="button"
          aria-label={open ? 'Close more menu' : 'Open more menu'}
          aria-expanded={open}
          onClick={() => {
            setWalletOpen(false);
            setOpen((value) => !value);
          }}
          data-active={moreActive ? 'true' : 'false'}
          className="app-bottom-nav-item"
        >
          <span className="app-bottom-nav-icon">
            <CircleEllipsisIcon className="h-5 w-5" />
          </span>
          <span className="app-bottom-nav-label">More</span>
        </button>
      </nav>
    </>
  );

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
      <div className="flex items-center lg:hidden">
        <button
          type="button"
          aria-label={walletOpen ? 'Close wallet menu' : 'Open wallet menu'}
          aria-expanded={walletOpen}
          onClick={() => {
            setOpen(false);
            setWalletOpen((value) => !value);
          }}
          className="ui-icon-button"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      {mounted ? createPortal(mobileNavigation, document.body) : null}
    </>
  );
}

function LinkButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="app-nav-link">
      {label}
    </Link>
  );
}

function MorePanelLink({
  href,
  label,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate} className="app-more-panel-link">
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function MobileNavLink({
  href,
  label,
  active,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : 'false'}
      className="app-bottom-nav-item"
    >
      <span className="app-bottom-nav-icon">{icon}</span>
      <span className="app-bottom-nav-label">{label}</span>
    </Link>
  );
}
