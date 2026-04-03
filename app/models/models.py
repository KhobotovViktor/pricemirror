from sqlalchemy import Column, Integer, String, ForeignKey, Text, Numeric, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
import datetime

Base = declarative_base()

class ProductCategory(Base):
    __tablename__ = "product_category"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    products = relationship("OurProduct", back_populates="category")

class CompetitorStore(Base):
    __tablename__ = "competitor_store"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    domain = Column(String, unique=True, nullable=False)

class OurProduct(Base):
    __tablename__ = "our_product"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category_id = Column(Integer, ForeignKey("product_category.id"))
    url = Column(Text)
    current_price = Column(Numeric(12, 2))
    
    category = relationship("ProductCategory", back_populates="products")
    competitor_mappings = relationship("CompetitorProduct", back_populates="our_product")

class CompetitorProduct(Base):
    __tablename__ = "competitor_product"
    id = Column(Integer, primary_key=True, index=True)
    our_product_id = Column(Integer, ForeignKey("our_product.id"))
    store_id = Column(Integer, ForeignKey("competitor_store.id"))
    url = Column(Text, nullable=False)
    
    our_product = relationship("OurProduct", back_populates="competitor_mappings")
    price_records = relationship("PriceRecord", back_populates="competitor_product")

class PriceRecord(Base):
    __tablename__ = "price_record"
    id = Column(Integer, primary_key=True, index=True)
    competitor_product_id = Column(Integer, ForeignKey("competitor_product.id"))
    price = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    competitor_product = relationship("CompetitorProduct", back_populates="price_records")
