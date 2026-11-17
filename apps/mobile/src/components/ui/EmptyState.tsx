import { StyleSheet, View } from "react-native";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { Spacing } from "@/constants/theme";

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.container}>
      <AppText variant="subtitle" style={styles.center}>
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" color="secondary" style={styles.center}>
          {description}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="outline" />
      ) : null}
    </View>
  );
}

/** Same shape, for a request that failed rather than one that simply has nothing to show — always offers Retry. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.container}>
      <AppText variant="subtitle" color="danger" style={styles.center}>
        Something went wrong
      </AppText>
      <AppText variant="body" color="secondary" style={styles.center}>
        {message}
      </AppText>
      {onRetry ? <Button label="Retry" onPress={onRetry} variant="outline" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
  },
  center: { textAlign: "center" },
});
