import path from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserSessionOptions {
  readonly storageStatePath: string;
  readonly headless?: boolean;
}

export interface BrowserSession {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  close(): Promise<void>;
}

export async function createBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  const resolvedStorageStatePath = path.resolve(process.cwd(), options.storageStatePath);
  await access(resolvedStorageStatePath, constants.R_OK);

  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext({
    storageState: resolvedStorageStatePath,
  });
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    async close(): Promise<void> {
      await context.close();
      await browser.close();
    },
  };
}
