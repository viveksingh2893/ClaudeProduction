import { api } from "@/lib/api-client";

export type IndianStateDTO = { id: string; name: string };

export function getStates() {
  return api.get<{ states: IndianStateDTO[] }>("/api/mobile/v1/states", { auth: false });
}
