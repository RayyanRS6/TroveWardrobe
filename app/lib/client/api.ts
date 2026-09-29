// Same-origin JSON client for the wardrobe API. The session cookie goes
// along automatically. A 401 anywhere means this device is signed out: its
// offline copy is wiped and the page moves to the sign-in screen.

import { wipeLocalData } from "./local-data";

export type ApiErrorKind = "offline" | "unauthenticated" | "client" | "server";

/** A failed API call with a message that is safe to show as-is. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string | undefined;

  constructor(kind: ApiErrorKind, status: number, message: string, code?: string) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export const OFFLINE_MESSAGE = "You're offline. Check your connection and try again.";

let leaving = false;

/** Wipes this device's copy, then opens the sign-in page (once). */
export async function leaveForLogin() {
  if (leaving) return;
  leaving = true;
  await wipeLocalData();
  window.location.replace("/login");
}

/** True for the error thrown while the page is moving to sign-in. */
export function isSignedOutError(error: unknown) {
  return error instanceof ApiError && error.kind === "unauthenticated";
}

/** A friendly message for any failure; raw exceptions never reach the UI. */
export function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function fallbackMessage(status: number) {
  if (status === 404) return "That no longer exists. Refresh and try again.";
  if (status === 413) return "Please use a photo smaller than 10 MB.";
  if (status === 429) return "Too many requests right now. Please try again later.";
  if (status >= 500) return "Trove is having trouble right now. Please try again in a moment.";
  return "That didn't work. Please try again.";
}

async function readJson(response: Response): Promise<unknown> {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorBody(body: unknown) {
  if (typeof body !== "object" || body === null) return null;
  const { error, code } = body as { error?: unknown; code?: unknown };
  return {
    error: typeof error === "string" && error.trim() ? error : null,
    code: typeof code === "string" ? code : undefined,
  };
}

/**
 * Calls the API and returns its parsed JSON body. Throws ApiError: "offline"
 * when the network is unreachable, "unauthenticated" (after starting the
 * sign-out) on 401, and "client"/"server" with the API's own message.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("offline", 0, OFFLINE_MESSAGE);
  }

  const body = await readJson(response);
  const signedOut =
    response.status === 401 ||
    (response.redirected && new URL(response.url).pathname === "/login");
  if (signedOut) {
    void leaveForLogin();
    throw new ApiError("unauthenticated", 401, "Please sign in again.", "unauthenticated");
  }
  if (!response.ok) {
    const details = errorBody(body);
    throw new ApiError(
      response.status >= 500 ? "server" : "client",
      response.status,
      details?.error ?? fallbackMessage(response.status),
      details?.code,
    );
  }
  if (body === undefined) {
    throw new ApiError(
      "server",
      response.status,
      "Trove sent a reply it couldn't read. Please try again.",
    );
  }
  return body as T;
}

export function jsonRequest(method: "POST" | "PATCH", payload: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
