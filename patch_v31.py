import sys

def patch(path, pairs):
    s = open(path, encoding="utf-8").read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:60], s.count(old))
        s = s.replace(old, new)
    open(path, "w", encoding="utf-8").write(s)

if "def undo(" in open("app/escrow.py", encoding="utf-8").read():
    sys.exit("Already applied - nothing to do.")

patch("app/db.py", [('        """)\n', '        """)\n        try:\n            c.execute("ALTER TABLE listings ADD COLUMN status TEXT DEFAULT \'ACTIVE\'")\n        except sqlite3.OperationalError:\n            pass\n')])

open("app/escrow.py", "a").write('''

UNDO = {"HARVESTED": "FUNDED", "SHIPPED": "HARVESTED", "DELIVERED": "SHIPPED"}
UNDO_MINUTES = 15

def undo(oid):
    """Revert the latest non-money step within a short window. Appends an UNDO event; history is never deleted."""
    with conn() as c:
        o = c.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
        if not o:
            raise ValueError("no such order")
        prev = UNDO.get(o["state"])
        if not prev:
            raise ValueError(f"cannot undo from {o['state']} (money steps use cancel/refund/dispute)")
        last = c.execute("SELECT ts FROM ledger WHERE order_id=? ORDER BY id DESC LIMIT 1", (oid,)).fetchone()
        age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(last["ts"])).total_seconds() / 60
        if age > UNDO_MINUTES:
            raise ValueError(f"undo window ({UNDO_MINUTES} min) has passed - raise a dispute instead")
        c.execute("UPDATE orders SET state=? WHERE id=?", (prev, oid))
        _log(c, oid, "UNDO", {"from": o["state"], "to": prev})
''')

patch("app/main.py", [
 ("WHERE l.qty>0 AND ", "WHERE l.qty>0 AND l.status='ACTIVE' AND "),
 ('    if action not in ACTIONS:\n        raise HTTPException(404, "unknown action")',
  '    if action == "undo":\n        try:\n            escrow.undo(oid)\n        except ValueError as e:\n            raise HTTPException(400, str(e))\n        return {"id": oid, "state": "undone"}\n    if action not in ACTIONS:\n        raise HTTPException(404, "unknown action")')])
open("app/main.py", "a").write('''

@app.delete("/listings/{lid}")
def withdraw(lid: int):
    with conn() as c:
        n = c.execute("SELECT COUNT(*) FROM orders WHERE listing_id=? AND state NOT IN ('CANCELLED','REFUNDED','RELEASED')", (lid,)).fetchone()[0]
        if n:
            raise HTTPException(400, f"{n} active order(s) on this listing - cancel or refund them first")
        c.execute("UPDATE listings SET status='WITHDRAWN' WHERE id=?", (lid,))
    return {"id": lid, "status": "WITHDRAWN"}
''')

patch("frontend/index.html", [
 ('<header><h1>🌱 Krishi Suraksha</h1><select id="lang"',
  '<header><h1>🌱 Krishi Suraksha</h1><div style="display:flex;gap:8px"><select id="role" style="width:auto" onchange="setRole(this.value)"><option value="farmer">View as: Farmer</option><option value="buyer">View as: Buyer</option><option value="admin">View as: Admin</option></select><select id="lang"'),
 ('<option value="kn">ಕನ್ನಡ</option></select></header>', '<option value="kn">ಕನ್ನಡ</option></select></div></header>'),
 ('let L="en",tab="farmer",', 'let R="farmer",L="en",tab="farmer",'),
 ('refund:"Refund"};', 'refund:"Refund buyer",undo:"↩ Undo last step"};'),
 ('''${(NX[o.state]||[]).map(a=>`<button class="b s" onclick="act(${o.id},'${a}')">${LB[a]}</button>`).join("")}''', '${btns(o)}'),
 ('async function act(id,a){', '''const PERM={farmer:["harvest","ship","cancel","refund","dispute"],buyer:["fund","cancel","deliver","release","dispute"],admin:["release","refund"]};
const UNDOR={HARVESTED:"farmer",SHIPPED:"farmer",DELIVERED:"buyer"};
function btns(o){let a=(NX[o.state]||[]).filter(x=>PERM[R].includes(x)&&(o.state=="DISPUTED"?R=="admin":R!="admin"));
 if(UNDOR[o.state]==R)a.push("undo");
 let h=a.map(x=>`<button class="b s" onclick="act(${o.id},'${x}')">${LB[x]}</button>`).join("");
 if(R=="admin"&&o.state=="DISPUTED")h+=`<button class="b s" onclick="fault(${o.id},${o.farmer_id})">Fault: farmer</button><button class="b s" onclick="fault(${o.id},${o.buyer_id})">Fault: buyer</button>`;
 return h}
async function fault(id,p){try{await api(`/orders/${id}/fault/${p}`,"POST");toast("Fault recorded on that party's trust score")}catch(e){toast(e.message)}}
async function act(id,a){'''),
 ('<div class="big">${fk(l.price)}/kg</div><div class="mu">${prem(l)}</div></div>', '<div class="big">${fk(l.price)}/kg</div><div class="mu">${prem(l)}</div><button class="b s" onclick="wd(${l.id})">Withdraw listing</button></div>'),
 ('</span> vs forecast mandi ${fk(l.mandi_ref)}', '</span>${R=="buyer"?" vs market benchmark":" vs forecast mandi "+fk(l.mandi_ref)}'),
 ('async function addL(){try{', 'async function addL(){if(!confirm(`Publish ${$("#q").value} kg ${$("#c").value} at ₹${$("#p").value}/kg?`))return;try{'),
 ('V.buyer=async()=>{const B=', 'async function wd(id){if(!confirm("Withdraw this listing?"))return;try{await api("/listings/"+id,"DELETE");toast("Listing withdrawn");go("farmer")}catch(e){toast(e.message)}}\nV.buyer=async()=>{const B='),
 ('V.orders=async()=>`<h2>All orders</h2>${(await api("/orders")).map(ordCard).join("")||"—"}`;',
  'V.orders=async()=>{let os=await api("/orders");if(R=="buyer")os=os.filter(o=>o.buyer_id==bid);return`<h2>${R=="admin"?"All orders":"My orders"}</h2>${os.map(ordCard).join("")||"—"}`};'),
 ('async function go(x){tab=x;$("#nav").innerHTML=["farmer","buyer","orders","price","admin"].map(',
  'const TABS={farmer:["farmer","price"],buyer:["buyer","orders"],admin:["admin","orders"]};\nfunction setRole(r){R=r;go(TABS[r][0])}\nasync function go(x){tab=x;$("#nav").innerHTML=TABS[R].map('),
])
print("patched")