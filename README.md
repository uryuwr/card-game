# ONE PIECE CARD GAME 海贼王卡牌游戏

海贼王集换式卡牌对战模拟器，支持实时双人对战、卡组构建、卡牌数据管理。

## 📦 技术栈

| 模块 | 技术 | 说明 |
|------|------|------|
| **API Server** | Python + FastAPI | 卡牌数据、用户认证、卡组管理 |
| **Game Server** | Node.js + Socket.IO | 实时对战引擎、房间管理 |
| **Client** | React + TypeScript + Vite | 游戏界面、卡组构建器 |
| **Database** | SQLite | 卡牌数据、用户数据存储 |

## 🏗️ 项目架构

```
card-game/
├── api-server/          # Python FastAPI 后端
│   ├── app/
│   │   ├── main.py      # FastAPI 入口
│   │   ├── models.py    # SQLAlchemy 数据模型
│   │   ├── database.py  # 数据库连接
│   │   └── routers/     # API 路由
│   │       ├── cards.py     # 卡牌 CRUD
│   │       ├── decks.py     # 卡组管理
│   │       ├── auth.py      # 用户认证
│   │       └── ocr.py       # 卡牌识别
│   ├── scraper.py       # 卡牌爬虫
│   └── requirements.txt
│
├── game-server/         # Node.js 游戏服务器
│   └── src/
│       ├── index.js     # Socket.IO 服务入口
│       ├── engine.js    # 游戏引擎（核心逻辑）
│       ├── rooms.js     # 房间管理
│       └── cards.js     # 卡牌加载器
│
├── client/              # React 前端
│   └── src/
│       ├── pages/
│       │   ├── Home.tsx       # 主页
│       │   ├── Lobby.tsx      # 大厅（房间/匹配）
│       │   ├── Game.tsx       # 游戏界面
│       │   └── DeckBuilder.tsx # 卡组构建器
│       ├── components/
│       │   ├── Card.tsx       # 卡牌组件
│       │   └── PlayerInfo.tsx # 玩家信息
│       ├── contexts/
│       │   └── GameContext.tsx # 游戏状态管理
│       └── services/
│           ├── api.ts         # API 客户端
│           └── socket.ts      # Socket.IO 客户端
│
├── shared/              # 共享常量
│   └── constants.js     # Socket 事件、游戏阶段等
│
└── asserts/             # 静态资源
    └── cards/           # 卡牌图片
```

## 🎮 游戏引擎 (game-server/src/engine.js)

### 游戏流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  REFRESH    │ ──▶ │    DRAW     │ ──▶ │    DON      │ ──▶ │    MAIN     │
│  竖置所有卡  │     │  抽1张牌    │     │  抽2张DON   │     │  出牌/贴DON │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                   │
                    ┌─────────────┐     ┌─────────────┐            │
                    │    END      │ ◀── │   BATTLE    │ ◀──────────┘
                    │  回合结束    │     │  宣言攻击    │
                    └─────────────┘     └─────────────┘
```

### 战斗阶段详解

```
攻击方宣言攻击 ──▶ 防御方选择挡格者 ──▶ 防御方打反击卡 ──▶ 结算伤害
     │                  │                    │              │
  attackerId        blockerStep         counterStep    resolveBattle
  targetId          (可跳过)            (可跳过)        (比较力量)
```

### 核心方法

| 方法 | 说明 |
|------|------|
| `playCharacter(socketId, cardId)` | 出角色卡到场上 |
| `playEvent(socketId, cardId)` | 使用事件卡 |
| `playStage(socketId, cardId)` | 放置舞台卡 |
| `attachDon(socketId, targetId, count)` | 贴 DON 到领袖/角色 |
| `detachDon(socketId, sourceId, count)` | 移除贴附的 DON |
| `declareAttack(socketId, attackerId, targetId)` | 宣言攻击 |
| `declareBlocker(socketId, blockerId)` | 宣言挡格 |
| `playCounter(socketId, cardId)` | 打反击卡 |
| `resolveBattle(socketId)` | 结算战斗 |
| `endTurn(socketId)` | 结束回合 |

### 状态管理

```javascript
// 玩家状态结构
{
  id: string,
  leader: { card, state, attachedDon, power },
  characters: [{ card, state, attachedDon, power, canAttackThisTurn }],
  hand: Card[],
  deck: Card[],
  trash: Card[],
  life: Card[],
  stage: { card } | null,
  donDeck: number,
  donActive: number,
  donRested: number,
}
```

## 🔌 Socket.IO 事件

### 房间事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `room:create` | C→S | 创建房间 |
| `room:join` | C→S | 加入房间 |
| `room:ready` | C→S | 准备/取消准备 |
| `room:updated` | S→C | 房间状态更新 |
| `matchmaking:join` | C→S | 加入匹配队列 |
| `matchmaking:matched` | S→C | 匹配成功 |

### 游戏事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `game:start` | S→C | 游戏开始，发送初始状态 |
| `game:state` | S→C | 游戏状态更新 |
| `game:play-character` | C→S | 出角色卡 |
| `game:play-event` | C→S | 使用事件卡 |
| `game:attach-don` | C→S | 贴 DON |
| `game:detach-don` | C→S | 移除 DON |
| `game:declare-attack` | C→S | 宣言攻击 |
| `game:declare-blocker` | C→S | 宣言挡格 |
| `game:play-counter` | C→S | 打反击卡 |
| `game:resolve-battle` | C→S | 结算战斗 |
| `game:end-turn` | C→S | 结束回合 |
| `game:end` | S→C | 游戏结束 |

## 🚀 快速启动

### 开发模式

```bash
./start-dev.sh
```

启动后访问：
- 前端: http://localhost:5173
- API: http://localhost:8000
- Game Server: ws://localhost:3001

### 生产模式

```bash
./start-prod.sh
```

### 手动启动

```bash
# 1. API Server
cd api-server
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. Game Server
cd game-server
npm install
node src/index.js

# 3. Client
cd client
npm install
npm run dev
```

## 📡 API 接口

### 卡牌

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/cards/` | 获取卡牌列表（支持分页、筛选） |
| GET | `/api/cards/{id}` | 获取单张卡牌详情 |
| GET | `/api/cards/number/{card_number}` | 按编号获取卡牌 |

### 卡组

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/decks/` | 获取卡组列表 |
| POST | `/api/decks/` | 创建卡组 |
| GET | `/api/decks/{id}` | 获取卡组详情 |
| PUT | `/api/decks/{id}` | 更新卡组 |
| DELETE | `/api/decks/{id}` | 删除卡组 |

## 🕷️ 卡牌爬虫

从 [One Piece 官方卡表](https://www.onepiece-cardgame.cn/cardlist) 爬取卡牌数据。

```bash
cd api-server

# 爬取单张/多张
python scraper.py EB04-001 EB04-005

# 爬取整个卡包
python scraper.py --set EB04

# 爬取全部卡牌（约4000+张，需20-30分钟）
python scraper.py --all

# 查看可用卡包
python scraper.py --list-sets
```

## 🎯 前端组件

### Game.tsx 主要状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `hoveredCard` | Card \| null | 当前悬停预览的卡牌 |
| `pinnedPreviewId` | string \| null | 固定预览的卡牌ID |
| `selectedCard` | string \| null | 选中的攻击者 |
| `targeting` | boolean | 是否在选择攻击目标 |
| `donSelectMode` | boolean | DON选择模式 |
| `selectedDonCount` | number | 已选中的DON数量 |

### Card.tsx Props

| Prop | 类型 | 说明 |
|------|------|------|
| `card` | Card | 卡牌数据 |
| `slot` | CardSlot | 卡槽信息（状态、贴附DON等） |
| `showPower` | boolean | 是否显示力量 |
| `selectable` | boolean | 是否可选中 |
| `targetable` | boolean | 是否可作为目标 |
| `onDonClick` | () => void | DON点击回调（移除DON） |

## 📋 数据模型

### Card (卡牌)

```typescript
interface Card {
  id: number
  cardNumber: string      // 编号 "OP01-001"
  name: string            // 英文名
  nameCn: string          // 中文名
  cardType: string        // LEADER/CHARACTER/EVENT/STAGE
  color: string           // RED/BLUE/GREEN/PURPLE/BLACK/YELLOW
  cost: number            // 费用
  power: number           // 力量
  counter: number         // 反击值
  life: number            // 生命（领袖）
  effect: string          // 效果文本
  trigger: string         // 触发效果
  attribute: string       // 特征
  rarity: string          // 稀有度
  imageUrl: string        // 图片URL
}
```

### CardSlot (场上卡槽)

```typescript
interface CardSlot {
  card: Card
  state: 'ACTIVE' | 'RESTED'  // 竖置/横置
  attachedDon: number          // 贴附的DON数量
  power: number                // 当前力量（基础+DON加成）
  canAttackThisTurn: boolean   // 本回合能否攻击
}
```

## 🔧 开发指南

### 添加新的游戏动作

1. **定义事件常量** (`shared/constants.js`)
```javascript
SOCKET_EVENTS: {
  MY_NEW_ACTION: 'game:my-new-action',
}
```

2. **实现引擎逻辑** (`game-server/src/engine.js`)
```javascript
myNewAction(socketId, params) {
  // 验证、执行、返回结果
}
```

3. **添加Socket处理** (`game-server/src/index.js`)
```javascript
socket.on(SOCKET_EVENTS.MY_NEW_ACTION, (params) => {
  const result = room.engine.myNewAction(socket.id, params)
  if (result.success) broadcastGameState(room)
})
```

4. **客户端调用** (`client/src/services/socket.ts`)
```typescript
myNewAction(params) {
  this.socket?.emit('game:my-new-action', params)
}
```

### 调试技巧

```bash
# 运行游戏引擎测试
cd game-server
node test-game.mjs

# 查看数据库内容
cd api-server
sqlite3 card_game.db ".tables"
sqlite3 card_game.db "SELECT * FROM cards LIMIT 5"
```

## 📝 TODO

- [ ] 实现更多卡牌效果
- [ ] AI 对战模式
- [ ] 战斗日志/回放
- [ ] 多语言支持
- [ ] 移动端适配优化

## 📄 License

MIT
