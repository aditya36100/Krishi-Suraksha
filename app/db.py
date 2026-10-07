import sqlite3, os
DB = os.getenv("KS_DB", "krishi.db")

def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

def init():
    with conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, role TEXT, loc TEXT);
        CREATE TABLE IF NOT EXISTS listings(id INTEGER PRIMARY KEY, farmer_id INT, crop TEXT, qty REAL,
            harvest_date TEXT, price REAL, loc TEXT, mandi_ref REAL);
        CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, listing_id INT, buyer_id INT, qty REAL,
            amount REAL, state TEXT DEFAULT 'PLACED', deposit_pct REAL, created TEXT);
        CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY, order_id INT, event TEXT, detail TEXT,
            ts TEXT, prev_hash TEXT, hash TEXT);
        CREATE TABLE IF NOT EXISTS outcomes(id INTEGER PRIMARY KEY, order_id INT, party_id INT, kind TEXT, ok INT);
        """)
        try:
            c.execute("ALTER TABLE listings ADD COLUMN status TEXT DEFAULT 'ACTIVE'")
        except sqlite3.OperationalError:
            pass
