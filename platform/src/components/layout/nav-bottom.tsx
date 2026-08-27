'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavBottomProps {
  items: NavItem[];
}

export function NavBottom({ items }: NavBottomProps) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
      style={{ backgroundColor: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex-1 flex flex-col items-center gap-1 py-2.5 px-1 transition-colors',
                isActive ? 'text-[var(--brand-primary)]' : 'text-gray-400 hover:text-gray-600',
              )}
            >
              <Icon
                className={cn('h-5 w-5', isActive ? 'stroke-[2.5]' : 'stroke-[1.5]')}
              />
              <span className={cn('text-[10px]', isActive ? 'font-semibold' : 'font-normal')}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default NavBottom;
