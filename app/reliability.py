"""Beta-Bernoulli reliability score (shrinks toward 0.5 for new users). Lower bound is what buyers/farmers should rank by."""
from .db import conn

def score(party_id, a0=2, b0=2):
    with conn() as c:
        r = c.execute("SELECT COALESCE(SUM(ok),0) s, COUNT(*) n FROM outcomes WHERE party_id=?", (party_id,)).fetchone()
    a, b = a0 + r["s"], b0 + r["n"] - r["s"]
    m = a / (a + b)
    sd = (a * b / ((a + b) ** 2 * (a + b + 1))) ** 0.5
    return {"score": round(m, 3), "lower": round(max(0.0, m - 1.64 * sd), 3), "n": r["n"]}
