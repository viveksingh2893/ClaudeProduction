import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getCart } from "@/lib/api/cart";
import { useAuth } from "@/context/auth-context";

/**
 * A tiny always-mounted view of "how many distinct items are in the cart",
 * so the bottom-nav Cart tab can carry a live badge (mirrors the web
 * storefront's cart-count badge). Any screen that changes the cart —
 * add-to-cart from a card / PDP / quick-add, or a quantity/remove on the
 * cart screen — calls `refresh()` afterwards. The cart itself is always
 * server-side (a guest has a real server cart too), so this is just a
 * count, never the source of truth for the cart contents.
 */
type CartCtx = { count: number; refresh: () => Promise<void> };

const Ctx = createContext<CartCtx>({ count: 0, refresh: async () => {} });

export function CartProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (status !== "authenticated") {
      setCount(0);
      return;
    }
    const res = await getCart();
    if (res.ok) {
      setCount(res.data.sellerGroups.reduce((total, g) => total + g.items.length, 0));
    } else {
      // A seller (no buyer cart) or a transient error — don't clobber a
      // known-good count with 0 on a blip; only reset when signed out.
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh, user?.id]);

  const value = useMemo<CartCtx>(() => ({ count, refresh }), [count, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartCtx {
  return useContext(Ctx);
}
