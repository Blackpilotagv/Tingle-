"""
Run this ONCE on your existing trading_platform.db to add the missing columns.
It is safe to run multiple times (uses IF NOT EXISTS logic via try/except).

Usage:
    python migrate_db.py
"""

import sqlite3
import os

# Adjust this path if your db is elsewhere
DB_PATH = os.path.join("instance", "trading_platform.db")

def migrate():
    if not os.path.exists(DB_PATH):
        print(f"DB not found at {DB_PATH}. Run app.py first to create it.")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    columns_to_add = [
        ("broker_accounts", "refresh_token",  "TEXT"),
        ("broker_accounts", "angel_user_id",  "TEXT"),
    ]

    for table, col, col_type in columns_to_add:
        try:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
            print(f"✅ Added column {table}.{col}")
        except sqlite3.OperationalError as e:
            if "duplicate column" in str(e).lower():
                print(f"ℹ  Column {table}.{col} already exists, skipping")
            else:
                raise

    conn.commit()
    conn.close()
    print("\nMigration complete. Restart app.py now.")

if __name__ == "__main__":
    migrate()
