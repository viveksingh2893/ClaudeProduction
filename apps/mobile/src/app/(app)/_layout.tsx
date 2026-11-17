import { Redirect, Stack, useGlobalSearchParams, useSegments } from "expo-router";
import { AppChrome } from "@/components/AppChrome";
import { AppBottomBar } from "@/components/AppBottomBar";
import { useAuth } from "@/context/auth-context";

/**
 * The app opens on the login screen ((auth)/welcome). Reaching this group
 * unauthenticated (no token yet, or after logout / an expired session)
 * bounces back there — but "Continue as guest" on that screen mints a
 * guest session, which counts as authenticated, so a guest browses the
 * whole storefront and only verifies a mobile number at checkout. Guests
 * only ever see the customer catalogue; the dealer/seller gates below
 * still apply to a real dealer/seller account.
 */

/** Sub-screens where the sticky category ribbon is hidden — checkout kept clean, and the search screen has its own input so the ribbon would just push it down. The PDP used to be hidden too (katra4u-storefront-spec.md §6.1) but now shows the ribbon like every other screen, matching the website. */
const NO_CATEGORY_RIBBON = new Set(["checkout", "search"]);

/**
 * Non-`(tabs)` sub-screens that still get the floating bottom nav pill, so
 * the storefront's Home / Kisan4U Doctor / Cart / Account bar stays
 * visible while browsing categories/subcategories (which are pushed Stack
 * screens, not tabs). None of the pill items map to these screens, so
 * nothing lights up — same as browsing any other pushed screen.
 */
const BOTTOM_BAR_SCREENS = new Set(["category", "brand"]);

export default function AppLayout() {
  const { status, user, dealerStatus, sellerStatus } = useAuth();
  const segments = useSegments();
  const params = useGlobalSearchParams<{ slug?: string; subCategory?: string }>();

  if (status === "loading") return null;
  if (status === "unauthenticated" || !user) return <Redirect href="/(auth)/welcome" />;

  if (user.deletionRequestedAt) {
    const currentScreen = (segments as readonly string[])[1];
    if (currentScreen !== "account-deletion-pending") {
      return <Redirect href={"/(app)/account-deletion-pending" as never} />;
    }
  }

  // A dealer whose application isn't approved yet must not see the shopping
  // app at all — same gate apps/web enforces server-side on every dealer page.
  if (user?.role === "DEALER" && dealerStatus && dealerStatus.status !== "APPROVED") {
    return <Redirect href={{ pathname: "/(auth)/dealer-register/status" }} />;
  }
  if (user?.role === "SELLER" && sellerStatus && sellerStatus.status !== "APPROVED") {
    return <Redirect href="/(app)/seller-pending" />;
  }

  // segments = ["(app)", "<screen>", ...]. The tab screens are the storefront's
  // 4 primary destinations (no back button); everything else is a pushed
  // sub-screen (back button, no bottom tab bar of its own).
  // Cast through string[]: the typed-routes tuple that expo-router
  // generates only exists after a dev-server / build run, so a bare
  // `tsc --noEmit` (no `.expo/types`) infers a length-1 tuple here.
  const screen: string = (segments as readonly string[])[1] ?? "(tabs)";
  const isTabs = screen === "(tabs)";
  const showBottomBar = BOTTOM_BAR_SCREENS.has(screen);
  const showCategoryRibbon = isTabs || !NO_CATEGORY_RIBBON.has(screen);
  // Light up the matching ribbon tab while a category page is open (and
  // only when it's the top-level category view, not a sub-category one).
  const activeCategorySlug =
    screen === "category" && !params.subCategory ? (params.slug ?? null) : null;

  return (
    <AppChrome
      showBack={!isTabs}
      showCategoryRibbon={showCategoryRibbon}
      activeCategorySlug={activeCategorySlug}
      hideHeaderSearch={screen === "search"}
    >
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="product/[slug]" />
        <Stack.Screen name="dealer-product/[id]" />
        <Stack.Screen name="category/[slug]" />
        <Stack.Screen name="checkout" />
        <Stack.Screen name="order/[groupId]/[sellerOrderId]" />
        <Stack.Screen name="addresses" />
        <Stack.Screen name="wishlist" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="wallet" />
        <Stack.Screen name="search" />
        <Stack.Screen name="dealer-requests/index" />
        <Stack.Screen name="dealer-requests/new" />
        <Stack.Screen name="become-dealer" />
        <Stack.Screen name="complete-profile" />
        <Stack.Screen name="legal/[slug]" />
        <Stack.Screen name="seller-order/[id]" />
        <Stack.Screen name="seller-pending" />
        <Stack.Screen name="delete-account" />
        <Stack.Screen name="account-deletion-pending" />
        <Stack.Screen name="more/doctor" />
        <Stack.Screen name="more/business-associate" />
        <Stack.Screen name="more/ba-referees" />
        <Stack.Screen name="more/ba-referee-orders" />
        <Stack.Screen name="more/ba-order/[id]" />
        <Stack.Screen name="more/call-centre" />
      </Stack>
      {showBottomBar ? <AppBottomBar /> : null}
    </AppChrome>
  );
}
