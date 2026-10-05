"""Convert an Agmarknet / CEDA / data.gov.in CSV into data/prices.csv (date, commodity, modal_price in Rs/kg).
Columns are auto-detected; if not, the script prints your columns and you pass --date/--crop/--price.
Agmarknet prices are Rs/quintal (divided by 100). Use --already-per-kg if your file is already per kg.
Example: python data/normalize_agmarknet.py raw.csv --state Karnataka"""
import argparse, os, pandas as pd
p = argparse.ArgumentParser()
p.add_argument("src"); p.add_argument("dst", nargs="?", default="data/prices.csv")
p.add_argument("--date"); p.add_argument("--crop"); p.add_argument("--price")
p.add_argument("--state"); p.add_argument("--state-col"); p.add_argument("--already-per-kg", action="store_true")
a = p.parse_args()
d = pd.read_csv(a.src); d.columns = [c.strip() for c in d.columns]

def pick(arg, cands):
    if arg: return arg
    low = {c.lower().replace(" ", "_"): c for c in d.columns}
    for k in cands:
        if k in low: return low[k]
    raise SystemExit(f"No column matching {cands}. Your columns: {list(d.columns)} -> pass --date/--crop/--price")

dc = pick(a.date, ["arrival_date", "date", "price_date", "reported_date"])
cc = pick(a.crop, ["commodity", "commodity_name"])
pc = pick(a.price, ["modal_price", "modal_x0020_price", "modal"])
if a.state:
    sc = pick(a.state_col, ["state", "state_name"]); d = d[d[sc].astype(str).str.lower() == a.state.lower()]
div = 1 if a.already_per_kg else 100
out = pd.DataFrame({"date": pd.to_datetime(d[dc], dayfirst=True, errors="coerce"), "commodity": d[cc],
                    "modal_price": pd.to_numeric(d[pc], errors="coerce") / div}).dropna()
out = out[out.modal_price > 0]
out.to_csv(a.dst, index=False)
if a.dst == "data/prices.csv" and os.path.exists("data/SYNTHETIC"): os.remove("data/SYNTHETIC")
print(f"wrote {a.dst}: {len(out)} rows, {out.commodity.nunique()} commodities, {out.date.min().date()} -> {out.date.max().date()}")
print("Sanity check - median Rs/kg (should look like real kg prices):"); print(out.groupby("commodity").modal_price.median().sort_values().tail(5).round(1).to_string())
