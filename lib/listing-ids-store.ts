import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { Redis } from '@upstash/redis';

// Vercel Serverless Functions are isolated per route file — each has its own
// /tmp, so a file store can never share state between e.g. the callback
// handler and the catch-all Mythos route. Redis (Vercel KV / Upstash, free tier) is
// required for that to actually work in production; falls back to a local
// JSON file for zero-setup local dev, matching the file's original scope
// (this app has no real persistence layer — demonstration only).
const REDIS_URL = process.env.MYTHOS_LISTING_UPSTASH_KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.MYTHOS_LISTING_UPSTASH_KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_SET_KEY = 'mythos:listing-ids';

const redis =
  REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

const STORE_PATH = path.join(os.tmpdir(), 'mythos-calculator-mockup', 'listing-ids.json');

async function readFileStore(): Promise<string[]> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    return JSON.parse(raw) as string[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeFileStore(ids: string[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(ids), 'utf8');
}

export async function addListingId(listingId: string): Promise<void> {
  if (redis) {
    await redis.sadd(REDIS_SET_KEY, listingId);
    return;
  }
  const ids = await readFileStore();
  if (!ids.includes(listingId)) {
    ids.push(listingId);
    await writeFileStore(ids);
  }
}

export async function getListingIds(): Promise<string[]> {
  if (redis) {
    return await redis.smembers(REDIS_SET_KEY);
  }
  return await readFileStore();
}
