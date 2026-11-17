import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { LEGAL_DOCS, isLegalSlug } from "@kisan4u/validators";
import { AppText, ErrorState, Screen } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

const LINKIFY =
  /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\+91[-\s]?\d[\d\s-]{7,}\d|www\.kisan4u\.com)/gi;

/** Renders one plain-text paragraph, turning emails / phones / the site URL into tappable links. "\n" in the text is a line break (native Text behaviour). */
function Linkified({ text, linkColor }: { text: string; linkColor: string }) {
  return (
    <>
      {text.split(LINKIFY).map((part, i) => {
        if (i % 2 === 0) return part;
        const onPress = () => {
          if (part.includes("@")) Linking.openURL(`mailto:${part}`);
          else if (part.startsWith("+")) Linking.openURL(`tel:${part.replace(/[\s-]/g, "")}`);
          else Linking.openURL("https://www.kisan4u.com");
        };
        return (
          <Text key={i} onPress={onPress} style={{ color: linkColor, fontWeight: "700" }}>
            {part}
          </Text>
        );
      })}
    </>
  );
}

export default function LegalScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const theme = useTheme();

  if (!slug || !isLegalSlug(slug)) {
    return (
      <Screen>
        <ErrorState message="That page doesn't exist." />
      </Screen>
    );
  }
  const doc = LEGAL_DOCS[slug];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View>
          <AppText variant="title" color="green">
            {doc.title}
          </AppText>
          {doc.lastUpdated ? (
            <AppText variant="caption" color="secondary">
              Last updated: {doc.lastUpdated}
            </AppText>
          ) : null}
        </View>

        {doc.sections.map((section, si) => (
          <View key={si} style={styles.section}>
            {section.heading ? (
              <AppText variant="bodyBold" style={[styles.heading, { color: theme.green900 }]}>
                {section.heading}
              </AppText>
            ) : null}
            {section.paragraphs.map((para, pi) => (
              <Text key={pi} style={[styles.para, { color: theme.ink }]}>
                <Linkified text={para} linkColor={theme.green700} />
              </Text>
            ))}
            {section.list ? (
              <View style={styles.list}>
                {section.list.map((li, i) => (
                  <View key={i} style={styles.listRow}>
                    <Text style={[styles.bullet, { color: theme.green700 }]}>{"•"}</Text>
                    <Text style={[styles.para, { color: theme.ink, flex: 1 }]}>{li}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  section: { gap: Spacing.xs },
  heading: { fontSize: 16, fontWeight: "800", marginBottom: 2 },
  para: { fontSize: 14.5, lineHeight: 22 },
  list: { gap: 4, marginTop: 4 },
  listRow: { flexDirection: "row", gap: Spacing.xs },
  bullet: { fontSize: 15, lineHeight: 22 },
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.md },
});
