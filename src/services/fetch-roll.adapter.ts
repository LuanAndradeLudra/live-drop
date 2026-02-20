// src/services/fetch-roll.adapter.ts
export type FetchInput = {
  userId: string;
  rollId: string;
  type: 'upgrade' | 'case';
  timeoutMs?: number;
};

export type UpgradeResult = {
  type: 'upgrade';
  rollId: string;
  skinsBalance: string;
  balance: string;
  chance: string;
  receivedBalance: string;
  firstValue: string;
  secondValue: string;
  usedSkinsFormatted: Array<{ name: string; type: string; image: string; rarity: string }>;
  receivedSkinsFormatted: { name: string; type: string; image: string; rarity: string } | null;
  html: string;
};

export type CaseResult = {
  type: 'case';
  rollId: string;
  provablyUrl: string;
  rollNumber: number | null;
  case: { name: string; image: string; price: number | null; currency: string | null };
  drop: { name: string; image: string; price: number | null; currency: string | null; oddsPercent: number | null; range: string | null };
};

export type FetchOutput = UpgradeResult | CaseResult;

// IMPORTA O TEU JS REAL (mantenha o nome diferente!)
import { fetchRollBlockHTML as jsFetch } from './fetch-roll.service.js';

export async function fetchRollBlockHTML(input: FetchInput): Promise<FetchOutput> {
  return jsFetch(input) as Promise<FetchOutput>;
}
