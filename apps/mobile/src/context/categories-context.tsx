import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getCategories } from "@/lib/api/catalog";
import { useLanguage } from "@/context/language-context";
import type { CategoryNode } from "@/lib/api/types";

/**
 * Top-level categories, fetched once, so the sticky category ribbon can be
 * mounted in the shared chrome (every screen except the PDP, per
 * katra4u-storefront-spec.md §1.3) without each screen re-fetching. Re-runs
 * when the content language changes.
 */

const Ctx = createContext<CategoryNode[]>([]);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const { lang, dbLang } = useLanguage();
  const [categories, setCategories] = useState<CategoryNode[]>([]);

  useEffect(() => {
    let alive = true;
    getCategories(dbLang).then((res) => {
      if (alive && res.ok) setCategories(res.data.categories);
    });
    return () => {
      alive = false;
    };
  }, [lang, dbLang]);

  return <Ctx.Provider value={categories}>{children}</Ctx.Provider>;
}

export function useCategories(): CategoryNode[] {
  return useContext(Ctx);
}
