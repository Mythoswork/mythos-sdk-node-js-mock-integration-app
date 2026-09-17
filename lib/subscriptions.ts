import db from "./db";

const SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function isSubscribed(userId: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM subscriptions
       WHERE user_id = ? AND end_date > datetime('now')
       LIMIT 1`,
    )
    .get(userId);
  return row !== undefined;
}

export function subscribe(userId: number): void {
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + SUBSCRIPTION_DURATION_MS);
  db.prepare(
    "INSERT INTO subscriptions (user_id, start_date, end_date) VALUES (?, ?, ?)",
  ).run(userId, startDate.toISOString(), endDate.toISOString());
}
