"use client";

import React, { useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useBreadcrumbContext } from "@/components/breadcrumb-context";

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  settings: "Settings",
};

interface BreadcrumbEntry {
  label: string;
  href: string;
}

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str
  );
}

function isDetailId(str: string): boolean {
  return isUuid(str) || /^\d+$/.test(str);
}

function buildBreadcrumbs(
  pathname: string,
  currentLabel: string | null
): BreadcrumbEntry[] {
  const segments = pathname.split("/").filter(Boolean);
  const entries: BreadcrumbEntry[] = [];
  let currentPath = "";

  segments.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const isLast = index === segments.length - 1;

    if (isDetailId(segment)) {
      entries.push({
        label: isLast && currentLabel ? currentLabel : "Details",
        href: currentPath,
      });
      return;
    }

    const label =
      ROUTE_LABELS[segment] ??
      segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");

    entries.push({ label, href: currentPath });
  });

  return entries;
}

export function PageBreadcrumbs() {
  const pathname = usePathname();
  const { currentLabel } = useBreadcrumbContext();

  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(pathname, currentLabel),
    [pathname, currentLabel]
  );

  // Dashboard — just show the single label, no links
  if (pathname === "/dashboard") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Dashboard</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  if (breadcrumbs.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {/* Home link */}
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/dashboard">Dashboard</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;

          // Skip dashboard if it appears in the path (already shown above)
          if (crumb.href === "/dashboard") return null;

          return (
            <React.Fragment key={crumb.href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
