"""Seed the suppliers table with 3 fake suppliers per category (15 total)."""
import os

from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

SUPPLIERS = [
    # design
    {"name": "PixelForge Studio", "category": "design", "price_per_unit": 2.50, "capacity": 5000, "available": True, "delivery_days": 3, "description": "Branding, logo, and print-ready artwork."},
    {"name": "BrightLoom Creative", "category": "design", "price_per_unit": 3.10, "capacity": 3000, "available": True, "delivery_days": 2, "description": "Fast-turnaround graphic design for merch."},
    {"name": "NorthInk Design Co", "category": "design", "price_per_unit": 1.90, "capacity": 2000, "available": True, "delivery_days": 4, "description": "Minimalist kit and packaging design."},
    # printing
    {"name": "VividPress Printworks", "category": "printing", "price_per_unit": 0.80, "capacity": 10000, "available": True, "delivery_days": 3, "description": "Full-color offset and digital printing."},
    {"name": "IronSheet Press", "category": "printing", "price_per_unit": 1.20, "capacity": 6000, "available": True, "delivery_days": 2, "description": "High-volume screen and laser printing."},
    {"name": "SoftHue Print Lab", "category": "printing", "price_per_unit": 0.65, "capacity": 4000, "available": True, "delivery_days": 5, "description": "Eco-ink boutique printing."},
    # manufacturing
    {"name": "AtlasWorks Mfg", "category": "manufacturing", "price_per_unit": 4.50, "capacity": 8000, "available": True, "delivery_days": 6, "description": "Custom promo goods and hardware."},
    {"name": "CrateLab Fabrication", "category": "manufacturing", "price_per_unit": 5.25, "capacity": 3000, "available": True, "delivery_days": 4, "description": "Small-batch product assembly."},
    {"name": "ForgeLine Industries", "category": "manufacturing", "price_per_unit": 3.80, "capacity": 12000, "available": True, "delivery_days": 7, "description": "Bulk manufacturing of branded goods."},
    # packaging
    {"name": "WrapCraft Packaging", "category": "packaging", "price_per_unit": 0.55, "capacity": 20000, "available": True, "delivery_days": 2, "description": "Custom boxes, sleeves, and inserts."},
    {"name": "BoxNest Supply", "category": "packaging", "price_per_unit": 0.70, "capacity": 15000, "available": True, "delivery_days": 3, "description": "Recycled kraft packaging."},
    {"name": "SealPoint Pack Co", "category": "packaging", "price_per_unit": 0.45, "capacity": 25000, "available": True, "delivery_days": 4, "description": "Vacuum and shrink packaging at scale."},
    # delivery
    {"name": "SwiftRoute Logistics", "category": "delivery", "price_per_unit": 1.00, "capacity": 30000, "available": True, "delivery_days": 1, "description": "Same-city courier and freight."},
    {"name": "CargoPine Shipping", "category": "delivery", "price_per_unit": 0.85, "capacity": 50000, "available": True, "delivery_days": 2, "description": "Nationwide ground shipping."},
    {"name": "ZephyrExpress", "category": "delivery", "price_per_unit": 1.40, "capacity": 20000, "available": True, "delivery_days": 1, "description": "Air freight and express delivery."},
]


def seed():
    existing = supabase.table("suppliers").select("id", count="exact").execute()
    if existing.count:
        print(f"Suppliers table already has {existing.count} rows — deleting and reseeding.")
        supabase.table("suppliers").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    result = supabase.table("suppliers").insert(SUPPLIERS).execute()
    print(f"Seeded {len(result.data)} suppliers.")


if __name__ == "__main__":
    seed()
