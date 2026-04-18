export interface AuthSession {
  readonly accessToken: string;
  readonly expiresAtIso: string;
}

export interface AuthProvider {
  getSession(): Promise<AuthSession>;
}

class PlaceholderAuthProvider implements AuthProvider {
  async getSession(): Promise<AuthSession> {
    // TODO: Replace with real authentication flow against Xyn UI and/or MCP bridge.
    return {
      accessToken: "placeholder-token",
      expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    };
  }
}

export function buildPlaceholderAuthProvider(): AuthProvider {
  return new PlaceholderAuthProvider();
}
