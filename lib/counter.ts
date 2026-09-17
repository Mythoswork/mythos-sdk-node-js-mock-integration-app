import db from "./db";

export function getCount(userId: number): number {
  const row = db
    .prepare("SELECT count FROM user_counters WHERE user_id = ?")
    .get(userId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function incrementCount(userId: number): number {
  db.prepare(
    `INSERT INTO user_counters (user_id, count) VALUES (?, 1)
     ON CONFLICT(user_id) DO UPDATE SET count = count + 1`,
  ).run(userId);
  return getCount(userId);
}
