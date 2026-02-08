from sqlalchemy import Column, String, Integer, Text, JSON, DateTime, func
from app.database import Base
import uuid


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(50), unique=True, nullable=False, index=True)
    hashed_password = Column(String(128), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class Deck(Base):
    __tablename__ = "decks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    leader_card_number = Column(String(20), nullable=True)
    cards = Column(JSON, default=list)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Card(Base):
    __tablename__ = "cards"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    card_number = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    name_cn = Column(String(200), nullable=True, index=True)
    card_type = Column(String(20), nullable=False, index=True)
    color = Column(String(50), nullable=False, index=True)
    cost = Column(Integer, nullable=True)
    power = Column(Integer, nullable=True)
    counter = Column(Integer, nullable=True)
    life = Column(Integer, nullable=True)
    attribute = Column(String(20), nullable=True)
    effect = Column(Text, nullable=True)
    trigger = Column(Text, nullable=True)
    trait = Column(String(200), nullable=True)
    rarity = Column(String(10), nullable=True)
    set_code = Column(String(20), nullable=True, index=True)
    image_url = Column(String(500), nullable=True)
    image_local = Column(String(300), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
