"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { Separator } from "@/components/ui/separator";
import { UserButton } from "./user-button";
import { BreadcrumbProvider } from "./breadcrumb-context";
import { PageBreadcrumbs } from "./page-breadcrumbs";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <BreadcrumbProvider>
      <SidebarProvider>
        <AppSidebar />
        <main className="flex-1 flex flex-col min-h-svh">
          <header className="flex h-14 items-center gap-4 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-6" />
            <PageBreadcrumbs />
            <div className="ml-auto">
              <UserButton />
            </div>
          </header>
          <div className="flex-1 p-6">{children}</div>
        </main>
      </SidebarProvider>
    </BreadcrumbProvider>
  );
}
