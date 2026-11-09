// Standalone server-side SDK surface for SPACExPRO (local edition).
//
// This replaces the Muse-hosted `@hatch/space-sdk` package, which was
// only available from a Muse-machine path (file:/opt/hatch/...) and is
// the reason `bun install` / `bun run dev` failed on Windows and Mac.
// Only the API this app actually uses is implemented:
//   defineAction, z, Ctx, ActionsModule, ActionDefinition, isAction.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { z } from "zod";

export { z };
export type { ZodType } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Drizzle DB surface used by the actions (bun:sqlite driver locally). */
export type SpaceDb<
  TSchema extends Record<string, unknown> = Record<string, never>,
> = Pick<
  BunSQLiteDatabase<TSchema>,
  "select" | "insert" | "update" | "delete" | "run" | "all" | "get"
>;
export type SpaceDbAccessor = <
  TSchema extends Record<string, unknown> = Record<string, never>,
>() => SpaceDb<TSchema>;

export type AgentTaskOptions = {
  readonly expectsAction?: string;
  readonly dedupeKey?: string;
  readonly allowParallel?: boolean;
};
export type AgentTaskResult =
  | { ok: true; taskId: string; agentId: string; messageId: string }
  | { ok: false; error: string };
export interface AgentClient {
  spawnTask(
    message: string,
    options?: AgentTaskOptions,
  ): Promise<AgentTaskResult>;
  send(message: string, options?: AgentTaskOptions): Promise<AgentTaskResult>;
  status(taskId: string): Promise<{ taskId: string; status: string }>;
}

/** Per-invocation context passed to every action handler. */
export interface Ctx {
  readonly db: SpaceDbAccessor;
  readonly agent: AgentClient;
  emit(data: JsonValue): void;
  invalidateQueries(...args: unknown[]): void;
  executePrivileged(contract: unknown, args: unknown): Promise<unknown>;
}

export const ACTION_BRAND = "@hatch/space-sdk/action/v1" as const;

export interface ActionDefinition<
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> {
  readonly __brand: typeof ACTION_BRAND;
  readonly request: Req;
  readonly response: Res;
  readonly description?: string;
  readonly handler: (ctx: Ctx, args: z.infer<Req>) => Promise<z.infer<Res>>;
}

export type ActionFactoryInput<
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> = {
  request: Req;
  response: Res;
  description?: string;
  handler: (ctx: Ctx, args: z.infer<Req>) => Promise<z.infer<Res>>;
};

export function defineAction<Req extends z.ZodType, Res extends z.ZodType>(
  spec: ActionFactoryInput<Req, Res>,
): ActionDefinition<Req, Res> {
  return {
    __brand: ACTION_BRAND,
    request: spec.request,
    response: spec.response,
    ...(spec.description !== undefined
      ? { description: spec.description }
      : {}),
    handler: spec.handler,
  };
}

export function isAction(value: unknown): value is ActionDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "__brand" in value &&
    (value as { __brand?: unknown }).__brand === ACTION_BRAND
  );
}

export type ActionsModule = Record<
  string,
  Omit<ActionDefinition, "handler"> & {
    handler: (ctx: Ctx, args: never) => Promise<unknown>;
  }
>;

export type ActionRequest<A extends { request: z.ZodType }> = z.infer<
  A["request"]
>;
export type ActionResponse<A extends { response: z.ZodType }> = z.infer<
  A["response"]
>;
