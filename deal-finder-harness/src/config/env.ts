import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

const RawEnvSchema = z
  .object({
    NODE_ENV: z
      .string()
      .default("development")
      .transform((value) => value.toLowerCase())
      .pipe(z.enum(["development", "test", "production"])),
    LOG_LEVEL: z
      .string()
      .default("info")
      .transform((value) => value.toLowerCase())
      .pipe(z.enum(["debug", "info", "warn", "error"])),
    DEAL_FINDER_MCP_BASE_URL: z.string().url().optional(),
    MCP_BASE_URL: z.string().url().optional(),
    DEAL_FINDER_MCP_ENDPOINT_SUBMIT_REQUEST: z.string().min(1).optional(),
    MCP_ENDPOINT_SUBMIT_REQUEST: z.string().min(1).default("/mcp/development/requests"),
    DEAL_FINDER_MCP_ENDPOINT_HEALTH: z.string().min(1).optional(),
    MCP_ENDPOINT_HEALTH: z.string().min(1).optional(),
    DEAL_FINDER_MCP_AUDIENCE: z.string().min(1).optional(),
    MCP_ID_TOKEN_AUDIENCE: z.string().min(1).optional(),
    MCP_AUTH_TOKEN_MODE: z.enum(["access_token", "id_token"]).default("access_token"),
    MCP_AUTH_TOKEN_FILE: z.string().default("./.auth/mcp-token.json"),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    XYN_OIDC_CLIENT_ID: z.string().optional(),
    MCP_ENDPOINT_ARTIFACT_SELECTION: z.string().min(1).optional(),
    MCP_ENDPOINT_PLANNER_OUTPUT: z.string().min(1).optional(),
    MCP_ENDPOINT_SIBLING_INFO: z.string().min(1).optional(),
    MCP_ENDPOINT_SIBLING_URL: z.string().min(1).optional(),
    MCP_ENDPOINT_BRANCH_INFO: z.string().min(1).optional(),
    ARTIFACTS_DIR: z.string().default("./artifacts"),
    HARNESS_SCENARIO_ID: z.string().min(1).default("mcp_create_campaign"),
    HARNESS_SCENARIO_SUITE: z.enum(["all", "planner-regression", "deal-finder-mcp"]).default("all"),
  })
  .superRefine((value, ctx) => {
    if (!value.DEAL_FINDER_MCP_BASE_URL && !value.MCP_BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEAL_FINDER_MCP_BASE_URL"],
        message: "Set DEAL_FINDER_MCP_BASE_URL or MCP_BASE_URL",
      });
    }
  });

type RawEnv = z.infer<typeof RawEnvSchema>;

export interface ResolvedMcpTargetConfig {
  readonly targetName: "deal_finder_mcp" | "generic_mcp";
  readonly baseUrl: string;
  readonly submitRequestEndpoint: string;
  readonly healthEndpoint: string;
  readonly audience: string | null;
}

export interface HarnessEnv extends RawEnv {
  readonly mcpTarget: ResolvedMcpTargetConfig;
}

export function loadEnvConfig(): HarnessEnv {
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });

  const parsed = RawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return {
    ...parsed.data,
    mcpTarget: resolveMcpTarget(parsed.data),
  };
}

function resolveMcpTarget(env: RawEnv): ResolvedMcpTargetConfig {
  const usingDealFinderTarget = Boolean(env.DEAL_FINDER_MCP_BASE_URL);
  const baseUrl = env.DEAL_FINDER_MCP_BASE_URL ?? env.MCP_BASE_URL;
  if (!baseUrl) {
    throw new Error("Invalid environment configuration: missing MCP target base URL");
  }

  const submitRequestEndpoint =
    env.DEAL_FINDER_MCP_ENDPOINT_SUBMIT_REQUEST ?? env.MCP_ENDPOINT_SUBMIT_REQUEST;
  const healthEndpoint = env.DEAL_FINDER_MCP_ENDPOINT_HEALTH ?? env.MCP_ENDPOINT_HEALTH ?? "/mcp";
  const audience = env.DEAL_FINDER_MCP_AUDIENCE ?? env.MCP_ID_TOKEN_AUDIENCE ?? null;

  return {
    targetName: usingDealFinderTarget ? "deal_finder_mcp" : "generic_mcp",
    baseUrl,
    submitRequestEndpoint,
    healthEndpoint,
    audience,
  };
}
