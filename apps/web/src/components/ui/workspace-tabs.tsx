"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MODULE_TAB_CONTAINER_CLASS,
  ModuleTabBadge,
  ModuleTabDot,
  moduleTabTriggerClass,
  resolveModuleTabTone,
} from "@/components/ui/modern-tab-bar";
import type { ModuleTabItem } from "@/components/ui/module-tab-tones";
import { cn } from "@/lib/utils";

export type WorkspaceTabItem = ModuleTabItem;

export function WorkspaceTabs({
  value,
  onValueChange,
  items,
  children,
  className,
  "aria-label": ariaLabel = "Sections",
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: WorkspaceTabItem[];
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className={cn("gap-5", className)}
    >
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-[var(--surface)] to-transparent md:hidden"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-[var(--surface)] to-transparent md:hidden"
          aria-hidden
        />
        <TabsList
          aria-label={ariaLabel}
          className={cn(
            MODULE_TAB_CONTAINER_CLASS,
            "h-auto w-full justify-start gap-2 bg-transparent p-1 shadow-none",
          )}
        >
          {items.map((item, index) => {
            const toneKey = resolveModuleTabTone(item, index);
            const active = value === item.id;

            return (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className={cn(
                  moduleTabTriggerClass({ active, toneKey, size: "md" }),
                  "flex-none border-transparent bg-transparent text-inherit shadow-none ring-0 outline-none after:hidden",
                  "data-active:bg-transparent data-active:text-inherit data-active:shadow-none",
                )}
              >
                {active ? (
                  <ModuleTabDot toneKey={toneKey} />
                ) : item.icon ? (
                  <span className="shrink-0 opacity-70 [&_svg]:size-4 sm:[&_svg]:size-[18px]">
                    {item.icon}
                  </span>
                ) : null}
                <span>{item.label}</span>
                <ModuleTabBadge active={active}>{item.badge}</ModuleTabBadge>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      {children}
    </Tabs>
  );
}

export { TabsContent };
