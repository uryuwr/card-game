# 卡牌技能实现计划 (White Beard & Red Zoro)

## 🎯 总体目标
完善游戏引擎以支持「白胡子」和「红索隆」两套主流卡组的完整对战体验。

## 📊 待办事项概览

### Phase 1: 核心机制扩展 (Engine & UI)
这些是支持具体卡牌效果的基础设施。

- [ ] **检索机制 (Search)**: 支持"查看卡组顶X张，选择特定特征卡牌加入手牌，其余沉底"。
  - *涉及卡牌*: OP03-003 伊佐, OP01-016 奈美, EB01-009 少啰唆
- [ ] **弃牌区互动 (Trash Interaction)**: 支持从弃牌区回收卡牌或从弃牌区登场。
  - *涉及卡牌*: OP01-015 乔巴, OP03-013 马尔高
- [ ] **生命区互动 (Life Interaction)**: 支持生命卡加入手牌、查看生命卡。
  - *涉及卡牌*: OP02-001 白胡子领袖, OP01-013 山智, OP01-029 离子光波
- [ ] **咚!!操作 (Don Manipulation)**: 支持"赋予休息状态的咚!!给角色"。
  - *涉及卡牌*: ST01-011 布鲁克, OP01-013 山智
- [ ] **多目标选择 (Target Selection)**: UI需要支持根据效果条件（如力量<3000）筛选合法目标。

### Phase 2: 白胡子卡组 (White Beard) 实现

> **特点**: 高力量大身板、操控生命值、无视阻挡

| 优先级 | 卡号 | 名称 | 技能类型 | 实现逻辑 | 引导/约束 |
|:---:|:---|:---|:---|:---|:---|
| **P0** | **OP02-001** | **爱德华·纽哥特** | [回合结束时] | 自动触发：回合结束阶段强制将生命区顶卡加入手牌 | 只有生命值>0时触发 |
| P0 | OP03-003 | 伊佐 | [登场时] | 检索：看5张找<白胡子海盗团> | 弹窗展示5张卡，仅允许选择符合条件的卡 |
| P0 | OP02-004 | 爱德华·纽哥特 | [登场时] | Buff：领袖+2000直到下回合；Debuff：玩家不能拿生命卡 | 需添加 `effectRestrictions` 状态 |
| P1 | OP02-013 | 艾斯 | [登场时] | 减益：2个角色-3000；条件速攻 | Step1: 选2个目标; Step2: 检查领袖特征赋予速攻 |
| P1 | OP03-013 | 马尔高 | [登场时]/[KO时] | 登场KO小怪；KO时弃事件复活 | KO时弹窗询问是否弃牌复活 |
| P1 | OP01-029 | 离子光波 | [反击] | 条件Buff：生命<=2时额外+2000 | 自动检测生命值计算加成 |
| P1 | ST01-012 | 路飞 | [启动主要] | 无视阻挡 | 给自身添加 `ignoreBlocker: true` 状态 |

### Phase 3: 红索隆卡组 (Red Zoro) 实现

> **特点**: 快攻 (Rush)、全场Buff、低费铺场

| 优先级 | 卡号 | 名称 | 技能类型 | 实现逻辑 | 引导/约束 |
|:---:|:---|:---|:---|:---|:---|
| **P0** | **OP01-001** | **罗罗诺亚·佐罗** | [常驻效果] | 贴1咚时全场+1000 | 在 `calculatePower` 中加入全局光环检查 |
| P0 | OP01-016 | 奈美 | [登场时] | 检索：看5张找<草帽一伙> | 弹窗展示5张卡，过滤条件同伊佐 |
| P0 | OP01-025 | 佐罗 | [速攻] | 关键词：Rush | 现有引擎已支持，需验证 |
| P1 | ST01-016 | 恶魔风脚 | [主要] | 指定单位本回合无视阻挡 | 选择友方单位 -> 赋予状态 |
| P1 | OP01-026 | 火拳枪 | [反击] | Buff + KO | 步骤1加战力 -> 步骤2选对方怪KO |
| P2 | EB01-003 | 基德&基拉 | [攻击时] | 条件Buff：对手生命<=2时+2000 | 攻击宣言时检查对手生命值 |

---

## 🛠 开发详细设计

### 1. Game Engine (`game-server/src/engine.js`)

#### 新增 Action Types
我们需要在 `playCharacter`, `playEvent` 等基础动作之外，增加更细粒度的效果执行动作。

- `resolveEffect(socketId, { cardId, effectId, targets: [] })`: 通用效果结算
- `searchDeck(socketId, { amount, filter })`: 检索卡组
- `manipulateLife(socketId, { action, count })`: 生命区操作

#### 状态扩展
在 `player` 对象中增加：
```javascript
player.effectRestrictions = {
  cannotLifeToHand: false, // 9费白胡子效果
  cannotActiveBlocker: false // 路飞/恶魔风脚效果
}
```

### 2. Client UI (`client/src/pages/Game.tsx`)

#### 新增交互弹窗
- **CardSelectorModal**: 用于检索效果（看5选1）。
  - Props: `cards: Card[]`, `filter: (c) => boolean`, `onSelect: (c) => void`
- **EffectTargetModal**: 用于需要主动选择目标的效果（如艾斯选2个对手角色减攻）。
  - 允许选择场上的角色卡，支持最大选择数量限制。
- **AutoTriggerPrompt**: 触发式效果询问（如马尔高复活）。
  - "马尔高将会被KO，是否丢弃一张事件卡使其复活？" [是] [否]

### 3. Socket Events (`shared/constants.js`)

新增事件通讯：
```javascript
SOCKET_EVENTS: {
  // ... existing
  EFFECT_TRIGGERED: 'game:effect-triggered', // 服务端通知客户端有效果待处理（如检索）
  RESOLVE_EFFECT: 'game:resolve-effect',     // 客户端提交效果处理结果（如选了哪张牌）
  SHOW_SELECTION_MODAL: 'ui:show-selection',  // 要求前端显示选牌/选目标弹窗
}
```

---

## 📝 下一步执行计划

1. **实现领袖效果 (P0)**: 优先完成 OP02-001 白胡子 (回合结束拿血) 和 OP01-001 索隆 (全场Buff)。
2. **构建通用检索系统 (P0)**: 完成奈美/伊佐的 "看5选1" 逻辑，这是两套牌运转的核心。
3. **实现核心事件卡 (P1)**: 恶魔风脚、反礼仪踢技等基础攻防卡。
4. **完善高费大哥卡 (P1)**: 9费白胡子、7费艾斯的复杂登场效果。
