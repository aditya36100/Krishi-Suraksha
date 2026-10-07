import datetime, math, os
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from . import db, escrow, pricing, reliability
from .db import conn

db.init()
app = FastAPI(title="Krishi Suraksha API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])  # dev only

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.getenv("KS_PRICES", os.path.join(BASE, "data", "prices.csv"))
MARGIN = float(os.getenv("KS_MARGIN", "0.15"))  # direct-sale premium; calibrate from real transactions
ACTIONS = {"fund": "FUNDED", "harvest": "HARVESTED", "ship": "SHIPPED", "deliver": "DELIVERED",
           "release": "RELEASED", "dispute": "DISPUTED", "refund": "REFUNDED", "cancel": "CANCELLED"}

class User(BaseModel):
    name: str; role: str; loc: str = ""
class Listing(BaseModel):
    farmer_id: int; crop: str; qty: float; harvest_date: str; price: float; loc: str = ""
class Order(BaseModel):
    listing_id: int; buyer_id: int; qty: float; deposit_pct: float = 0.3

def _forecast(crop, harvest_date):
    days = (datetime.date.fromisoformat(harvest_date) - datetime.date.today()).days
    f = pricing.forecast(pricing.weekly(pricing.load(CSV), crop), max(1, math.ceil(days / 7)))
    f["suggested"] = round(f["point"] * (1 + MARGIN), 2)
    return f

@app.post("/users")
def add_user(u: User):
    with conn() as c:
        return {"id": c.execute("INSERT INTO users(name,role,loc) VALUES(?,?,?)", (u.name, u.role, u.loc)).lastrowid}

@app.post("/listings")
def add_listing(l: Listing):
    try:
        ref = _forecast(l.crop, l.harvest_date)["point"]
    except Exception:
        ref = None
    with conn() as c:
        cur = c.execute("INSERT INTO listings(farmer_id,crop,qty,harvest_date,price,loc,mandi_ref) VALUES(?,?,?,?,?,?,?)",
                        (l.farmer_id, l.crop, l.qty, l.harvest_date, l.price, l.loc, ref))
        return {"id": cur.lastrowid, "mandi_ref": ref}

@app.get("/listings")
def listings(crop: str = "", loc: str = ""):
    with conn() as c:
        rows = c.execute("SELECT l.*, u.name farmer_name FROM listings l LEFT JOIN users u ON u.id=l.farmer_id "
                         "WHERE l.qty>0 AND l.status='ACTIVE' AND (?='' OR l.crop=?) AND (?='' OR l.loc=?)", (crop, crop, loc, loc)).fetchall()
    out = []
    for r in rows:
        d = dict(r); d["farmer_reliability"] = reliability.score(r["farmer_id"]); out.append(d)
    return out

@app.post("/orders")
def place(o: Order):
    with conn() as c:
        l = c.execute("SELECT * FROM listings WHERE id=?", (o.listing_id,)).fetchone()
        if not l:
            raise HTTPException(404, "listing not found")
        if o.qty <= 0 or o.qty > l["qty"]:
            raise HTTPException(400, "invalid quantity")
        oid = c.execute("INSERT INTO orders(listing_id,buyer_id,qty,amount,deposit_pct,created) VALUES(?,?,?,?,?,?)",
                        (o.listing_id, o.buyer_id, o.qty, round(o.qty * l["price"], 2), o.deposit_pct,
                         datetime.datetime.now().isoformat())).lastrowid
        c.execute("UPDATE listings SET qty=qty-? WHERE id=?", (o.qty, o.listing_id))
    escrow.start(oid)
    return {"id": oid, "state": "PLACED"}

@app.post("/orders/{oid}/{action}")
def act(oid: int, action: str):
    if action == "undo":
        try:
            escrow.undo(oid)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"id": oid, "state": "undone"}
    if action not in ACTIONS:
        raise HTTPException(404, "unknown action")
    new = ACTIONS[action]
    try:
        escrow.move(oid, new)
    except ValueError as e:
        raise HTTPException(400, str(e))
    with conn() as c:
        o = c.execute("SELECT o.*, l.farmer_id FROM orders o JOIN listings l ON l.id=o.listing_id WHERE o.id=?", (oid,)).fetchone()
        if new in ("REFUNDED", "CANCELLED"):
            c.execute("UPDATE listings SET qty=qty+? WHERE id=?", (o["qty"], o["listing_id"]))
        if new == "RELEASED":
            for pid, kind in ((o["farmer_id"], "farmer_fulfil"), (o["buyer_id"], "buyer_accept")):
                c.execute("INSERT INTO outcomes(order_id,party_id,kind,ok) VALUES(?,?,?,1)", (oid, pid, kind))
    return {"id": oid, "state": new}

@app.post("/orders/{oid}/fault/{party_id}")
def fault(oid: int, party_id: int):  # admin marks the party at fault after a dispute
    with conn() as c:
        c.execute("INSERT INTO outcomes(order_id,party_id,kind,ok) VALUES(?,?,?,0)", (oid, party_id, "fault"))
    return {"ok": True}

@app.get("/orders/{oid}/ledger")
def ledger(oid: int):
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM ledger WHERE order_id=? ORDER BY id", (oid,))]

@app.get("/ledger/verify")
def verify():
    ok, bad = escrow.verify_chain()
    return {"intact": ok, "first_bad_id": bad}

@app.get("/price/{crop}")
def price(crop: str, harvest_date: str):
    try:
        return _forecast(crop, harvest_date)
    except FileNotFoundError:
        raise HTTPException(404, "prices.csv missing - run data/make_demo_csv.py")
    except ValueError as e:
        raise HTTPException(422, str(e))

@app.get("/reliability/{user_id}")
def rel(user_id: int):
    return reliability.score(user_id)

@app.get("/admin/summary")
def summary():
    with conn() as c:
        g = lambda q: c.execute(q).fetchone()[0]
        gmv = g("SELECT COALESCE(SUM(amount),0) FROM orders WHERE state='RELEASED'")
        prem = g("SELECT AVG(l.price/l.mandi_ref-1)*100 FROM orders o JOIN listings l ON l.id=o.listing_id "
                 "WHERE o.state='RELEASED' AND l.mandi_ref>0")
        out = {"users": g("SELECT COUNT(*) FROM users"), "orders": g("SELECT COUNT(*) FROM orders"),
               "gmv_released": gmv, "platform_fee": round(gmv * escrow.FEE, 2),
               "avg_farmer_premium_pct": None if prem is None else round(prem, 1)}
    out["ledger_intact"] = escrow.verify_chain()[0]
    return out


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(os.path.join(BASE, "frontend", "index.html"))

@app.get("/meta")
def meta():
    d = pricing.load(CSV)
    wk = d.groupby("commodity")["date"].apply(lambda x: x.dt.to_period("W").nunique())
    ok = wk[wk >= 60].sort_values(ascending=False)
    return {"synthetic": os.path.exists(os.path.join(BASE, "data", "SYNTHETIC")), "rows": int(len(d)),
            "from": str(d["date"].min().date()), "to": str(d["date"].max().date()), "crops": [str(c) for c in ok.index[:60]]}

@app.get("/price/{crop}/history")
def hist(crop: str, weeks: int = 52):
    s = pricing.weekly(pricing.load(CSV), crop).tail(weeks)
    return {"dates": [str(i.date()) for i in s.index], "values": [round(float(v), 2) for v in s.values]}

@app.get("/users")
def users():
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM users")]

@app.get("/orders")
def orders():
    with conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT o.*, l.crop, l.price, l.farmer_id, fu.name farmer, bu.name buyer FROM orders o "
            "JOIN listings l ON l.id=o.listing_id LEFT JOIN users fu ON fu.id=l.farmer_id "
            "LEFT JOIN users bu ON bu.id=o.buyer_id ORDER BY o.id DESC")]


@app.delete("/listings/{lid}")
def withdraw(lid: int):
    with conn() as c:
        n = c.execute("SELECT COUNT(*) FROM orders WHERE listing_id=? AND state NOT IN ('CANCELLED','REFUNDED','RELEASED')", (lid,)).fetchone()[0]
        if n:
            raise HTTPException(400, f"{n} active order(s) on this listing - cancel or refund them first")
        c.execute("UPDATE listings SET status='WITHDRAWN' WHERE id=?", (lid,))
    return {"id": lid, "status": "WITHDRAWN"}
