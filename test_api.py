"""Sequential smoke test for the PATCHWORK API."""
import os
import sys

import httpx

BASE = os.environ.get("PATCHWORK_BASE_URL", "http://localhost:8000")

results = []


def step(n, name, fn):
    try:
        summary = fn()
        results.append((name, True, summary))
        print(f"PASS [{n}] {name}: {summary}")
    except Exception as exc:
        results.append((name, False, str(exc)))
        print(f"FAIL [{n}] {name}: {exc}")


client = httpx.Client(base_url=BASE, timeout=60)
state = {}

# 1. GET /health
def t_health():
    r = client.get("/health")
    r.raise_for_status()
    assert r.json().get("status") == "ok", r.text
    return r.json()

step(1, "GET /health", t_health)

# 2. POST /decompose
def t_decompose():
    r = client.post("/decompose", json={
        "request": "100 branded welcome kits",
        "budget": 2000, "deadline_days": 7, "quantity": 100,
    })
    r.raise_for_status()
    data = r.json()
    assert data.get("required_categories"), r.text
    state["categories"] = data["required_categories"]
    return f"categories={data['required_categories']} | {data.get('reasoning', '')[:80]}"

step(2, "POST /decompose", t_decompose)

# 3. POST /assemble
def t_assemble():
    r = client.post("/assemble", json={
        "required_categories": state["categories"],
        "budget": 2000, "deadline_days": 7, "quantity": 100,
    })
    r.raise_for_status()
    data = r.json()
    assert data["network"], f"no network: {r.text}"
    state["network"] = data["network"]
    return (f"feasible={data['feasible']} total=${data['total_cost']} "
            f"suppliers={[s['name'] for s in data['network']]}")

step(3, "POST /assemble", t_assemble)

# 4. POST /repair — fail the first supplier in the network
def t_repair():
    failed = state["network"][0]
    r = client.post("/repair", json={
        "failed_supplier_id": failed["id"],
        "current_network": state["network"],
    })
    r.raise_for_status()
    data = r.json()
    assert data["replaced_supplier"].get("id"), r.text
    state["network"] = data["updated_network"]
    return (f"replaced '{failed['name']}' -> '{data['replaced_supplier']['name']}' "
            f"new_total=${data['new_total']}")

step(4, "POST /repair", t_repair)

# 5. POST /checkout — PayPal sandbox order over the repaired network
def t_checkout():
    r = client.post("/checkout", json={
        "network": state["network"],
        "customer_email": "customer@example.com",
    })
    r.raise_for_status()
    data = r.json()
    assert data.get("order_id"), r.text
    return f"order_id={data['order_id']} approval_url={data.get('approval_url')}"

step(5, "POST /checkout", t_checkout)

passed = sum(1 for _, ok, _ in results if ok)
print(f"\n{passed}/{len(results)} steps passed")
sys.exit(0 if passed == len(results) else 1)
