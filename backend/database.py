"""
Database initialization - creates all tables on first run.
Migrates existing users.db data structure into the unified DB.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "instance", "trading_platform.db")

def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    # ── users ──────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT UNIQUE NOT NULL,
            password   TEXT NOT NULL,
            email      TEXT,
            phone      TEXT,
            otp        TEXT,
            otp_expiry TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # ── broker_accounts ────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS broker_accounts (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            broker_name       TEXT DEFAULT 'angelone',
            api_key           TEXT,
            client_id         TEXT,
            encrypted_token   TEXT,
            refresh_token     TEXT,
            feed_token        TEXT,
            angel_user_id     TEXT,
            connection_status TEXT DEFAULT 'disconnected',
            connected_at      TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # ── watchlist ──────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS watchlist (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            symbol     TEXT NOT NULL,
            exchange   TEXT DEFAULT 'NSE',
            token      TEXT,
            added_at   TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, symbol),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # ── candle_cache ───────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS candle_cache (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol     TEXT NOT NULL,
            exchange   TEXT NOT NULL,
            timeframe  TEXT NOT NULL,
            timestamp  TEXT NOT NULL,
            open       REAL,
            high       REAL,
            low        REAL,
            close      REAL,
            volume     INTEGER,
            UNIQUE(symbol, timeframe, timestamp)
        )
    """)

    # ── strategies ─────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS strategies (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL,
            strategy_name    TEXT NOT NULL,
            symbol           TEXT,
            exchange         TEXT DEFAULT 'NSE',
            timeframe        TEXT DEFAULT '5m',
            strategy_logic   TEXT,
            active_status    INTEGER DEFAULT 0,
            created_at       TEXT DEFAULT (datetime('now')),
            updated_at       TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # ── orders ─────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            symbol          TEXT NOT NULL,
            exchange        TEXT DEFAULT 'NSE',
            order_type      TEXT,
            transaction_type TEXT,
            quantity        INTEGER,
            price           REAL,
            trigger_price   REAL,
            status          TEXT DEFAULT 'PENDING',
            broker_order_id TEXT,
            strategy_id     INTEGER,
            created_at      TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # ── positions ──────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS positions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            symbol        TEXT NOT NULL,
            exchange      TEXT DEFAULT 'NSE',
            quantity      INTEGER,
            average_price REAL,
            pnl           REAL,
            product_type  TEXT DEFAULT 'INTRADAY',
            updated_at    TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # ── Auto-migrate missing columns for existing SQLite files ──────────
    broker_cols = [row[1] for row in c.execute("PRAGMA table_info(broker_accounts)").fetchall()]
    needed_broker_cols = {
        "refresh_token": "TEXT",
        "feed_token": "TEXT",
        "angel_user_id": "TEXT",
        "connected_at": "TEXT",
    }
    for col, col_type in needed_broker_cols.items():
        if col not in broker_cols:
            c.execute(f"ALTER TABLE broker_accounts ADD COLUMN {col} {col_type}")

    strategy_cols = [row[1] for row in c.execute("PRAGMA table_info(strategies)").fetchall()]
    needed_strategy_cols = {
        "symbol": "TEXT",
        "exchange": "TEXT DEFAULT 'NSE'",
        "timeframe": "TEXT DEFAULT '5m'",
        "updated_at": "TEXT",
    }
    for col, col_type in needed_strategy_cols.items():
        if col not in strategy_cols:
            c.execute(f"ALTER TABLE strategies ADD COLUMN {col} {col_type}")

    conn.commit()
    conn.close()
    print("✅ Database initialized")
