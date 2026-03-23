"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface BreadcrumbContextType {
  currentLabel: string | null;
  setCurrentLabel: (label: string | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextType>({
  currentLabel: null,
  setCurrentLabel: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);

  return (
    <BreadcrumbContext.Provider value={{ currentLabel, setCurrentLabel }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbContext() {
  return useContext(BreadcrumbContext);
}

/**
 * Sets the breadcrumb label for the current page (e.g. entity name on detail pages).
 * Automatically clears on unmount.
 */
export function useBreadcrumbLabel(label: string | undefined | null) {
  const { setCurrentLabel } = useContext(BreadcrumbContext);

  useEffect(() => {
    if (label) {
      setCurrentLabel(label);
    }
    return () => {
      setCurrentLabel(null);
    };
  }, [label, setCurrentLabel]);
}
