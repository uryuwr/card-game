# One Piece TCG 卡牌游戏

海贼王集换式卡牌对战游戏，包含 API 服务、游戏服务器和 Web 客户端。

## 项目结构

```
card-game/
├── api-server/      # Python FastAPI 后端（数据库、认证、卡牌 API、爬虫）
├── game-server/     # Node.js 游戏对战服务器（Socket.IO）
├── client/          # Vue/React 前端客户端
├── shared/          # 前后端共享常量
└── asserts/         # 静态资源（卡牌图片等）
    └── cards/       # 爬取的卡牌图片
```

## 快速启动

```bash
./start-dev.sh
```

## 一键部署启动（生产模式，无热更新）

```bash
./start-prod.sh
```

---

## 卡牌爬虫

从 [One Piece 官方卡表](https://www.onepiece-cardgame.cn/cardlist) 爬取卡牌数据，包括卡牌信息和图片。

### 前置准备

```bash
cd api-server
pip install -r requirements.txt
```

### 爬取指定卡牌

通过卡牌编号爬取一张或多张卡牌：

```bash
python scraper.py EB04-001
python scraper.py EB04-001 EB04-005 EB04-010
python scraper.py ST01-001 OP01-025
```

### 爬取整个卡包

使用 `--set` 参数加卡包代码，爬取该卡包的全部卡牌：

```bash
python scraper.py --set EB04       # 特别补充包 艾格赫德危机
python scraper.py --set OPC-01     # 补充包 冒险的黎明
python scraper.py --set STC-01     # 基本卡组 草帽一伙
```

### 爬取所有卡牌

```bash
python scraper.py --all
```

> ⚠️ 全量爬取约 4000+ 张卡牌，预计需要 20-30 分钟。

### 查看可用卡包列表

```bash
python scraper.py --list-sets
```

### 爬虫说明

| 项目 | 说明 |
|------|------|
| 数据来源 | `https://www.onepiece-cardgame.cn/cardlist` |
| 图片存储 | `asserts/cards/` |
| 数据库 | SQLite `api-server/card_game.db` |
| 爬取字段 | 编号、名称、类型、颜色、费用、力量、效果、特征、稀有度等 |
| 重复处理 | 已存在的卡牌会更新，不会重复创建 |
