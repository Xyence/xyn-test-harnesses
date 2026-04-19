export function getByPath(value: unknown, path: string): unknown {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let current: unknown = value;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function collectStringValues(value: unknown): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  function walk(node: unknown): void {
    if (typeof node === "string") {
      const normalized = node.trim();
      if (normalized.length > 0 && !seen.has(normalized)) {
        seen.add(normalized);
        values.push(normalized);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const item of Object.values(node)) {
        walk(item);
      }
    }
  }

  walk(value);
  return values;
}

export function collectObjectsByType(value: unknown, expectedType: string): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  const expected = expectedType.toLowerCase();

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }

    if (typeof node !== "object" || node === null) {
      return;
    }

    const record = node as Record<string, unknown>;
    const candidates = [record.type, record.kind, record.entity_type, record.resource_type]
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.toLowerCase());

    if (candidates.some((candidate) => candidate.includes(expected))) {
      matches.push(record);
    }

    for (const item of Object.values(record)) {
      walk(item);
    }
  }

  walk(value);
  return matches;
}
