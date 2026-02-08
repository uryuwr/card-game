#!/usr/bin/env python3
"""写入预设卡组到数据库"""
import sqlite3
import json
import uuid

conn = sqlite3.connect('card_game.db')

# 清空现有卡组
conn.execute("DELETE FROM decks WHERE user_id = 'system'")

# 白胡子卡组 (Edward.Newgate) - Limitless TCG Jimmy Hu
whitebeard_cards = [
    {"card_number": "OP02-003", "count": 4},
    {"card_number": "OP02-004", "count": 4},
    {"card_number": "OP02-007", "count": 4},
    {"card_number": "OP02-008", "count": 4},
    {"card_number": "OP02-013", "count": 4},
    {"card_number": "OP02-015", "count": 2},
    {"card_number": "OP03-003", "count": 4},
    {"card_number": "OP03-006", "count": 4},
    {"card_number": "OP03-013", "count": 4},
    {"card_number": "OP03-015", "count": 2},
    {"card_number": "ST01-006", "count": 4},
    {"card_number": "ST01-011", "count": 2},
    {"card_number": "ST01-014", "count": 4},
    {"card_number": "OP01-026", "count": 4},
    {"card_number": "OP04-016", "count": 4},
    {"card_number": "P-006", "count": 2},
]

# 红索隆卡组 (Roronoa Zoro)
zoro_cards = [
    {"card_number": "ST01-006", "count": 4},
    {"card_number": "ST01-011", "count": 4},
    {"card_number": "ST01-012", "count": 4},
    {"card_number": "ST01-014", "count": 4},
    {"card_number": "ST01-016", "count": 4},
    {"card_number": "OP01-013", "count": 4},
    {"card_number": "OP01-015", "count": 4},
    {"card_number": "OP01-016", "count": 4},
    {"card_number": "OP01-025", "count": 4},
    {"card_number": "OP01-026", "count": 4},
    {"card_number": "OP01-029", "count": 4},
    {"card_number": "EB01-003", "count": 2},
    {"card_number": "EB01-006", "count": 2},
    {"card_number": "EB01-009", "count": 2},
]

decks = [
    ("白胡子 (Edward.Newgate)", "OP02-001", whitebeard_cards),
    ("红索隆 (Roronoa Zoro)", "OP01-001", zoro_cards),
]

for name, leader, cards in decks:
    conn.execute(
        "INSERT INTO decks (id, user_id, name, leader_card_number, cards) VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), "system", name, leader, json.dumps(cards))
    )

conn.commit()
print("卡组已写入数据库!")
print()

# 验证
cursor = conn.execute("SELECT name, leader_card_number, cards FROM decks")
for name, leader, cards in cursor.fetchall():
    card_list = json.loads(cards)
    total = sum(c["count"] for c in card_list)
    print(f"{name}")
    print(f"  领袖: {leader}")
    print(f"  卡牌: {total} 张 ({len(card_list)} 种)")

conn.close()
