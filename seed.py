"""Seeds DEMO users/listings/orders on top of whatever is in data/prices.csv.
Usage: python seed.py [Crop1 Crop2 ...]   (default: the 4 crops with the most price history)"""
import sys, random, datetime
from app import db, escrow, pricing
from app.db import conn
from app.main import _forecast, CSV, MARGIN
db.init()
with conn() as c:
    if c.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        raise SystemExit("Already seeded. Delete krishi.db to start fresh.")
random.seed(3)
d = pricing.load(CSV)
wk = d.groupby("commodity")["date"].apply(lambda x: x.dt.to_period("W").nunique()).sort_values(ascending=False)
crops = sys.argv[1:] or [str(x) for x in wk[wk >= 60].index[:4]]
print("crops:", crops)
F = [("Ramesh Gowda", "Kolar"), ("Lakshmi Devi", "Chikkaballapur"), ("Mahesh Poovaiah", "Kodagu")]
B = [("Green Leaf Restaurant", "Bengaluru"), ("Taj Residency Hotels", "Bengaluru"), ("FreshMart Supermarket", "Mysuru"), ("AgroExports Pvt Ltd", "Bengaluru")]
with conn() as c:
    fid = [c.execute("INSERT INTO users(name,role,loc) VALUES(?,?,?)", (n, "farmer", l)).lastrowid for n, l in F]
    bid = [c.execute("INSERT INTO users(name,role,loc) VALUES(?,?,?)", (n, "buyer", l)).lastrowid for n, l in B]
lids = []
for i in range(6):
    crop, hd = crops[i % len(crops)], (datetime.date.today() + datetime.timedelta(days=7 + 3 * i)).isoformat()
    f = _forecast(crop, hd)
    price = round(f["point"] * (1 + MARGIN) * random.uniform(0.97, 1.08), 2)
    with conn() as c:
        lids.append(c.execute("INSERT INTO listings(farmer_id,crop,qty,harvest_date,price,loc,mandi_ref) VALUES(?,?,?,?,?,?,?)",
                    (fid[i % 3], crop, random.randint(150, 600), hd, price, F[i % 3][1], f["point"])).lastrowid)

def order(lid, buyer, qty, steps):
    with conn() as c:
        l = c.execute("SELECT * FROM listings WHERE id=?", (lid,)).fetchone()
        oid = c.execute("INSERT INTO orders(listing_id,buyer_id,qty,amount,deposit_pct,created) VALUES(?,?,?,?,?,?)",
                        (lid, buyer, qty, round(qty * l["price"], 2), 0.3, datetime.datetime.now().isoformat())).lastrowid
        c.execute("UPDATE listings SET qty=qty-? WHERE id=?", (qty, lid))
    escrow.start(oid)
    for s in ["FUNDED", "HARVESTED", "SHIPPED", "DELIVERED", "RELEASED"][:steps]:
        escrow.move(oid, s)
    if steps == 5:
        with conn() as c:
            for pid in (l["farmer_id"], buyer):
                c.execute("INSERT INTO outcomes(order_id,party_id,kind,ok) VALUES(?,?,?,1)", (oid, pid, "seed"))

for lid, b, q, st in [(lids[0], bid[0], 50, 5), (lids[1], bid[1], 40, 5), (lids[2], bid[3], 60, 5),
                      (lids[3], bid[2], 30, 3), (lids[4], bid[0], 25, 1), (lids[5], bid[1], 45, 0)]:
    order(lid, b, q, st)
print("seeded: 3 farmers, 4 buyers, 6 listings, 6 orders (DEMO data; prices come from data/prices.csv)")
