import Database from "better-sqlite3";

export function openDb(path = process.env.DB_PATH ?? "data/bets.db"): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY,
      placed_at TEXT NOT NULL,
      description TEXT NOT NULL,
      stake_pence INTEGER NOT NULL,
      odds_hundredths INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'won', 'lost', 'void')),
      returns_pence INTEGER
    );
  `);
}
