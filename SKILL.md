---
name: fetch-decklist
description: 从 Limitless TCG 网站检索指定 Leader 的比赛卡组构筑，提取卡牌编号列表，然后用爬虫批量爬取所有卡牌数据和图片到本地数据库。当用户要求获取某个卡组的卡表时使用此 skill。
---

## 流程概述

1. 在 Limitless TCG 搜索目标卡组
2. 获取比赛获奖的具体 decklist
3. 提取所有卡牌编号
4. 用爬虫批量爬取到本地

## Step 1: 搜索卡组

在浏览器访问 Limitless TCG，搜索目标 Leader：

```
https://onepiece.limitlesstcg.com/decks?q={leader名称}
```

例如搜索 zoro：`https://onepiece.limitlesstcg.com/decks?q=zoro`

页面会返回匹配的卡组分类（如 Red Zoro、Green Zoro 等），点击进入对应卡组页面。

## Step 2: 获取 Decklist

在卡组概览页（如 `https://onepiece.limitlesstcg.com/decks/1`）中：
- 查看 **Latest results** 区域，找到最近比赛的获奖卡组
- 点击卡组链接图标进入具体 decklist 页面（如 `https://onepiece.limitlesstcg.com/decks/list/5993`）

Decklist 页面会列出所有卡牌，格式为：
```
数量 卡牌名称 (卡牌编号)
```

## Step 3: 提取卡牌编号

从 decklist 中提取所有不重复的卡牌编号。例如 Red Zoro 卡组：

```
OP01-001 OP01-016 OP02-015 OP08-015 ST21-003 OP01-013
OP04-010 EB01-006 OP08-007 OP08-010 EB02-003 OP01-025
OP08-013 OP01-015 EB01-003 ST01-012 EB01-009 ST01-016
```

## Step 4: 执行爬虫

在终端执行爬虫命令，将所有卡牌编号作为参数传入：

```bash
cd /Users/pipi/Dveloper/workspace/card-game/api-server

/Users/pipi/Dveloper/workspace/card-game/api-server/venv/bin/python scraper.py \
  OP01-001 OP01-016 OP02-015 OP08-015 ST21-003 OP01-013 \
  OP04-010 EB01-006 OP08-007 OP08-010 EB02-003 OP01-025 \
  OP08-013 OP01-015 EB01-003 ST01-012 EB01-009 ST01-016
```

爬虫会自动：
- 按卡包分组搜索，匹配官网 API 的卡包名称
- 获取每张卡牌的详细信息（名称、类型、颜色、费用、力量、效果等）
- 下载卡牌图片到 `asserts/cards/`
- 写入 SQLite 数据库 `api-server/card_game.db`（已有则更新）

## Step 5: 验证结果

```bash
# 查看下载的图片
ls asserts/cards/

# 查看数据库记录
/Users/pipi/Dveloper/workspace/card-game/api-server/venv/bin/python -c "
import sqlite3
conn = sqlite3.connect('card_game.db')
cursor = conn.execute('SELECT card_number, name_cn, card_type, color, rarity FROM cards ORDER BY card_number')
for r in cursor.fetchall():
    print(f'{r[0]:>10}  {r[1]:<16} {r[2]:<4} {r[3]:<4} {r[4]}')
conn.close()
"
```

## 其他爬虫命令

```bash
# 爬取整个卡包
python scraper.py --set EB04

# 爬取所有卡牌（约4000+张，耗时较长）
python scraper.py --all

# 查看所有可用卡包代码
python scraper.py --list-sets
```

## 关键 URL

| 用途 | URL |
|------|-----|
| Limitless 卡组搜索 | `https://onepiece.limitlesstcg.com/decks?q={关键词}` |
| Limitless 卡组详情 | `https://onepiece.limitlesstcg.com/decks/{id}` |
| Limitless Decklist | `https://onepiece.limitlesstcg.com/decks/list/{id}` |
| 官方卡表 | `https://www.onepiece-cardgame.cn/cardlist` |
| 官网 API 列表 | `https://onepieceserve.windoent.com/cardList/cardlist/weblist?cardOfferType=&limit=20&page=1` |
| 官网 API 详情 | `https://onepieceserve.windoent.com/cardList/cardlist/webInfo/{id}` |
