-- schema.sql

-- 1. ProductCategory
CREATE TABLE product_category (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
);

-- 2. CompetitorStore
CREATE TABLE competitor_store (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL
);

-- 3. OurProduct
CREATE TABLE our_product (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category_id INTEGER REFERENCES product_category(id),
    url TEXT,
    current_price DECIMAL(12, 2)
);

-- 4. CompetitorProduct
CREATE TABLE competitor_product (
    id SERIAL PRIMARY KEY,
    our_product_id INTEGER REFERENCES our_product(id),
    store_id INTEGER REFERENCES competitor_store(id),
    url TEXT NOT NULL,
    UNIQUE(our_product_id, store_id)
);

-- 5. PriceRecord
CREATE TABLE price_record (
    id SERIAL PRIMARY KEY,
    competitor_product_id INTEGER REFERENCES competitor_product(id),
    price DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Users (multi-user access with roles)
CREATE TABLE app_user (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'manager',  -- 'admin' or 'manager'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
