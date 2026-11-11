import os
import uuid

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
PAYPAL_CLIENT_ID = os.environ["PAYPAL_CLIENT_ID"]
PAYPAL_SECRET = os.environ["PAYPAL_SECRET"]
PAYPAL_BASE_URL = os.environ.get("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")
LLM_BASE_URL = os.environ["LLM_BASE_URL"].rstrip("/")
LLM_API_KEY = os.environ["LLM_API_KEY"]
LLM_MODEL = os.environ["LLM_MODEL"]

CATEGORIES = ["design", "printing", "manufacturing", "packaging", "delivery"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title="PATCHWORK")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- helpers ----------

def llm_chat(user_prompt: str) -> str:
    r = httpx.post(
        f"{LLM_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {LLM_API_KEY}"},
        json={
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": user_prompt}],
        },
        timeout=60,
    )
    if r.status_code >= 400:
        raise HTTPException(502, f"LLM error {r.status_code}: {r.text}")
    return r.json()["choices"][0]["message"]["content"]


def parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[-1] if text.lower().startswith("json\n") else text
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise HTTPException(502, f"LLM returned non-JSON: {text[:200]}")
    import json
    return json.loads(text[start : end + 1])


def paypal_token() -> str:
    r = httpx.post(
        f"{PAYPAL_BASE_URL}/v1/oauth2/token",
        auth=(PAYPAL_CLIENT_ID, PAYPAL_SECRET),
        data={"grant_type": "client_credentials"},
        timeout=30,
    )
    if r.status_code >= 400:
        raise HTTPException(502, f"PayPal auth error {r.status_code}: {r.text}")
    return r.json()["access_token"]


def line_total(supplier: dict, quantity: int = 1) -> float:
    return round(float(supplier["price_per_unit"]) * int(supplier.get("quantity", quantity)), 2)


def cheapest_by_category(rows: list[dict]) -> dict[str, dict]:
    picks: dict[str, dict] = {}
    for row in rows:  # rows are ordered by price_per_unit asc
        picks.setdefault(row["category"], row)
    return picks


# ---------- models ----------

class DecomposeReq(BaseModel):
    request: str
    budget: float
    deadline_days: int
    quantity: int


class AssembleReq(BaseModel):
    required_categories: list[str]
    budget: float
    deadline_days: int
    quantity: int


class RepairReq(BaseModel):
    failed_supplier_id: str
    current_network: list[dict]


class CheckoutReq(BaseModel):
    network: list[dict]
    customer_email: str


class CaptureReq(BaseModel):
    order_id: str


class NegotiateReq(BaseModel):
    network: list[dict]
    constraint: str


# ---------- endpoints ----------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/suppliers")
def list_suppliers():
    return supabase.table("suppliers").select("*").execute().data


@app.post("/decompose")
def decompose(req: DecomposeReq):
    prompt = (
        f"Customer request: {req.request!r}\n"
        f"Budget: {req.budget} USD, deadline: {req.deadline_days} days, quantity: {req.quantity}.\n"
        f"Pick which supplier categories are required to fulfill it. Allowed categories: {CATEGORIES}.\n"
        'Respond with ONLY JSON: {"required_categories": ["..."], "reasoning": "one short paragraph"}'
    )
    data = parse_json(llm_chat(prompt))
    cats = [c for c in data.get("required_categories", []) if c in CATEGORIES]
    return {"required_categories": cats, "reasoning": data.get("reasoning", "")}


@app.post("/assemble")
def assemble(req: AssembleReq):
    cats = [c for c in req.required_categories if c in CATEGORIES]
    rows = (
        supabase.table("suppliers")
        .select("*")
        .in_("category", cats)
        .eq("available", True)
        .order("price_per_unit")
        .execute()
        .data
    )
    picks = cheapest_by_category(rows)
    network = []
    day = 0
    for cat in cats:
        s = picks.get(cat)
        if not s:
            continue
        entry = {**s, "quantity": req.quantity, "line_total": line_total(s, req.quantity)}
        day += s["delivery_days"]
        network.append(entry)
    total_cost = round(sum(e["line_total"] for e in network), 2)
    max_days = max((e["delivery_days"] for e in network), default=0)
    feasible = bool(network) and total_cost <= req.budget and max_days <= req.deadline_days
    schedule = []
    start = 0
    for i, e in enumerate(network, 1):
        schedule.append(
            {
                "step": i,
                "category": e["category"],
                "supplier": e["name"],
                "delivery_days": e["delivery_days"],
                "start_day": start,
                "end_day": start + e["delivery_days"],
            }
        )
        start += e["delivery_days"]
    # Additive LLM narration: why this network, how confident, what risk.
    llm_extras = {"summary": None, "confidence": None, "risk": None}
    if network:
        try:
            lines = "; ".join(
                f"{e['category']} via {e['name']} at ${e['line_total']} ({e['delivery_days']}d)"
                for e in network
            )
            prompt = (
                f"Assembled supply network: {lines}. "
                f"Total ${total_cost}, longest lead {max_days} days, "
                f"deadline {req.deadline_days} days, budget ${req.budget}, quantity {req.quantity}. "
                'Respond with ONLY JSON: {"summary": "one line on why these suppliers were chosen together", '
                '"confidence": <0-100 integer>, "risk": "one short risk flag or null"}'
            )
            data = parse_json(llm_chat(prompt))
            try:
                conf = max(0, min(100, int(float(data.get("confidence")))))
            except (TypeError, ValueError):
                conf = None
            llm_extras = {
                "summary": data.get("summary") or None,
                "confidence": conf,
                "risk": data.get("risk") or None,
            }
        except Exception:
            pass  # LLM fields are additive — never fail the assemble over them

    return {
        "network": network,
        "total_cost": total_cost,
        "feasible": feasible,
        "schedule": schedule,
        **llm_extras,
    }


@app.post("/assemble/options")
def assemble_options(req: AssembleReq):
    """Three candidate networks for one request: cheapest, fastest, balanced."""
    cats = [c for c in req.required_categories if c in CATEGORIES]
    rows = (
        supabase.table("suppliers")
        .select("*")
        .in_("category", cats)
        .eq("available", True)
        .execute()
        .data
    )

    def pick_per_category(order_key: str, day_cap: int | None = None) -> dict[str, dict]:
        picks: dict[str, dict] = {}
        for cat in cats:
            pool = [r for r in rows if r["category"] == cat]
            if day_cap is not None:
                fitting = [r for r in pool if r["delivery_days"] <= day_cap]
                pool = fitting or pool  # fall back to the cheapest overall
            if pool:
                picks[cat] = min(pool, key=lambda r: (r[order_key], r["price_per_unit"]))
        return picks

    def summarize(label: str, picks: dict[str, dict]) -> dict:
        network = []
        for cat in cats:
            s = picks.get(cat)
            if not s:
                continue
            network.append({**s, "quantity": req.quantity, "line_total": line_total(s, req.quantity)})
        return {
            "label": label,
            "network": network,
            "total_cost": round(sum(e["line_total"] for e in network), 2),
            "max_days": max((e["delivery_days"] for e in network), default=0),
        }

    return [
        summarize("Cheapest", pick_per_category("price_per_unit")),
        summarize("Fastest", pick_per_category("delivery_days")),
        summarize("Balanced", pick_per_category("price_per_unit", day_cap=req.deadline_days)),
    ]


@app.post("/repair")
def repair(req: RepairReq):
    failed = (
        supabase.table("suppliers")
        .select("*")
        .eq("id", req.failed_supplier_id)
        .execute()
        .data
    )
    if not failed:
        raise HTTPException(404, "failed_supplier_id not found")
    failed = failed[0]
    supabase.table("suppliers").update({"available": False}).eq("id", req.failed_supplier_id).execute()

    replacement = (
        supabase.table("suppliers")
        .select("*")
        .eq("category", failed["category"])
        .eq("available", True)
        .neq("id", req.failed_supplier_id)
        .order("price_per_unit")
        .limit(1)
        .execute()
        .data
    )
    if not replacement:
        raise HTTPException(409, f"No available replacement in category '{failed['category']}'")
    replacement = replacement[0]

    quantity = next((e.get("quantity") for e in req.current_network if e.get("id") == req.failed_supplier_id), None)
    updated = []
    for e in req.current_network:
        if e.get("id") == req.failed_supplier_id:
            qty = quantity or e.get("quantity", 1)
            updated.append({**replacement, "quantity": qty, "line_total": line_total(replacement, qty)})
        else:
            updated.append(e)
    new_total = round(sum(float(e.get("line_total", e["price_per_unit"])) for e in updated), 2)

    # Additive LLM narration: why the substitution, what it costs the plan.
    llm_extras = {"explanation": None, "impact": None}
    try:
        prompt = (
            f"Supplier '{failed['name']}' in category '{failed['category']}' became unavailable "
            f"and was replaced by '{replacement['name']}' at ${replacement['price_per_unit']}/unit "
            f"({replacement['delivery_days']}d lead vs {failed['delivery_days']}d before). "
            f"New network total ${new_total}. "
            'Respond with ONLY JSON: {"explanation": "one sentence explaining the substitution", '
            '"impact": "no impact" | "minor delay" | "cost increase"}'
        )
        data = parse_json(llm_chat(prompt))
        impact = data.get("impact")
        llm_extras = {
            "explanation": data.get("explanation") or None,
            "impact": impact if impact in ("no impact", "minor delay", "cost increase") else None,
        }
    except Exception:
        pass  # LLM fields are additive — never fail the repair over them

    return {
        "updated_network": updated,
        "replaced_supplier": replacement,
        "new_total": new_total,
        **llm_extras,
    }


@app.post("/negotiate")
def negotiate(req: NegotiateReq):
    lines = "; ".join(
        f"{e.get('category', 'unknown')} via {e.get('name', 'supplier')} "
        f"at ${e.get('line_total', e.get('price_per_unit', '?'))} ({e.get('delivery_days', '?')}d)"
        for e in req.network
    )
    prompt = (
        f"Current supply network: {lines or 'empty'}. "
        f"Customer constraint: {req.constraint!r}. "
        "Suggest the single best supplier swap to satisfy the constraint. "
        'Respond with ONLY JSON: {"suggestion": "one short sentence", '
        '"swap_category": "one of design, printing, manufacturing, packaging, delivery", '
        '"reasoning": "one or two sentences of why"}'
    )
    try:
        data = parse_json(llm_chat(prompt))
        cat = data.get("swap_category")
        return {
            "suggestion": data.get("suggestion") or None,
            "swap_category": cat if cat in CATEGORIES else None,
            "reasoning": data.get("reasoning") or None,
        }
    except Exception:
        return {"suggestion": None, "swap_category": None, "reasoning": None}


@app.post("/checkout")
def checkout(req: CheckoutReq):
    token = paypal_token()
    units = []
    for e in req.network:
        units.append(
            {
                "reference_id": e["id"],
                "description": f"{e['name']} ({e['category']})"[:127],
                "custom_id": req.customer_email,
                "amount": {"currency_code": "USD", "value": f"{float(e.get('line_total', e['price_per_unit'])):.2f}"},
            }
        )
    r = httpx.post(
        f"{PAYPAL_BASE_URL}/v2/checkout/orders",
        headers={
            "Authorization": f"Bearer {token}",
            "PayPal-Request-Id": str(uuid.uuid4()),
        },
        json={"intent": "CAPTURE", "purchase_units": units},
        timeout=30,
    )
    if r.status_code >= 400:
        raise HTTPException(502, f"PayPal order error {r.status_code}: {r.text}")
    order = r.json()
    approval_url = next((l["href"] for l in order.get("links", []) if l["rel"] == "approve"), None)
    return {"order_id": order["id"], "approval_url": approval_url}


@app.post("/checkout/capture")
def capture(req: CaptureReq):
    token = paypal_token()
    r = httpx.post(
        f"{PAYPAL_BASE_URL}/v2/checkout/orders/{req.order_id}/capture",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=30,
    )
    if r.status_code >= 400:
        raise HTTPException(502, f"PayPal capture error {r.status_code}: {r.text}")
    order = r.json()
    payments = []
    for pu in order.get("purchase_units", []):
        for cap in pu.get("payments", {}).get("captures", []):
            payments.append(
                {
                    "capture_id": cap.get("id"),
                    "status": cap.get("status"),
                    "amount": cap.get("amount"),
                    "reference_id": pu.get("reference_id"),
                }
            )
    return {"status": order.get("status"), "payments": payments}
