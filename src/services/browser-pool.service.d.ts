import type { Browser, Page } from 'puppeteer';

export function getBrowser(): Promise<Browser>;
export function withPage<T>(
  fn: (page: Page) => Promise<T>,
  options?: {
    name?: string;
    createTimeoutMs?: number;
    retries?: number;
  }
): Promise<T>;
export function closeBrowser(): Promise<void>;
export function stats(): {
  active: number;
  queued: number;
  hasBrowser: boolean;
  isConnected: boolean;
};

