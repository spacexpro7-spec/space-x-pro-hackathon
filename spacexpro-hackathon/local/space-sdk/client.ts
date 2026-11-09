// Standalone browser-side SDK surface for SPACExPRO (local edition).
//
// Same contract as the Muse-hosted client: `createActionClient` POSTs
// { action, args } to `./actions` and unwraps `{ data }` / `{ error }`;
// `spaceQueryClient` is the shared TanStack Query client. Host-only
// extras (viewer presence, iframe invalidation bridges) are not needed
// when the page and its server are the same local process.
import "./styles.css";
import { QueryClient } from "@tanstack/react-query";
import type { ZodType } from "zod";

export class SpaceActionError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly retrySafe: boolean;
  readonly code?: string;
  constructor(
    message: string,
    status: number,
    retryAfterMs?: number,
    retrySafe = false,
    code?: string,
  ) {
    super(message);
    this.name = "SpaceActionError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.retrySafe = retrySafe;
    this.code = code;
  }
}

export const PERMANENT_ACTION_STATUSES = new Set([
  400, 401, 403, 404, 409, 413, 415, 422,
]);
export const MAX_ACTION_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 30_000;

export function shouldRetryAction(
  failureCount: number,
  error: unknown,
): boolean {
  if (
    error instanceof SpaceActionError &&
    PERMANENT_ACTION_STATUSES.has(error.status)
  ) {
    return false;
  }
  return (
    error instanceof SpaceActionError &&
    error.retrySafe &&
    failureCount < MAX_ACTION_RETRIES
  );
}

export function actionRetryDelay(failureCount: number, error: unknown): number {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** failureCount);
  const floor =
    error instanceof SpaceActionError && error.retryAfterMs != null
      ? Math.min(RETRY_CAP_MS, Math.max(0, error.retryAfterMs))
      : 0;
  return floor + Math.random() * ceiling;
}

export const spaceQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryAction,
      retryDelay: actionRetryDelay,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export type ApiRequest<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Parameters<C[K]>[0];
export type ApiResponse<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Awaited<ReturnType<C[K]>>;

type ClientActionShape = { request: ZodType; response: ZodType };
type InferRequest<A> = A extends { request: infer R }
  ? R extends ZodType
    ? import("zod").z.infer<R>
    : never
  : never;
type InferResponse<A> = A extends { response: infer R }
  ? R extends ZodType
    ? import("zod").z.infer<R>
    : never
  : never;
export type ActionClient<A extends Record<string, ClientActionShape>> = {
  [K in keyof A]: (args: InferRequest<A[K]>) => Promise<InferResponse<A[K]>>;
};

interface ClientOptions {
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
}

let callSeq = 0;
export function createActionClient<A extends Record<string, ClientActionShape>>(
  options: ClientOptions = {},
): ActionClient<A> {
  const endpoint =
    options.endpoint ??
    (typeof location !== "undefined"
      ? new URL("./actions", location.href).toString()
      : "./actions");
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  return new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== "string") return undefined;
        if (name === "then" || name === "catch" || name === "finally") {
          return undefined;
        }
        return async (args: unknown) => {
          const actionCallId = `local-${Date.now()}-${++callSeq}`;
          let response: Response;
          try {
            response = await fetchImpl(endpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-request-id": actionCallId,
              },
              body: JSON.stringify({
                action: name,
                args: args ?? {},
                actionCallId,
              }),
            });
          } catch (e) {
            // Network failures surface as TypeError so the app's
            // transport-retry logic treats them as a dropped connection.
            throw e instanceof TypeError
              ? e
              : new TypeError("Failed to fetch");
          }
          const text = await response.text();
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
          if (!response.ok) {
            const errObj =
              body && typeof body === "object" && "error" in body
                ? (body as { error: unknown }).error
                : undefined;
            const msg =
              typeof errObj === "string"
                ? errObj
                : errObj &&
                    typeof errObj === "object" &&
                    "message" in errObj
                  ? String((errObj as { message: unknown }).message)
                  : text;
            const retrySafe =
              body !== null &&
              typeof body === "object" &&
              "retrySafe" in body &&
              (body as { retrySafe: unknown }).retrySafe === true;
            const code =
              errObj && typeof errObj === "object" && "code" in errObj
                ? String((errObj as { code: unknown }).code)
                : undefined;
            throw new SpaceActionError(
              `action ${name} failed: ${response.status} ${msg}`,
              response.status,
              undefined,
              retrySafe,
              code,
            );
          }
          if (
            body &&
            typeof body === "object" &&
            "error" in body &&
            (body as { error: unknown }).error
          ) {
            throw new Error(
              `action ${name} error: ${String((body as { error: unknown }).error)}`,
            );
          }
          return (body as { data: unknown } | null)?.data;
        };
      },
    },
  ) as ActionClient<A>;
}
