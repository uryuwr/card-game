"""Card data API router - query, search, and manage card data."""
from fastapi import APIRouter, Query, HTTPException
from sqlalchemy import select, or_
from typing import Optional

from app.database import async_session
from app.models import Card

router = APIRouter()


@router.get("")
async def list_cards(
    color: Optional[str] = None,
    card_type: Optional[str] = None,
    cost: Optional[int] = None,
    set_code: Optional[str] = None,
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List cards with optional filters and pagination."""
    async with async_session() as session:
        query = select(Card)

        if color:
            query = query.where(Card.color == color.upper())
        if card_type:
            # 支持中文和英文类型名
            query = query.where(Card.card_type == card_type)
        if cost is not None:
            query = query.where(Card.cost == cost)
        if set_code:
            query = query.where(Card.set_code == set_code.upper())
        if q:
            query = query.where(
                or_(
                    Card.name.ilike(f"%{q}%"),
                    Card.name_cn.ilike(f"%{q}%"),
                    Card.card_number.ilike(f"%{q}%"),
                    Card.trait.ilike(f"%{q}%"),
                )
            )

        query = query.order_by(Card.card_number)
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        result = await session.execute(query)
        cards = result.scalars().all()

        return {
            "cards": [_card_to_dict(c) for c in cards],
            "page": page,
            "page_size": page_size,
        }


@router.get("/search")
async def search_cards(q: str = Query(..., min_length=1)):
    """Full-text search for cards by name, trait, or card number."""
    async with async_session() as session:
        query = select(Card).where(
            or_(
                Card.name.ilike(f"%{q}%"),
                Card.name_cn.ilike(f"%{q}%"),
                Card.card_number.ilike(f"%{q}%"),
                Card.trait.ilike(f"%{q}%"),
                Card.effect.ilike(f"%{q}%"),
            )
        ).order_by(Card.card_number).limit(50)

        result = await session.execute(query)
        cards = result.scalars().all()
        return {"cards": [_card_to_dict(c) for c in cards]}


@router.get("/{card_number}")
async def get_card(card_number: str):
    """Get a single card by card number."""
    async with async_session() as session:
        result = await session.execute(
            select(Card).where(Card.card_number == card_number.upper())
        )
        card = result.scalars().first()
        if not card:
            raise HTTPException(status_code=404, detail="Card not found")
        return _card_to_dict(card)


@router.get("/set/{set_code}")
async def get_cards_by_set(set_code: str):
    """Get all cards from a specific set."""
    async with async_session() as session:
        result = await session.execute(
            select(Card)
            .where(Card.set_code == set_code.upper())
            .order_by(Card.card_number)
        )
        cards = result.scalars().all()
        return {"set_code": set_code.upper(), "cards": [_card_to_dict(c) for c in cards]}


@router.get("/leaders/all")
async def get_all_leaders():
    """Get all leader cards."""
    async with async_session() as session:
        result = await session.execute(
            select(Card)
            .where(Card.card_type == "LEADER")
            .order_by(Card.card_number)
        )
        cards = result.scalars().all()
        return {"leaders": [_card_to_dict(c) for c in cards]}


@router.get("/deck-cards/{set_code}")
async def get_deck_cards(set_code: str):
    """Get all non-leader cards from a set (for building a deck)."""
    async with async_session() as session:
        result = await session.execute(
            select(Card)
            .where(Card.set_code == set_code.upper())
            .where(Card.card_type != "LEADER")
            .order_by(Card.card_number)
        )
        cards = result.scalars().all()
        return {"cards": [_card_to_dict(c) for c in cards]}


def _card_to_dict(card: Card) -> dict:
    return {
        "id": card.id,
        "cardNumber": card.card_number,
        "name": card.name,
        "nameCn": card.name_cn,
        "cardType": card.card_type,
        "color": card.color,
        "cost": card.cost,
        "power": card.power,
        "counter": card.counter,
        "life": card.life,
        "attribute": card.attribute,
        "effect": card.effect,
        "trigger": card.trigger,
        "trait": card.trait,
        "rarity": card.rarity,
        "setCode": card.set_code,
        "imageUrl": card.image_url,
        "imageLocal": card.image_local,
    }
