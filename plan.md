# One Piece TCG Implementation Plan

此文档规划了将现有卡牌游戏项目完全重构为 One Piece Card Game (海贼王卡牌对战) 的完整实施路径。

**核心目标：**
1. **游戏引擎**：完全重写为 OP TCG 规则（DON!! 资源、Leader/Character/Event 体系、Life 区域、Power 战斗机制）。
2. **数据层**：新增爬虫与 OCR 能力，从中文官网获取卡牌数据并入库。
3. **前端 UI**：重构为移动端优先（iOS 竖屏）布局，还原设计稿视觉风格与 TCG 交互逻辑。

---

## 📅 Phase 1: 数据层 — 爬虫、OCR 与数据库

### 1.1 数据库架构升级
- **File**: `api-server/app/models.py`
- **Task**: 新增 `Card` 模型
  - `id`: UUID (Primary Key)
  - `card_number`: String (Unique, e.g., "OP01-001")
  - `name`: String
  - `name_cn`: String (Index)
  - `card_type`: String (LEADER, CHARACTER, EVENT, STAGE, DON)
  - `color`: String (RED, GREEN, BLUE, PURPLE, BLACK, YELLOW)
  - `cost`: Integer
  - `power`: Integer
  - `counter`: Integer
  - `life`: Integer (Leader only)
  - `attribute`: String (Slash/Strike/Special/Ranged/Wisdom)
  - `effect`: Text
  - `trigger`: Text
  - `trait`: String (Features/Tags)
  - `rarity`: String (C/UC/R/SR/SEC/L/SP)
  - `set_code`: String (e.g., "OP01")
  - `image_url`: String
  - `image_local`: String
- **Task**: 启用数据库
  - 修改 `api-server/app/main.py` 添加 startup 事件调用 `init_db()`
  - 将 `auth.py` (User) 和 `decks.py` (Deck) 的内存存储逻辑改为 SQLAlchemy 数据库操作

### 1.2 爬虫模块 (Playwright)
- **Directory**: `api-server/app/scraper/`
- **Component**: `card_scraper.py`
  - 使用 `playwright.async_api` (Chromium headless)
  - 目标站点：`https://www.onepiece-cardgame.cn/cardlist`
  - 策略：XHR 拦截优先，DOM 解析保底
  - 流程：遍历系列 -> 抓取列表 -> 提取详情 -> 下载高清图 -> 保存到 `asserts/cards/{set_code}/`

### 1.3 OCR 解析增强
- **Component**: `card_parser.py`
  - 基于现有 EasyOCR 集成优化
  - 图像预处理：PIL 区域裁切（左下卡号、左上费用、底部力量、中部效果）
  - 颜色识别：RGB 像素采样分析卡片边框主色调
  - 校验逻辑：比对爬虫文本数据与 OCR 结果，修正潜在错误

### 1.4 卡牌数据 API
- **File**: `api-server/app/routers/cards.py`
- **Endpoints**:
  - `GET /api/cards`: 分页筛选查询
  - `GET /api/cards/{card_number}`: 单卡详情
  - `GET /api/cards/search`: 模糊搜索
  - `POST /api/cards/scrape`: 触发爬虫任务
  - `POST /api/cards/ocr-analyze`: 上传图片解析入库

---

## 🎮 Phase 2: 游戏服务器重写 — 规则引擎

### 2.1 常量定义
- **File**: `shared/constants.js`
- **Update**:
  - `DECK_SIZE`: 50
  - `DON_DECK_SIZE`: 10
  - `LIFE_COUNT`: 4/5 (Depends on Leader)
  - `MAX_CHARACTERS`: 5
  - `PHASES`: REFRESH, DRAW, DON, MAIN, BATTLE, END
  - `CARD_TYPES`: LEADER, CHARACTER, EVENT, STAGE, DON
  - `CARD_STATES`: ACTIVE, RESTED

### 2.2 核心引擎重构
- **File**: `game-server/src/engine.js` (完全重写)
- **Class**: `GameEngine`
- **State Structure**:
  - `players[2]`:
    - `leader`: { card, attachedDon, state, damage }
    - `characters`: Array<{ card, attachedDon, state, id }>
    - `stage`: { card } | null
    - `life`: Array<Card> (Face down)
    - `hand`: Array<Card>
    - `deck`: Array<Card>
    - `trash`: Array<Card>
    - `donDeck`: number
    - `donActive`: number
    - `donRested`: number
    - `donAttached`: Map<targetId, count>
- **Turn Phases**:
  1. **Refresh**: Rested cards -> Active; Attached DON!! -> Active area
  2. **Draw**: Draw 1 card (P1 T1 skip)
  3. **DON!!**: +2 DON!! cards to Active (P1 T1 +1)
  4. **Main**:
     - Play Character (Cost = Rest Active DON!!)
     - Play Event/Stage
     - Attach DON!! (Active -> Character/Leader, +1000 Power)
     - Activate Main Effect
  5. **Battle**:
     - Declare Attack (Rest Active Character/Leader) -> Target (Leader/Rested Character)
     - Block Step (Opponent uses Blocker)
     - Counter Step (Opponent plays Counter cards from hand)
     - Data Step (Compare Power -> KO or Damage Life)
  6. **End**: End of turn effects

### 2.3 卡牌效果处理方案：半自动棋盘 (Semi-Automatic Board)

> **核心原则**：4000+ 张卡牌各自拥有不同效果文本，不可能逐一硬编码。引擎仅自动化棋盘机制与通用关键词，复杂效果由玩家阅读卡面文字后通过"工具动作"手动执行。这是 Untap.in 等主流 TCG 模拟器的通用做法。

#### 引擎自动处理 (Auto)
以下机制由引擎强制执行，无需玩家介入：
- **棋盘流转**: DON!! 增长/分配、回合阶段自动推进、横置/恢复状态切换
- **战斗结算**: Power 比较 → KO 判定 → Life 扣减 → 胜负判定
- **通用关键词** (从 effect 字段自动解析):
  | 关键词 | 引擎行为 |
  |--------|---------|
  | `Rush` | 出场当回合标记 canAttack = true |
  | `Blocker` | 对手攻击时自动弹出 "是否使用 Blocker" 提示 |
  | `Counter +X000` | Counter 阶段自动加算到防御方 Power |
  | `Double Attack` | 攻击 Leader 成功时扣 2 点 Life |
  | `Banish` | KO 时移出游戏而非进入 Trash |

#### 玩家手动执行 (Manual Utility Actions)
引擎提供一组**通用工具动作**，按键/菜单触发，玩家根据卡面效果文字自行组合执行：
- `drawCards(count)` — 抽 X 张牌
- `viewTopDeck(count)` — 查看自己牌库顶 X 张（私密）
- `viewOpponentTopDeck(count)` — 查看对手牌库顶（需对手确认）
- `koTarget(characterId)` — KO 指定角色 → Trash
- `bounceToHand(cardId)` — 将场上卡牌弹回手牌
- `bounceToBottom(cardId)` — 将卡牌置于牌库底
- `recoverFromTrash(cardId)` — 从 Trash 捞回指定卡到手牌
- `searchDeck(filters?)` — 搜索牌库（弹出筛选面板，选中后加入手牌/场上）
- `modifyPower(targetId, delta)` — 临时增减目标 Power（本回合有效）
- `moveDon(fromId, toId, count)` — 移动 DON!! 到指定目标
- `revealLife(index)` — 翻开指定 Life 卡
- `addToLife(cardId)` — 将卡牌加入 Life 区
- `rest(targetId)` / `activate(targetId)` — 手动横置/恢复指定卡
- `trashFromHand(cardId)` — 从手牌弃牌到 Trash

#### 交互设计
- 卡牌详情弹窗始终显示完整效果文字（中文），玩家长按/点击即可查看
- 工具动作通过**底部动作菜单**触发（长按棋盘区域或点击工具栏图标）
- 所有手动动作会广播给对手，对手屏幕上显示操作日志（如 "对手使用效果: 抽 2 张牌"）
- 对手可对可疑操作发起**质疑 (Challenge)**，标记到操作日志

#### 后续迭代可选：效果脚本引擎
- 在 Card 数据库模型中增加 `effect_script` 字段（JSON DSL）
- 为高频热门卡编写效果脚本，引擎解释执行
- DSL 示例: `{ "trigger": "onPlay", "actions": [{ "type": "draw", "count": 2 }] }`
- 覆盖率目标: 先覆盖 Starter Deck 卡牌，再逐步扩展

### 2.3 Socket 事件流升级
- **File**: `game-server/src/index.js`
- **New Events**:
  - `game:play-character`
  - `game:attach-don`
  - `game:declare-attack`
  - `game:declare-blocker`
  - `game:play-counter`
  - `game:resolve-battle`
  - `game:trigger-effect` (Life trigger)

---

## 🎨 Phase 3: 前端 UI 重构 — 移动端体验

### 3.1 类型系统更新
- **File**: `client/src/contexts/GameContext.tsx`
- **Action**: 定义完整 OP TCG 数据结构 (Types for Leader, Character, DON, Phases)

### 3.2 视觉组件开发
- **File**: `client/src/components/`
  - `Card.tsx`: 支持 CSS `rotate(90deg)` 横置状态，右上角增加 DON!! 数量徽章 (+X000)
  - `LeaderCard.tsx`: 大尺寸展示，显示 Life 值
  - `GameBoard.tsx`: 主容器，管理 iOS 竖屏布局
  - `HandArea.tsx`: 手牌扇形交互优化
  - `Resources.tsx`: 整合显示 Life/Deck/Trash/Stage 状态
  - `DonArea.tsx`: 金色 DON!! 卡组与 Active 区域展示

### 3.3 游戏页面交互
- **File**: `client/src/pages/Game.tsx`
- **Layout** (Top to Bottom):
  1. **Opponent Info**: Avatar, Life, DON count
  2. **Opponent Board**: 
     - Row 1: Trash, Deck, Life, Stage, DON Deck
     - Row 2: Leader (Center), Characters (5 slots), Active DON pool
  3. **Center**: Turn Indicator, Phase Step, END Button
  4. **Player Board**: Mirror of Opponent
  5. **Hand**: Scrollable fan layout
- **Interactions**:
  - Drag active DON to cards -> Attach
  - Click active card in Battle Phase -> Select Attacker
  - Click target -> Confirm Attack
  - Counter Prompt -> Modal overlay for opponent

### 3.4 辅助页面重写
- **Lobby.tsx**: 移除房间号输入，改为自动匹配 (Matchmaking UI)
- **DeckBuilder.tsx**: 增加卡牌库筛选器 (Color/Cost/Type)，支持构建 50+1+10 合法卡组
- **OCR Import**: 集成相机调用，上传图片至 API 并自动填充卡组

---

## 🔧 技术依赖更新

### API Server (`requirements.txt`)
- `playwright>=1.40.0`
- `httpx>=0.27.0`
- `SQLAlchemy` (Existing)
- `EasyOCR` (Existing)

### Client (`package.json`)
- `framer-motion` (Existing - 需强化动画使用)
- `react-use-gesture` (建议新增 - 优化拖拽体验)

---

## 📝 执行顺序

1. **Setup**: 初始化数据库，安装 Playwright 依赖。
2. **Data**: 编写爬虫脚本，抓取基础卡牌数据 (Starter Decks ST-01 ~ ST-04) 以便开发测试。
3. **Backend**: 重写 `engine.js` 核心逻辑，通过单元测试验证规则 (DON 计算/战斗流程)。
4. **API**: 完成卡牌查询接口供前端调用。
5. **Frontend**: 按组件 -> 页面顺序重构 UI，对接新 Socket 协议。
6. **Polish**: 调整动画，增加音效，进行移动端适配测试。
