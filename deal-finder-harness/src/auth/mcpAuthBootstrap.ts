import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { z } from "zod";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

const AuthConfigSchema = z.object({
  MCP_BASE_URL: z.string().url(),
  MCP_AUTH_PROBE_PATH: z.string().default("/"),
  MCP_AUTH_TOKEN_MODE: z.enum(["access_token", "id_token"]).default("access_token"),
  MCP_ID_TOKEN_AUDIENCE: z.string().optional(),
  MCP_AUTH_TOKEN_FILE: z.string().default("./.auth/mcp-token.json"),
  MCP_AUTH_CALLBACK_HOST: z.string().default("127.0.0.1"),
  MCP_AUTH_CALLBACK_PORT: z.coerce.number().int().positive().default(8787),
  MCP_AUTH_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  XYN_OIDC_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_SCOPES: z.string().default("openid email profile"),
});

type AuthConfig = z.infer<typeof AuthConfigSchema>;

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  [key: string]: unknown;
}

interface TokenDiagnostics {
  tokenType: "access_token" | "id_token";
  issuer: string | null;
  audience: string | string[] | null;
  expiry: string | null;
}

interface StoredTokenRecord {
  acquiredAtIso: string;
  tokenMode: "access_token" | "id_token";
  selectedToken: string;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAtIso?: string;
  diagnostics: TokenDiagnostics;
  probe: {
    url: string;
    status: number;
    ok: boolean;
    bodySnippet: string;
    checkedAtIso: string;
  };
  rawTokenResponse: TokenResponse;
}

async function main(): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });

  const config = parseConfig();
  const clientId = config.GOOGLE_OAUTH_CLIENT_ID ?? config.XYN_OIDC_CLIENT_ID;
  if (!clientId) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID (or XYN_OIDC_CLIENT_ID) in environment");
  }

  const callbackUrl = `http://${config.MCP_AUTH_CALLBACK_HOST}:${config.MCP_AUTH_CALLBACK_PORT}/oauth/callback`;
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = sha256Base64Url(codeVerifier);

  const authUrl = buildAuthUrl({
    authorizationEndpoint: AUTHORIZATION_ENDPOINT,
    clientId,
    callbackUrl,
    state,
    scopes: config.GOOGLE_OAUTH_SCOPES,
    codeChallenge,
    audience: config.MCP_ID_TOKEN_AUDIENCE,
  });

  const authCodePromise = waitForAuthorizationCode({
    host: config.MCP_AUTH_CALLBACK_HOST,
    port: config.MCP_AUTH_CALLBACK_PORT,
    expectedState: state,
    timeoutMs: config.MCP_AUTH_TIMEOUT_MS,
  });

  await openInBrowser(authUrl);
  console.log("Opened Google OAuth login in browser");

  const authCode = await authCodePromise;
  const tokenResponse = await exchangeCodeForTokens({
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId,
    callbackUrl,
    codeVerifier,
    authCode,
  });

  const selectedToken = selectToken(config.MCP_AUTH_TOKEN_MODE, tokenResponse);
  const diagnostics = await buildDiagnostics(config.MCP_AUTH_TOKEN_MODE, selectedToken, tokenResponse.expires_in);

  if (
    config.MCP_AUTH_TOKEN_MODE === "id_token" &&
    config.MCP_ID_TOKEN_AUDIENCE &&
    !audienceIncludes(diagnostics.audience, config.MCP_ID_TOKEN_AUDIENCE)
  ) {
    throw new Error(
      `Configured MCP_ID_TOKEN_AUDIENCE '${config.MCP_ID_TOKEN_AUDIENCE}' does not match token audience '${String(diagnostics.audience)}'`,
    );
  }

  const probeResult = await probeMcp({
    baseUrl: config.MCP_BASE_URL,
    probePath: config.MCP_AUTH_PROBE_PATH,
    token: selectedToken,
  });

  const expiresAtIso =
    typeof tokenResponse.expires_in === "number"
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : undefined;

  const tokenRecord: StoredTokenRecord = {
    acquiredAtIso: new Date().toISOString(),
    tokenMode: config.MCP_AUTH_TOKEN_MODE,
    selectedToken,
    accessToken: tokenResponse.access_token,
    idToken: tokenResponse.id_token,
    refreshToken: tokenResponse.refresh_token,
    tokenType: tokenResponse.token_type,
    scope: tokenResponse.scope,
    expiresAtIso,
    diagnostics,
    probe: probeResult,
    rawTokenResponse: tokenResponse,
  };

  await writeTokenRecord(config.MCP_AUTH_TOKEN_FILE, tokenRecord);

  printDiagnostics(diagnostics);
  console.log("MCP probe", {
    url: probeResult.url,
    status: probeResult.status,
    ok: probeResult.ok,
  });
  console.log(`Saved token record to ${config.MCP_AUTH_TOKEN_FILE}`);
}

function parseConfig(): AuthConfig {
  const parsed = AuthConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid auth:mcp environment: ${issues}`);
  }
  return parsed.data;
}

function buildAuthUrl(args: {
  authorizationEndpoint: string;
  clientId: string;
  callbackUrl: string;
  state: string;
  scopes: string;
  codeChallenge: string;
  audience?: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.callbackUrl,
    response_type: "code",
    scope: args.scopes,
    access_type: "offline",
    prompt: "consent",
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });

  if (args.audience) {
    // TODO: Confirm audience query behavior for your Google OAuth client configuration.
    params.set("audience", args.audience);
  }

  return `${args.authorizationEndpoint}?${params.toString()}`;
}

function waitForAuthorizationCode(args: {
  host: string;
  port: number;
  expectedState: string;
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Missing callback URL");
        return;
      }

      const url = new URL(req.url, `http://${args.host}:${args.port}`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.statusCode = 400;
        res.end(`OAuth error: ${error}`);
        cleanup();
        reject(new Error(`OAuth callback error: ${error}`));
        return;
      }

      if (!code || !state) {
        res.statusCode = 400;
        res.end("Missing code/state in callback");
        return;
      }

      if (state !== args.expectedState) {
        res.statusCode = 400;
        res.end("State validation failed");
        cleanup();
        reject(new Error("OAuth state mismatch"));
        return;
      }

      res.statusCode = 200;
      res.end("Authentication complete. You can close this window.");
      cleanup();
      resolve(code);
    });

    server.on("error", (error) => {
      cleanup();
      reject(error);
    });

    server.listen(args.port, args.host);

    const timeoutHandle = setTimeout(() => {
      cleanup();
      reject(new Error(`OAuth callback timed out after ${args.timeoutMs}ms`));
    }, args.timeoutMs);

    function cleanup(): void {
      clearTimeout(timeoutHandle);
      server.close();
    }
  });
}

async function exchangeCodeForTokens(args: {
  tokenEndpoint: string;
  clientId: string;
  callbackUrl: string;
  codeVerifier: string;
  authCode: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.authCode,
    client_id: args.clientId,
    redirect_uri: args.callbackUrl,
    code_verifier: args.codeVerifier,
  });

  const response = await fetch(args.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${JSON.stringify(data)}`);
  }

  if (!data.access_token && !data.id_token) {
    throw new Error(`Token exchange response missing access_token/id_token: ${JSON.stringify(data)}`);
  }

  return data;
}

function selectToken(mode: "access_token" | "id_token", tokenResponse: TokenResponse): string {
  const token = mode === "access_token" ? tokenResponse.access_token : tokenResponse.id_token;
  if (!token) {
    throw new Error(`Token mode '${mode}' selected but token is missing in OAuth response`);
  }
  return token;
}

async function buildDiagnostics(
  tokenType: "access_token" | "id_token",
  token: string,
  expiresIn?: number,
): Promise<TokenDiagnostics> {
  if (tokenType === "id_token") {
    const payload = decodeJwtPayload(token);
    return {
      tokenType,
      issuer: extractStringField(payload, "iss"),
      audience: extractAudience(payload),
      expiry: extractExpiryIso(payload),
    };
  }

  const tokenInfo = await fetchTokenInfo(`${TOKENINFO_ENDPOINT}?access_token=${encodeURIComponent(token)}`);
  return {
    tokenType,
    issuer: extractStringField(tokenInfo, "iss"),
    audience: extractAudience(tokenInfo),
    expiry:
      extractExpiryIso(tokenInfo) ??
      (typeof expiresIn === "number" ? new Date(Date.now() + expiresIn * 1000).toISOString() : null),
  };
}

async function fetchTokenInfo(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: "GET" });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return {};
  }
  return data;
}

async function probeMcp(args: {
  baseUrl: string;
  probePath: string;
  token: string;
}): Promise<{ url: string; status: number; ok: boolean; bodySnippet: string; checkedAtIso: string }> {
  // TODO: Confirm correct MCP probe path for your deployment if not '/'.
  const probeUrl = new URL(args.probePath, args.baseUrl).toString();
  const response = await fetch(probeUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${args.token}`,
      accept: "application/json, text/plain, */*",
    },
  });

  const body = await response.text().catch(() => "");
  return {
    url: probeUrl,
    status: response.status,
    ok: response.ok,
    bodySnippet: body.slice(0, 500),
    checkedAtIso: new Date().toISOString(),
  };
}

async function writeTokenRecord(filePath: string, record: StoredTokenRecord): Promise<void> {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function printDiagnostics(diagnostics: TokenDiagnostics): void {
  console.log("Token diagnostics", {
    tokenType: diagnostics.tokenType,
    issuer: diagnostics.issuer,
    audience: diagnostics.audience,
    expiry: diagnostics.expiry,
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) {
    return {};
  }

  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractStringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function extractAudience(payload: Record<string, unknown>): string | string[] | null {
  const value = payload.aud;
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  return null;
}

function extractExpiryIso(payload: Record<string, unknown>): string | null {
  const exp = payload.exp;
  if (typeof exp === "number") {
    return new Date(exp * 1000).toISOString();
  }
  if (typeof exp === "string" && /^\d+$/.test(exp)) {
    return new Date(Number(exp) * 1000).toISOString();
  }
  return null;
}

function audienceIncludes(audience: string | string[] | null, expected: string): boolean {
  if (!audience) {
    return false;
  }
  if (typeof audience === "string") {
    return audience === expected;
  }
  return audience.includes(expected);
}

function randomBase64Url(lengthBytes: number): string {
  return crypto.randomBytes(lengthBytes).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

async function openInBrowser(url: string): Promise<void> {
  const platform = process.platform;

  if (platform === "darwin") {
    await runCommand("open", [url]);
    return;
  }

  if (platform === "win32") {
    await runCommand("cmd", ["/c", "start", "", url]);
    return;
  }

  await runCommand("xdg-open", [url]);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.unref();
    resolve();
  });
}

main().catch((error: unknown) => {
  console.error("auth:mcp failed", error);
  process.exitCode = 1;
});
