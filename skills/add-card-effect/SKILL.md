---
name: add-card-effect
description: 为海贼王卡牌游戏添加新的卡牌效果。分析卡牌文本确定触发类型，在 CardScripts.js 中编写脚本，必要时扩展 ActionDSL 和 TriggerSystem。用于用户请求实现某张卡牌效果或修复效果相关 Bug 时。
---

## 流程概述

1. 分析卡牌文本，确定触发类型(triggerType)和效果
2. 在 CardScripts.js 添加脚本
3. 验证/添加所需的 Action 类型
4. 处理交互效果（PENDING_* 类型）
5. 测试与调试

---

## Step 1: 分析卡牌文本

### 确定触发类型 (triggerType)

| 触发类型 | 卡牌文本关键词 | 说明 |
|----------|----------------|------|
| `ON_PLAY` | "登场时" | 角色卡出场时触发 |
| `ON_ATTACK` | "攻击时" | 宣言攻击时触发 |
| `COUNTER` | "反击" | Counter 阶段使用 |
| `TRIGGER` | "【触发】" | 生命牌翻开时可选发动 |
| `TURN_END` | "回合结束时" | 回合结束阶段触发 |
| `ON_KO` | "被KO时" | 被击败时触发 |
| `ACTIVATE_MAIN` | "【主要】" | 主要阶段手动发动 |
| `CONSTANT` | 持续生效（无关键词） | 被动效果，计算力量/关键词时检查 |
| `BLOCKER` | "【阻挡者】" | 阻挡者关键词能力 |
| `RUSH` | "【速攻】" | 出场即可攻击 |

### 确定条件 (conditions)

| 条件类型 | 说明 | 示例 |
|----------|------|------|
| `CHECK_DON` | 检查源卡牌绑定DON数 | `{ type: 'CHECK_DON', amount: 2 }` |
| `CHECK_RESTED_DON` | 检查玩家休息DON数 | `{ type: 'CHECK_RESTED_DON', minAmount: 1 }` |
| `CHECK_LIFE` | 检查生命值 | `{ type: 'CHECK_LIFE', operator: '<=', amount: 2 }` |
| `CHECK_RESTRICTION` | 检查限制条件 | `{ type: 'CHECK_RESTRICTION', restriction: 'cannotLifeToHand' }` |
| `CHECK_ONCE_PER_TURN` | 每回合一次 | `{ type: 'CHECK_ONCE_PER_TURN', effectId: 'ST01-012-on-attack' }` |
| `CHECK_ATTRIBUTE` | 检查己方角色特征 | `{ type: 'CHECK_ATTRIBUTE', scope: 'player', attribute: '超新星/船长', minCount: 1 }` |

### 确定效果 (actions)

常用 Action 类型：

| Action | 说明 | 参数 |
|--------|------|------|
| `MODIFY_POWER` | 修改力量 | `target: 'SELF'/'LEADER'/'SELECTED'`, `amount: number` |
| `LOG` | 输出日志 | `message: string` |
| `DRAW_CARDS` | 抽卡 | `count: number` |
| `LIFE_TO_HAND` | 生命加入手牌 | (无参数，需交互) |
| `ADD_ATTACK_STATE` | 添加攻击状态 | `state: 'ignoreBlocker'/'cannotBeBlocked'` |
| `REST_DON` | 横置 DON | `count: number` |
| `SET_KEYWORD` | 设置关键词 | `keyword: 'blocker'/'rush'`, `target`, `expiry` |
| `PENDING_SELECT_TARGET` | 选择目标 | `targetScope`, `targetTypes`, `maxSelect`, `onSelect` |
| `PENDING_KO_TARGET` | KO 目标 | `targetScope`, `targetTypes`, `filter`, `message` |
| `PENDING_ATTACH_DON` | 贴 DON 到目标 | `donCount`, `donState`, `targetScope`, `targetTypes`, `message` |

---

## Step 2: 在 CardScripts.js 添加脚本

**文件路径**: `game-server/src/script-engine/CardScripts.js`

### 脚本模板

```javascript
/**
 * {卡牌编号} {卡牌名称}
 * {效果文本}
 * {费用说明（如有）}
 */
'{卡牌编号}': {
  triggerType: 'ON_PLAY',  // 触发类型
  cost: 0,                  // DON 费用（可选）
  conditions: [             // 触发条件（可选）
    { type: 'CHECK_DON', amount: 2 },
  ],
  actions: [                // 执行动作
    { type: 'LOG', message: '效果发动!' },
    { type: 'MODIFY_POWER', target: 'SELF', amount: 2000 },
  ],
},
```

### 示例 1: 简单力量修改 (ON_ATTACK)

```javascript
/**
 * ST01-012 纳米
 * 攻击时 ①(场上有己方「超新星」或「船长」特征角色时)
 * 这个角色直到本回合结束为止，力量+2000
 */
'ST01-012': {
  triggerType: 'ON_ATTACK',
  conditions: [
    {
      type: 'CHECK_ATTRIBUTE',
      scope: 'player',
      attribute: '超新星/船长',
      minCount: 1,
    },
  ],
  actions: [
    { type: 'MODIFY_POWER', target: 'SELF', amount: 2000, expiry: 'END_OF_TURN' },
    { type: 'LOG', message: 'ST01-012 效果: 攻击时+2000!' },
  ],
},
```

### 示例 2: 带交互的选择目标 (ON_PLAY)

```javascript
/**
 * OP03-013 马尔高
 * 登场时 将最多1张DON!!以活动状态贴附到己方1张领袖或角色上
 */
'OP03-013': {
  triggerType: 'ON_PLAY',
  conditions: [],
  actions: [
    {
      type: 'PENDING_ATTACH_DON',
      donCount: 1,
      donState: 'active',
      targetScope: 'player',
      targetTypes: ['leader', 'character'],
      maxSelect: 1,
      message: '选择要贴附DON的目标',
    },
  ],
},
```

### 示例 3: 消耗后贴DON (ON_PLAY + 休息DON检测)

```javascript
/**
 * ST01-011 布鲁克
 * 登场时 将最多2张休息状态的DON!!贴附到己方1张领袖或角色上
 * 关键点：召唤消耗的DON会变成休息DON，然后可以贴给目标
 */
'ST01-011': {
  triggerType: 'ON_PLAY',
  conditions: [
    { type: 'CHECK_RESTED_DON', minAmount: 1 },  // 至少需要1个休息DON
  ],
  actions: [
    {
      type: 'PENDING_ATTACH_DON',
      donCount: 2,        // 最多贴2个DON到同一目标
      donState: 'rested', // 使用休息状态的DON
      targetScope: 'player',
      targetTypes: ['leader', 'character'],
      maxSelect: 1,       // 只能选1个目标
      message: '选择己方1张领袖或角色，贴附最多2张休息DON',
    },
  ],
},
```

> **注意**: `donCount` 是贴到单个目标的DON数量，`maxSelect` 是可选择的目标数量。
> 布鲁克效果是贴2个DON到1个目标，而非每个目标各贴1个。

### 示例 4: CONSTANT 被动效果

```javascript
/**
 * P-006 路飞
 * 场上有己方2张贴附DON的角色时，这张领袖力量+2000
 */
'P-006': {
  triggerType: 'CONSTANT',
  conditions: [],
  actions: [
    {
      type: 'CONDITIONAL_DYNAMIC_POWER',
      condition: {
        type: 'COUNT_DON_ATTACHED_CHARACTERS',
        scope: 'player',
        minCount: 2,
      },
      dynamicPower: 2000,
    },
  ],
},
```

### 示例 4: ACTIVATE_MAIN 手动发动

```javascript
/**
 * OP01-030 激光
 * 【主要】己方领袖拥有「海军」特征时，横置己方1张DON!!:
 * 这个回合中，己方1张领袖或角色力量+2000
 */
'OP01-030': {
  triggerType: 'ACTIVATE_MAIN',
  cost: 1,  // 横置 1 DON
  conditions: [
    { type: 'CHECK_LEADER_ATTRIBUTE', attribute: '海军' },
  ],
  actions: [
    {
      type: 'PENDING_SELECT_TARGET',
      targetScope: 'player',
      targetTypes: ['leader', 'character'],
      maxSelect: 1,
      message: '选择要+2000力量的目标',
      onSelect: [
        { type: 'MODIFY_POWER', target: 'SELECTED', amount: 2000, expiry: 'END_OF_TURN' },
        { type: 'LOG', message: '力量+2000!' },
      ],
    },
  ],
},
```

### 示例 5: TRIGGER 生命牌效果

**重要**: TRIGGER 与其他触发类型不同，不会被自动注册到 TriggerSystem。而是当生命牌被翻开时，直接从 CARD_SCRIPTS 查找并提供玩家选择是否发动。

如果一张卡同时有 COUNTER 和 TRIGGER 效果，需要使用数组格式：

```javascript
/**
 * ST01-014 毛皮強化
 * 【反击】己方1张领袖或角色直到本回合结束为止，力量+3000
 * 【触发】己方1张领袖或角色直到本回合结束为止，力量+1000
 */
'ST01-014': [
  // COUNTER 效果
  {
    triggerType: 'COUNTER',
    actions: [
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'player',
        targetTypes: ['leader', 'character'],
        maxSelect: 1,
        message: '选择要+3000力量的目标',
        onSelect: [
          { type: 'MODIFY_POWER', target: 'SELECTED', amount: 3000, expiry: 'END_OF_TURN' },
          { type: 'LOG', message: 'ST01-014: 力量+3000!' },
        ],
      },
    ],
  },
  // TRIGGER 效果（生命牌翻开时可选发动）
  {
    triggerType: 'TRIGGER',
    actions: [
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'player',
        targetTypes: ['leader', 'character'],
        maxSelect: 1,
        message: '选择要+1000力量的目标',
        onSelect: [
          { type: 'MODIFY_POWER', target: 'SELECTED', amount: 1000, expiry: 'END_OF_TURN' },
          { type: 'LOG', message: 'ST01-014 触发效果: 力量+1000!' },
        ],
      },
    ],
  },
],
```

> **TRIGGER 特殊规则**:
> 1. TRIGGER 脚本**不会**被 TriggerSystem.registerScript 注册
> 2. 当领袖受到伤害、生命牌翻开时，系统检查该卡是否有 TRIGGER 脚本
> 3. 若有则发送 `game:trigger-prompt` 事件让玩家选择是否发动
> 4. 玩家通过 `game:respond-trigger` 回复选择结果
> 5. TRIGGER 是可选的，玩家可以选择不发动

---

## Step 3: 验证/添加 Action 类型

**检查文件**: `game-server/src/script-engine/ActionDSL.js` 和 `TriggerSystem.js`

### 已支持的 Action 一览

查看 `TriggerSystem.js` 中 `executeAction()` 方法的 switch 语句确认支持的类型。

### 添加新 Action 类型的步骤

#### 3.1 在 ActionDSL.js 添加原子操作

```javascript
// game-server/src/script-engine/ActionDSL.js

/**
 * 新增: 将对手场上角色返回手牌
 */
bounceToHand(targetInstanceId) {
  const opponent = this.context.getOpponent()
  const charIndex = opponent.characters.findIndex(
    s => s.card.instanceId === targetInstanceId
  )
  if (charIndex === -1) {
    this.context.log(`bounceToHand 失败: 找不到目标`)
    return false
  }

  const [slot] = opponent.characters.splice(charIndex, 1)
  opponent.donRested += slot.attachedDon  // 释放贴附的 DON
  opponent.hand.push(slot.card)           // 卡牌返回手牌
  
  this.context.log(`${slot.card.nameCn} 返回手牌`)
  return true
}
```

#### 3.2 在 TriggerSystem.js 注册处理

```javascript
// TriggerSystem.js - executeAction() 方法内

case 'BOUNCE_TO_HAND':
  if (!action.target || action.target === 'SELECTED') {
    return {
      needsInteraction: true,
      type: 'SELECT_TARGET',
      targetScope: action.targetScope || 'opponent',
      targetTypes: action.targetTypes || ['character'],
      // ...
    }
  }
  return { success: dsl.bounceToHand(action.target) }
```

---

## Step 4: 处理交互效果 (PENDING_* 类型)

交互效果需要客户端响应，这是最容易出 Bug 的地方。

### ⚠️ 关键点 1: 返回值格式

PENDING_* 类型的 Action **必须**返回包含交互信息的对象：

```javascript
// ✅ 正确写法
return {
  needsInteraction: true,
  type: 'ATTACH_DON',  // 或 'SELECT_TARGET', 'KO_TARGET'
  validTargets: [...],
  message: '选择目标',
  donCount: 1,  // ATTACH_DON 特有
  donState: 'active',
}

// ❌ 错误写法（曾经的 Bug）
return true  // 缺少交互信息，客户端不知道如何处理
```

### ⚠️ 关键点 2: 服务端广播 pendingEffect

在 `engine.js` 中设置 `pendingEffect` 后，需要在 `index.js` 中广播给客户端：

```javascript
// game-server/src/index.js

function broadcastPendingEffect(room, socketId) {
  const pendingEffect = room.engine.pendingEffect
  if (!pendingEffect) return

  const player = room.engine.players.get(socketId)
  if (!player) return

  io.to(socketId).emit('game:pending-effect', {
    type: pendingEffect.type,
    validTargets: pendingEffect.validTargets,
    message: pendingEffect.message,
    canSkip: pendingEffect.canSkip ?? true,
    // ... 其他字段
  })
}
```

### ⚠️ 关键点 3: 在正确的时机调用广播

```javascript
// game-server/src/index.js - 各事件处理中

socket.on('game:play-character', (cardId) => {
  const result = room.engine.playCharacter(socket.id, cardId)
  if (result.success) {
    broadcastGameState(room)
    broadcastPendingEffect(room, socket.id)  // ← 关键: 广播交互请求
  }
})
```

### ⚠️ 关键点 4: 客户端处理交互

检查 `client/src/pages/Game.tsx` 是否正确监听和处理 `game:pending-effect` 事件：

```typescript
// Game.tsx
useEffect(() => {
  socket.on('game:pending-effect', (data) => {
    setPendingEffect(data)
    // 根据 type 显示不同的 UI（选择目标、跳过等）
  })
}, [])
```

---

## Step 5: 测试与调试

### 5.1 添加调试日志

在可疑位置添加 `console.log`:

```javascript
// TriggerSystem.js
console.log('[TriggerSystem] executeAction:', action.type, action)
console.log('[TriggerSystem] condition check:', cond.type, '=', result)

// engine.js
console.log('[Engine] pendingEffect set:', this.pendingEffect)
```

### 5.2 运行测试游戏

```bash
cd game-server
npm run dev
```

在浏览器中创建房间、匹配，测试卡牌效果。

### 5.3 常见 Bug 及解决方案

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 效果不触发 | triggerType 不匹配 | 检查卡牌文本，确认正确的触发类型 |
| 条件永远失败 | conditions 逻辑错误 | 添加日志打印条件检查结果 |
| 交互 UI 不显示 | 未广播 pendingEffect | 在 index.js 添加 broadcastPendingEffect() 调用 |
| 选择目标后无反应 | validTargets 为空 | 检查目标筛选逻辑 |
| CONSTANT 效果不生效 | 未调用 getDynamicPower | 确保 engine._calculatePower() 调用了 scriptEngine.getDynamicPower() |
| ACTIVATE_MAIN 无法发动 | 缺少发动入口 | 检查 RadialMenu 是否有"发动效果"选项 |
| 贴DON后力量没变 | donCount vs maxSelect 混淆 | donCount=贴几个DON，maxSelect=选几个目标 |
| ON_PLAY 消耗DON后效果不触发 | 条件检查时机问题 | 用 CHECK_RESTED_DON 检查消耗后产生的休息DON |

### 5.4 PENDING_ATTACH_DON 参数说明

| 参数 | 说明 | 示例 |
|------|------|------|
| `donCount` | 要贴的DON总数量 | `2` = 贴2个DON |
| `maxSelect` | 可选择的目标数量 | `1` = 只能选1个目标 |
| `donState` | 使用的DON状态 | `'rested'` 或 `'active'` |
| `targetScope` | 目标范围 | `'player'` 或 `'opponent'` |
| `targetTypes` | 目标类型 | `['leader', 'character']` |

**常见组合:**
- 贴2DON到1目标: `donCount: 2, maxSelect: 1`
- 贴1DON到2目标: `donCount: 2, maxSelect: 2` (会平分)
- 贴1DON到1目标: `donCount: 1, maxSelect: 1`

---

## 架构参考

### 文件职责

| 文件 | 职责 |
|------|------|
| `CardScripts.js` | 卡牌脚本定义（纯数据） |
| `ActionDSL.js` | 原子操作实现（修改游戏状态） |
| `TriggerSystem.js` | 触发检查 + Action 执行调度 |
| `ScriptContext.js` | 脚本执行上下文（封装引擎状态访问） |
| `engine.js` | 游戏引擎核心逻辑 |
| `index.js` | Socket.IO 事件处理 + 状态广播 |

### 执行流程

```
卡牌使用 
  → engine.playCharacter() 
    → scriptEngine.triggerCardEffect()
      → TriggerSystem.checkConditions()
      → TriggerSystem.executeActions()
        → ActionDSL.xxx()
  → 返回 { success, needsInteraction, ... }
  → index.js 广播状态 + pendingEffect
  → 客户端更新 UI
```

---

## Checklist

添加新卡牌效果前，确认以下事项：

- [ ] 已确定正确的 triggerType
- [ ] 已理解所有条件的检查方式
- [ ] 所需的 Action 类型已存在（或已添加）
- [ ] PENDING_* 返回值包含完整交互信息
- [ ] index.js 在适当位置调用 broadcastPendingEffect()
- [ ] 客户端正确处理对应的 pendingEffect.type
- [ ] 添加了调试日志便于排查问题
