"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Archive,
  Database,
  Link2,
  ListChecks,
  PanelsTopLeft,
  Search,
  Target,
} from "lucide-react";
import { SpeedCoreLogo } from "@/components/speed-core-logo";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Tổng quan", icon: PanelsTopLeft },
  { href: "/crawler-url", label: "Cào Dork & Crawl URL", icon: Search },
  { href: "/backlink-opportunities", label: "Cơ hội Backlink", icon: Target },
  { href: "/url-storage", label: "Kho URL", icon: Archive },
  { href: "/url-extractor", label: "Nạp URL & Trích domain", icon: Link2 },
  { href: "/resources", label: "Tài nguyên", icon: Database },
  { href: "/register-forum", label: "Đăng ký diễn đàn", icon: ListChecks },
];

export function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-white">
      <aside className="fixed inset-y-0 left-0 z-20 w-[250px] border-r border-border bg-[#060b13]">
        <div className="flex py-6 px-3 items-center">
          <SpeedCoreLogo size="sm" subtitle="Internal SEO Tool" href="/" />
        </div>
        <div className="px-2 pt-4">
          <div className="mb-2 px-2 text-xs font-semibold text-muted">Vận hành</div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-h-8 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white transition",
                    active ? "bg-[#162130]" : "hover:bg-[#101823]",
                  )}
                >
                  <Icon size={17} className="text-slate-200" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

      </aside>
      <main className="min-h-screen min-w-0 pl-[250px]">
        <header className="flex h-10 items-center gap-3 border-b border-border bg-panel2 px-5 text-sm text-muted">
          <Activity size={16} />
          <span>{title}</span>
        </header>
        <div className="min-w-0 px-6 py-7">{children}</div>
      </main>
    </div>
  );
}
