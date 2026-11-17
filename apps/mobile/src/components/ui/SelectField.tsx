import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, View } from "react-native";
import { AppText } from "./AppText";
import { TextField } from "./TextField";
import { useTheme } from "@/hooks/use-theme";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";

export type SelectOption = { label: string; value: string };

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  error,
}: {
  label?: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string | null;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <View style={{ gap: Spacing.xxs }}>
      {label ? (
        <AppText variant="label" color="secondary">
          {label}
        </AppText>
      ) : null}
      <Pressable
        onPress={() => setOpen(true)}
        style={[
          styles.trigger,
          { borderColor: error ? theme.danger : theme.border, backgroundColor: theme.surface },
        ]}
      >
        <AppText variant="body" color={selected ? "ink" : "secondary"}>
          {selected?.label ?? placeholder}
        </AppText>
      </Pressable>
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <AppText variant="subtitle">{label ?? "Select"}</AppText>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <AppText variant="bodyBold" color="green">
                Done
              </AppText>
            </Pressable>
          </View>
          <TextField placeholder="Search…" value={query} onChangeText={setQuery} autoFocus />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, { borderBottomColor: theme.border }]}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <AppText variant="body" color={item.value === value ? "green" : "ink"}>
                  {item.label}
                </AppText>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: MinTouchTarget,
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    justifyContent: "center",
  },
  modal: { flex: 1, padding: Spacing.lg, gap: Spacing.md, paddingTop: Spacing.xxl },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  row: {
    minHeight: MinTouchTarget,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
