import sys
import os

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import SessionLocal
from app.models import models

def test_db():
    db = SessionLocal()
    try:
        print("Testing DB connection...")
        categories = db.query(models.ProductCategory).limit(5).all()
        print(f"Connection OK! Found {len(categories)} categories.")
        for cat in categories:
            print(f"- {cat.name}")
            
        products = db.query(models.OurProduct).all()
        print(f"Products count: {len(products)}")
    except Exception as e:
        print(f"DB Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    test_db()
