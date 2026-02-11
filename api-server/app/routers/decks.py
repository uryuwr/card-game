from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select
from typing import Optional
import uuid

from app.database import async_session
from app.models import Deck, Card

router = APIRouter()


class DeckCard(BaseModel):
    card_number: str
    count: int


class DeckCreate(BaseModel):
    name: str
    leader_card_number: str
    cards: list[DeckCard] = []


@router.get("")
async def list_decks(
    user_id: str = Query(default="system", description="用户ID"),
):
    """获取指定用户的卡组列表"""
    async with async_session() as session:
        query = select(Deck).where(Deck.user_id == user_id)
        result = await session.execute(query)
        decks = result.scalars().all()
        
        output = []
        for deck in decks:
            total_cards = sum(c.get('count', 1) for c in (deck.cards or []))
            output.append({
                "id": deck.id,
                "user_id": deck.user_id,
                "name": deck.name,
                "leader_card_number": deck.leader_card_number,
                "cards": deck.cards or [],
                "total_cards": total_cards,
            })
        return output


@router.get("/{deck_id}")
async def get_deck(deck_id: str):
    """获取单个卡组详情，包含卡牌完整信息"""
    async with async_session() as session:
        # 获取卡组
        query = select(Deck).where(Deck.id == deck_id)
        result = await session.execute(query)
        deck = result.scalar_one_or_none()
        
        if not deck:
            return {"error": "卡组不存在"}
        
        # 获取卡牌详细信息
        cards_detail = []
        for card_entry in (deck.cards or []):
            card_number = card_entry.get('card_number')
            count = card_entry.get('count', 1)
            
            card_query = select(Card).where(Card.card_number == card_number)
            card_result = await session.execute(card_query)
            card = card_result.scalar_one_or_none()
            
            if card:
                cards_detail.append({
                    "card_number": card.card_number,
                    "name": card.name,
                    "name_cn": card.name_cn,
                    "card_type": card.card_type,
                    "color": card.color,
                    "cost": card.cost,
                    "power": card.power,
                    "counter": card.counter,
                    "effect": card.effect,
                    "trigger": card.trigger,
                    "image_url": card.image_url,
                    "count": count,
                })
        
        # 获取领袖卡详情
        leader = None
        if deck.leader_card_number:
            leader_query = select(Card).where(Card.card_number == deck.leader_card_number)
            leader_result = await session.execute(leader_query)
            leader_card = leader_result.scalar_one_or_none()
            
            if leader_card:
                leader = {
                    "card_number": leader_card.card_number,
                    "name": leader_card.name,
                    "name_cn": leader_card.name_cn,
                    "color": leader_card.color,
                    "power": leader_card.power,
                    "life": leader_card.life,
                    "effect": leader_card.effect,
                    "trigger": leader_card.trigger,
                    "image_url": leader_card.image_url,
                }
        
        return {
            "id": deck.id,
            "user_id": deck.user_id,
            "name": deck.name,
            "leader": leader,
            "cards": cards_detail,
            "total_cards": sum(c.get('count', 1) for c in (deck.cards or [])),
        }


@router.post("")
async def create_deck(deck: DeckCreate, user_id: str = Query(default="system")):
    """创建新卡组"""
    async with async_session() as session:
        new_deck = Deck(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=deck.name,
            leader_card_number=deck.leader_card_number,
            cards=[{"card_number": c.card_number, "count": c.count} for c in deck.cards],
        )
        session.add(new_deck)
        await session.commit()
        return {"id": new_deck.id, "name": new_deck.name}


@router.delete("/{deck_id}")
async def delete_deck(deck_id: str):
    """删除卡组"""
    async with async_session() as session:
        query = select(Deck).where(Deck.id == deck_id)
        result = await session.execute(query)
        deck = result.scalar_one_or_none()
        
        if deck:
            await session.delete(deck)
            await session.commit()
            return {"message": "已删除"}
        return {"error": "卡组不存在"}
    return {"error": "卡组不存在"}

