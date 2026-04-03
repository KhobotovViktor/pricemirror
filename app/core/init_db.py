import psycopg2
import os

# Database connection configuration (should be as environment variables)
# DB_URL = os.getenv("DATABASE_URL")

CATEGORIES = [
    "Угловые диваны", "Прямые диваны", "Матрасы", "Шкафы распашные", 
    "Шкафы-купе", "Комоды", "Столы письменные и компьютерные", "Кровати", 
    "Кухонные гарнитуры", "Стулья кухонные", "Столы кухонные", 
    "Кухонные диваны", "Стенки", "Прихожие", "ТВ-тумбы", 
    "Кресла для отдыха", "Кресла компьютерные", "Кресла подвесные", 
    "Кресла-качалки", "Обувницы", "Стеллажи", "Прикроватные тумбы", 
    "Табуреты", "Столы журнальные", "Полки навесные", "Мойки", 
    "Туалетные столы", "Банкетки и пуфы"
]

STORES = [
    ("Много Мебели", "mnogomebeli.com"),
    ("Дом Диванов", "domdivanov35.ru"),
    ("Аксон", "akson.ru"),
    ("BestMebelShop", "bestmebelshop.ru"),
    ("NadomMebel", "nadommebel.com"),
    ("Pushe", "pushe.ru"),
    ("Ангстрем", "angstrem-mebel.ru"),
    ("Шатура", "shatura.com"),
    ("Мебель Соня", "mebel-sonya.ru"),
    ("Лазурит", "lazurit.com"),
    ("Нонтон", "nonton.ru"),
    ("Moon", "moon.ru"),
    ("Домовой35", "domovoy35.ru"),
    ("Divan.ru", "divan.ru"),
    ("Hoff", "hoff.ru"),
    ("Идеи Для Дома", "idd35.ru"),
    ("Диван Boss", "divanboss.ru")
]

def init_db(conn_str):
    with psycopg2.connect(conn_str) as conn:
        with conn.cursor() as cur:
            # Insert categories
            for cat in CATEGORIES:
                cur.execute(
                    "INSERT INTO product_category (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", 
                    (cat,)
                )
            
            # Insert stores
            for name, domain in STORES:
                cur.execute(
                    "INSERT INTO competitor_store (name, domain) VALUES (%s, %s) ON CONFLICT (domain) DO NOTHING", 
                    (name, domain)
                )
        conn.commit()
    print("Database initialized successfully.")

if __name__ == "__main__":
    # This is a template, real connection string will be provided by user or environment
    print("Replace this with execution logic once DB is ready.")
