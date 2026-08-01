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
    CREATE TABLE IF NOT EXISTS tipsters (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS bets (
      id                 INTEGER PRIMARY KEY,
      placed_at          TEXT NOT NULL,
      event              TEXT NOT NULL,
      selection          TEXT NOT NULL,
      tipster_id         INTEGER REFERENCES tipsters(id),
      stake_pence        INTEGER NOT NULL,
      odds_hundredths    INTEGER NOT NULL,
      bet_type           TEXT NOT NULL DEFAULT 'single'
                           CHECK (bet_type IN ('single', 'each_way')),
      stake_type         TEXT NOT NULL DEFAULT 'cash'
                           CHECK (stake_type IN ('cash', 'free_snr', 'free_sr')),
      place_fraction_num INTEGER,
      place_fraction_den INTEGER,
      places_count       INTEGER,
      status             TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','won','placed','dead_heat','lost','void')),
      returns_pence      INTEGER,
      deleted_at         TEXT
    );
  `);
}
