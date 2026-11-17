import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";

const DEVICE_ID_KEY = "kisan4u.deviceId";

function createInstallationId(): string {
  return `install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function getDeviceHeaders(): Promise<Record<string, string>> {
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    id = createInstallationId();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }
  return {
    "X-Device-Id": id,
    "X-Device-Name":
      Device.deviceName || `${Device.manufacturer || "Android"} ${Device.modelName || "device"}`,
  };
}
