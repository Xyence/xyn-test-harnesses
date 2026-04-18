function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface UrlCheckAttempt {
  readonly attempt: number;
  readonly startedAtIso: string;
  readonly endedAtIso: string;
  readonly durationMs: number;
  readonly statusCode: number | null;
  readonly success: boolean;
  readonly error: string | null;
}

export interface UrlCheckResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: {
    readonly url: string;
    readonly startedAtIso: string;
    readonly endedAtIso: string;
    readonly totalDurationMs: number;
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly attempts: readonly UrlCheckAttempt[];
    readonly finalStatusCode: number | null;
  };
}

export interface UrlCheckOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export async function runUrlCheck(url: string, options?: UrlCheckOptions): Promise<UrlCheckResult> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const intervalMs = options?.intervalMs ?? 1_000;
  const requestTimeoutMs = options?.requestTimeoutMs ?? 5_000;
  const fetchImpl = options?.fetchImpl ?? fetch;

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const attempts: UrlCheckAttempt[] = [];

  while (Date.now() - startedAt <= timeoutMs) {
    const attemptStart = Date.now();
    const attemptNumber = attempts.length + 1;
    const attemptStartedAtIso = new Date(attemptStart).toISOString();

    let statusCode: number | null = null;
    let success = false;
    let error: string | null = null;

    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      statusCode = response.status;
      success = statusCode >= 200 && statusCode < 400;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : "Unknown URL check error";
    } finally {
      clearTimeout(requestTimeout);
    }

    const attemptEnd = Date.now();
    attempts.push({
      attempt: attemptNumber,
      startedAtIso: attemptStartedAtIso,
      endedAtIso: new Date(attemptEnd).toISOString(),
      durationMs: attemptEnd - attemptStart,
      statusCode,
      success,
      error,
    });

    if (success) {
      const endedAt = Date.now();
      return {
        passed: true,
        details: [`URL check passed with HTTP status ${statusCode} on attempt ${attemptNumber}`],
        observed: {
          url,
          startedAtIso,
          endedAtIso: new Date(endedAt).toISOString(),
          totalDurationMs: endedAt - startedAt,
          timeoutMs,
          intervalMs,
          attempts,
          finalStatusCode: statusCode,
        },
      };
    }

    if (Date.now() - startedAt > timeoutMs) {
      break;
    }

    await sleep(intervalMs);
  }

  const endedAt = Date.now();
  const finalStatusCode = attempts.length > 0 ? attempts[attempts.length - 1].statusCode : null;

  return {
    passed: false,
    details: [
      `URL check timed out after ${timeoutMs}ms`,
      `Final status code: ${finalStatusCode ?? "none"}`,
      `Attempts: ${attempts.length}`,
    ],
    observed: {
      url,
      startedAtIso,
      endedAtIso: new Date(endedAt).toISOString(),
      totalDurationMs: endedAt - startedAt,
      timeoutMs,
      intervalMs,
      attempts,
      finalStatusCode,
    },
  };
}
