import sqlite3
import json

conn = sqlite3.connect('/Users/pipi/Dveloper/workspace/card-game/api-server/card_game.db')

print('=== 已有卡组 ===')
cursor = conn.execute('SELECT id, name, leader_card_number FROM decks')
decks = cursor.fetchall()
for d in decks:
    print(f'ID:{d[0]} 名称:{d[1]} 领袖:{d[2]}')

print()
for deck_id, deck_name, leader_num in decks:
    print(f'\n===== 卡组 {deck_id}: {deck_name} =====')
    
    cursor = conn.execute('SELECT cards FROM decks WHERE id=?', (deck_id,))
    cards_json = cursor.fetchone()[0]
    card_list = json.loads(cards_json)
    
    # card_list 是 [{card_number, count}, ...] 格式
    card_counts = {}
    for entry in card_list:
        card_counts[entry['card_number']] = entry['count']
    
    for card_num, count in card_counts.items():
        cursor = conn.execute('SELECT name_cn, card_type, effect, "trigger" FROM cards WHERE card_number=?', (card_num,))
        row = cursor.fetchone()
        if row:
            name, ctype, effect, trigger = row
            print(f'\n[{card_num}] {name} x{count} ({ctype})')
            if effect:
                eff = effect[:180] + '...' if len(effect or '') > 180 else effect
                print(f'  效果: {eff}')
            if trigger:
                print(f'  触发: {trigger}')

conn.close()
