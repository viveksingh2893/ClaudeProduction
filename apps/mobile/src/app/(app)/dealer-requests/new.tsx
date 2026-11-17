import { useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppText, Button, Screen, SelectField, TextField } from "@/components/ui";
import { createProductRequest } from "@/lib/api/dealer";
import { getStates, type IndianStateDTO } from "@/lib/api/states";
import { Spacing } from "@/constants/theme";

export default function NewProductRequestScreen() {
  const { productId, variantId } = useLocalSearchParams<{
    productId: string;
    variantId?: string;
  }>();
  const [states, setStates] = useState<IndianStateDTO[]>([]);
  const [quantity, setQuantity] = useState("1");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryStateId, setDeliveryStateId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getStates().then((r) => r.ok && setStates(r.data.states));
  }, []);

  async function handleSubmit() {
    if (!deliveryStateId) return;
    setLoading(true);
    setError(null);
    const result = await createProductRequest({
      productId,
      variantId: variantId || undefined,
      quantity: Number(quantity) || 1,
      deliveryAddress,
      deliveryStateId,
      note: note || undefined,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.replace("/(app)/dealer-requests");
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <AppText variant="body" color="secondary">
          This product isn&apos;t available in your state yet. Let the seller know you&apos;re
          interested.
        </AppText>
        <TextField
          label="Quantity"
          keyboardType="number-pad"
          value={quantity}
          onChangeText={setQuantity}
        />
        <TextField
          label="Delivery address"
          value={deliveryAddress}
          onChangeText={setDeliveryAddress}
          multiline
        />
        <SelectField
          label="Delivery state"
          value={deliveryStateId}
          onChange={setDeliveryStateId}
          options={states.map((s) => ({ label: s.name, value: s.id }))}
        />
        <TextField label="Note (optional)" value={note} onChangeText={setNote} multiline />
        {error ? (
          <AppText variant="body" color="danger">
            {error}
          </AppText>
        ) : null}
        <Button
          label="Send request"
          onPress={handleSubmit}
          loading={loading}
          disabled={!deliveryAddress || !deliveryStateId}
          fullWidth
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
});
