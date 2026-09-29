// Browser-state hooks that render the same on the server and on first
// hydration, then switch to the live value (no hydration mismatch).

import { useSyncExternalStore } from "react";
import { greetingFor } from "./format";

function subscribeToClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

/** "Good morning" etc. from this device's clock; null while server-rendering. */
export function useGreeting() {
  return useSyncExternalStore(
    subscribeToClock,
    () => greetingFor(new Date().getHours()),
    () => null,
  );
}
