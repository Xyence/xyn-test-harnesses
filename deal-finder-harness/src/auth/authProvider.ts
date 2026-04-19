import fs from "node:fs/promises";
import path from "node:path";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface AuthSession {
  readonly accessToken: string;
  readonly expiresAtIso: string;
  readonly tokenType: "access_token" | "id_token";
  readonly audience: string | string[] | null;
}

export interface AuthProvider {
  getSession(): Promise<AuthSession>;
}

interface CachedTokenRecord {
  tokenMode?: "access_token" | "id_token";
  selectedToken?: string;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  expiresAtIso?: string;
  diagnostics?: {
    audience?: string | string[] | null;
    expiry?: string | null;
  };
  rawTokenResponse?: {
    refresh_token?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CachedTokenAuthProviderOptions {
  readonly tokenFilePath: string;
  readonly googleClientId?: string;
  readonly googleClientSecret?: string;
  readonly preferredTokenMode?: "access_token" | "id_token";
  readonly minValidityMs?: number;
}

class CachedTokenAuthProvider implements AuthProvider {
  private readonly minValidityMs: number;

  constructor(private readonly options: CachedTokenAuthProviderOptions) {
    this.minValidityMs = options.minValidityMs ?? 60_000;
  }

  async getSession(): Promise<AuthSession> {
    const tokenPath = path.resolve(process.cwd(), this.options.tokenFilePath);
    const record = await this.readTokenRecord(tokenPath);

    let tokenMode = this.options.preferredTokenMode ?? record.tokenMode ?? "access_token";
    let selectedToken = this.resolveToken(record, tokenMode);
    let expiresAtIso = this.resolveExpiry(record);

    if (!selectedToken) {
      throw new Error(`Auth token missing in ${tokenPath}`);
    }

    if (!expiresAtIso) {
      throw new Error(`Token expiry missing in `);
    }

    let audience = this.resolveAudience(record, tokenMode, selectedToken);

    if (this.isExpiredOrNearExpiry(expiresAtIso)) {
      const refreshed = await this.tryRefresh(record, tokenMode);
      if (!refreshed) {
        throw new Error(
          `Cached MCP token is expired (expiresAtIso=${expiresAtIso}) and cannot be refreshed automatically`,
        );
      }

      tokenMode = refreshed.tokenMode;
      selectedToken = refreshed.selectedToken;
      expiresAtIso = refreshed.expiresAtIso;
      audience = refreshed.audience;

      await this.writeTokenRecord(tokenPath, {
        ...record,
        ...refreshed.persistedFields,
      });
    }

    return {
      accessToken: selectedToken,
      expiresAtIso,
      tokenType: tokenMode,
      audience,
    };
  }

  private async readTokenRecord(tokenPath: string): Promise<CachedTokenRecord> {
    let raw: string;
    try {
      raw = await fs.readFile(tokenPath, "utf8");
    } catch (error: unknown) {
      throw new Error(
        `Failed to read token file at ${tokenPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      return JSON.parse(raw) as CachedTokenRecord;
    } catch (error: unknown) {
      throw new Error(`Invalid JSON token file at ${tokenPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeTokenRecord(tokenPath: string, record: CachedTokenRecord): Promise<void> {
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  private resolveToken(record: CachedTokenRecord, tokenMode: "access_token" | "id_token"): string | null {
    if (tokenMode === "access_token") {
      return record.accessToken ?? record.selectedToken ?? null;
    }
    return record.idToken ?? record.selectedToken ?? null;
  }

  private resolveExpiry(record: CachedTokenRecord): string | null {
    if (typeof record.expiresAtIso === "string" && record.expiresAtIso.length > 0) {
      return record.expiresAtIso;
    }
    const diagnosticExpiry = record.diagnostics?.expiry;
    if (typeof diagnosticExpiry === "string" && diagnosticExpiry.length > 0) {
      return diagnosticExpiry;
    }
    return null;
  }

  private resolveAudience(
    record: CachedTokenRecord,
    tokenMode: "access_token" | "id_token",
    token: string,
  ): string | string[] | null {
    if (record.diagnostics?.audience !== undefined) {
      return record.diagnostics.audience;
    }

    if (tokenMode === "id_token") {
      const payload = decodeJwtPayload(token);
      const aud = payload.aud;
      if (typeof aud === "string") {
        return aud;
      }
      if (Array.isArray(aud) && aud.every((item) => typeof item === "string")) {
        return aud as string[];
      }
    }

    return null;
  }

  private isExpiredOrNearExpiry(expiresAtIso: string): boolean {
    const expiryMs = Date.parse(expiresAtIso);
    if (Number.isNaN(expiryMs)) {
      return true;
    }
    return Date.now() + this.minValidityMs >= expiryMs;
  }

  private async tryRefresh(
    record: CachedTokenRecord,
    tokenMode: "access_token" | "id_token",
  ): Promise<
    | {
        tokenMode: "access_token" | "id_token";
        selectedToken: string;
        expiresAtIso: string;
        audience: string | string[] | null;
        persistedFields: CachedTokenRecord;
      }
    | null
  > {
    const refreshToken =
      record.refreshToken ??
      (typeof record.rawTokenResponse?.refresh_token === "string" ? record.rawTokenResponse.refresh_token : undefined);

    if (!refreshToken || !this.options.googleClientId) {
      return null;
    }

    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.options.googleClientId,
    });

    if (this.options.googleClientSecret) {
      form.set("client_secret", this.options.googleClientSecret);
    }

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      id_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
      [key: string]: unknown;
    };

    if (!response.ok) {
      return null;
    }

    const selectedToken = tokenMode === "id_token" ? data.id_token : data.access_token;
    if (!selectedToken) {
      return null;
    }

    const expiresAtIso =
      typeof data.expires_in === "number"
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : tokenMode === "id_token"
          ? extractJwtExpiryIso(selectedToken)
          : null;

    if (!expiresAtIso) {
      return null;
    }

    const audience =
      tokenMode === "id_token"
        ? extractJwtAudience(selectedToken)
        : record.diagnostics?.audience ?? null;

    return {
      tokenMode,
      selectedToken,
      expiresAtIso,
      audience,
      persistedFields: {
        tokenMode,
        selectedToken,
        accessToken: data.access_token ?? record.accessToken,
        idToken: data.id_token ?? record.idToken,
        refreshToken,
        expiresAtIso,
        diagnostics: {
          audience,
          expiry: expiresAtIso,
        },
        rawTokenResponse: {
          ...(record.rawTokenResponse ?? {}),
          ...data,
          refresh_token: refreshToken,
        },
      },
    };
  }
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

function extractJwtExpiryIso(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const exp = payload.exp;
  if (typeof exp === "number") {
    return new Date(exp * 1000).toISOString();
  }
  if (typeof exp === "string" && /^\d+$/.test(exp)) {
    return new Date(Number(exp) * 1000).toISOString();
  }
  return null;
}

function extractJwtAudience(token: string): string | string[] | null {
  const payload = decodeJwtPayload(token);
  const aud = payload.aud;
  if (typeof aud === "string") {
    return aud;
  }
  if (Array.isArray(aud) && aud.every((item) => typeof item === "string")) {
    return aud as string[];
  }
  return null;
}

export function buildCachedTokenAuthProvider(options: CachedTokenAuthProviderOptions): AuthProvider {
  return new CachedTokenAuthProvider(options);
}
