import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, EmptyState, ErrorState, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { tapFeedback } from "@/lib/haptics";
import { Spacing, TAB_BAR_SCENE_INSET } from "@/constants/theme";
import {
  deleteNotification,
  getNotifications,
  markNotificationsRead,
  type NotificationDTO,
} from "@/lib/api/notifications";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function routeForLink(linkUrl: string | null): string | null {
  if (!linkUrl || /^https?:\/\//i.test(linkUrl)) return null;
  if (linkUrl.startsWith("/cart")) return "/(app)/(tabs)/cart";
  if (linkUrl.startsWith("/account/orders") || linkUrl.startsWith("/orders")) {
    return "/(app)/(tabs)/orders";
  }
  if (
    linkUrl.startsWith("/products") ||
    linkUrl.startsWith("/shop") ||
    linkUrl.startsWith("/category")
  ) {
    return "/(app)/(tabs)/shop";
  }
  return null;
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await getNotifications();
    setLoading(false);
    setRefreshing(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setItems(result.data.notifications);
    // Opening the list clears the unread state server-side.
    if (result.data.unreadCount > 0) void markNotificationsRead();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  function handlePress(item: NotificationDTO) {
    tapFeedback();
    const target = routeForLink(item.linkUrl);
    if (target) router.push(target as never);
  }

  async function handleDelete(id: string) {
    tapFeedback();
    setItems((prev) => prev.filter((n) => n.id !== id));
    await deleteNotification(id);
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!loading && items.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="No notifications yet"
          description="Order updates and offers from Kisan4U will show up here."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + TAB_BAR_SCENE_INSET },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <AppText variant="title" style={styles.heading}>
            Notifications
          </AppText>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.row,
              { borderColor: theme.border, backgroundColor: theme.surface },
              !item.isRead && { borderColor: theme.green500 },
            ]}
            onPress={() => handlePress(item)}
          >
            <View style={styles.rowMain}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {item.title}
              </AppText>
              <AppText variant="body" color="secondary" style={styles.body}>
                {item.body}
              </AppText>
              <AppText variant="caption" color="secondary">
                {timeAgo(item.createdAt)}
              </AppText>
            </View>
            <Pressable hitSlop={10} onPress={() => handleDelete(item.id)}>
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.sm },
  heading: { marginBottom: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.md,
  },
  rowMain: { flex: 1, gap: 3 },
  body: { marginBottom: 2 },
});
