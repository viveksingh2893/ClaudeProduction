import { useCallback } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "@/components/ui";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { siteUrl } from "@/lib/site-origin";
import { InfiniteProductGrid, type ProductPage } from "@/components/InfiniteProductGrid";
import { getProducts } from "@/lib/api/catalog";
import { getDealerProducts } from "@/lib/api/dealer";
import { useAuth } from "@/context/auth-context";
import { useLanguage } from "@/context/language-context";
import { TAB_BAR_SCENE_INSET } from "@/constants/theme";

export default function CropScreen() {
  const { slug, name } = useLocalSearchParams<{ slug: string; name?: string }>();
  const { user } = useAuth();
  const { dbLang } = useLanguage();
  const insets = useSafeAreaInsets();
  const isDealer = user?.role === "DEALER";
  const fetchPage = useCallback(
    async (page: number): Promise<ProductPage | null> => {
      const result = isDealer
        ? await getDealerProducts({ crop: slug, page, pageSize: 20 })
        : await getProducts({ crop: slug, lang: dbLang, page, pageSize: 20 });
      return result.ok ? { items: result.data.items, hasMore: result.data.hasMore } : null;
    },
    [isDealer, slug, dbLang],
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: name || "Crop" }} />
      <ShareLinkButton title={name || "Kisan4U crop products"} url={siteUrl(`/crops/${slug}`)} />
      <InfiniteProductGrid
        key={slug}
        fetchPage={fetchPage}
        audience={isDealer ? "DEALER" : "CUSTOMER"}
        emptyTitle="No products for this crop yet"
        contentBottomInset={TAB_BAR_SCENE_INSET + insets.bottom}
      />
    </Screen>
  );
}
