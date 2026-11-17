import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Badge, Button, ErrorState, Screen } from "@/components/ui";
import { getDealerStatus } from "@/lib/api/dealer";
import type { DealerProfileDTO } from "@/lib/api/types";
import { Spacing } from "@/constants/theme";

const STATUS_COPY: Record<
  string,
  { title: string; tone: "success" | "warning" | "danger"; body: string }
> = {
  PENDING: {
    title: "Application under review",
    tone: "warning",
    body: "Our team is reviewing your documents. This usually takes 1-2 business days.",
  },
  APPROVED: {
    title: "You're approved!",
    tone: "success",
    body: "Log in to start browsing dealer pricing and placing orders.",
  },
  REJECTED: {
    title: "Application rejected",
    tone: "danger",
    body: "Contact Kisan4U support for details.",
  },
  SUSPENDED: {
    title: "Account suspended",
    tone: "danger",
    body: "Contact Kisan4U support for details.",
  },
};

export default function DealerStatusScreen() {
  const { statusViewSessionId } = useLocalSearchParams<{ statusViewSessionId?: string }>();
  const [profile, setProfile] = useState<DealerProfileDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getDealerStatus(statusViewSessionId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setProfile(result.data.profile);
  }, [statusViewSessionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !profile) return null;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!profile) return null;

  const copy = STATUS_COPY[profile.status] ?? STATUS_COPY.PENDING;

  return (
    <Screen>
      <View style={styles.container}>
        <Badge label={profile.status} tone={copy.tone} />
        <AppText variant="title">{copy.title}</AppText>
        <AppText variant="body" color="secondary">
          {copy.body}
        </AppText>
        {profile.rejectionReason ? (
          <AppText variant="body" color="danger">
            Reason: {profile.rejectionReason}
          </AppText>
        ) : null}

        {profile.status === "APPROVED" ? (
          <Button
            label="Continue to login"
            onPress={() => router.replace("/(auth)/dealer-register")}
            fullWidth
          />
        ) : (
          <Button label="Refresh status" onPress={load} variant="outline" fullWidth />
        )}
        <Button
          label="Back to home"
          onPress={() => router.replace("/(auth)/welcome")}
          variant="ghost"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ container: { padding: Spacing.xl, gap: Spacing.sm } });
