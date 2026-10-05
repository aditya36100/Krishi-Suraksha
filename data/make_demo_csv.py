"""Writes SYNTHETIC weekly prices so the pipeline runs. Replace with real data (see normalize_agmarknet.py)."""
import numpy as np, pandas as pd, os
rng = np.random.default_rng(7)
dates = pd.date_range("2020-01-05", periods=300, freq="W")
rows = []
for crop, base, amp, tr in [("Avocado", 95, 12, .08), ("Dragon fruit", 110, 10, .06), ("Tomato", 30, 14, .02), ("Onion", 25, 8, .01)]:
    t = np.arange(len(dates))
    p = base + tr * t + amp * np.sin(2 * np.pi * t / 52) + np.cumsum(rng.normal(0, 1.2, len(t)))
    rows += [(d, crop, max(5, v)) for d, v in zip(dates, p)]
os.makedirs("data", exist_ok=True)
pd.DataFrame(rows, columns=["date", "commodity", "modal_price"]).to_csv("data/prices.csv", index=False)
print("wrote data/prices.csv (SYNTHETIC - do not report results from this in a paper)")
open("data/SYNTHETIC", "w").write("synthetic")
