'use client';

import Image from 'next/image';
import Link from 'next/link';

type BrandLogoProps = {
  href?: string;
  className?: string;
  compact?: boolean;
  badgeLabel?: string | null;
};

export function BrandLogo({
  href = '/',
  className = '',
  compact = false,
  badgeLabel = 'CKB Testnet',
}: BrandLogoProps) {
  return (
    <Link href={href} className={`flex min-w-0 items-center gap-3 ${className}`.trim()}>
      <Image
        src={compact ? '/PA Symbol.svg' : '/PA Light.svg'}
        alt="PactAgent"
        width={compact ? 34 : 148}
        height={compact ? 38 : 34}
        className={compact ? 'h-9 w-auto shrink-0' : 'h-8 w-auto shrink-0 sm:h-9'}
        priority
      />
      {badgeLabel ? (
        <span className="hidden rounded-full border border-agent-border bg-agent-bg/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400 sm:inline-flex">
          {badgeLabel}
        </span>
      ) : null}
    </Link>
  );
}
