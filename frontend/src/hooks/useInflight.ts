import { useSyncExternalStore } from "react";
import { getInflight, subscribeInflight } from "../api";

/** Number of API requests currently in flight (real, from the API client). */
export function useInflight(): number { return useSyncExternalStore(subscribeInflight, getInflight, () => 0); }
