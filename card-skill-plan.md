# 卡牌技能自动化实现计划 (Scripted Cards)

## 🎯 核心目标
从"半自动通用工具"进阶为"全自动脚本化效果"。
针对现有数据库 (`seed.py`) 中的卡牌，建立一套 **Trigger-Script 系统**，使得通过 UI 操作（如登场、攻击）能自动触发特定卡牌逻辑，仅在必要时（如目标选择异常）回退到手动操作。

## 🏗️ 架构设计: Card Script System

### 1. 触发器模型 (Trigger Model)
引擎将监听以下关键生命周期事件，并查找对应卡牌的脚本 (Script)。

| Trigger | 时机 | 携带上下文 (Context) | 示例 |
|:---|:---|:---|:---|
| **ON_PLAY** | 角色/舞台卡从手牌进入此时区 | `{ triggerCardId, targetId? }` | 奈美登场检索、弗兰奇给Rush |
| **ON_ATTACK** | 宣言攻击步骤开始时 | `{ attackerId, targetId }` | 索隆(ST01-012)攻击时加攻 |
| **ON_BLOCK** | 宣言格挡时 | `{ blockerId, attackerId }` | 乔巴格挡时Buff |
| **ON_KO** | 卡牌即将进入墓地前 | `{ cardId, sourceId }` | 马尔高复活 |
| **TURN_END** | 回合结束阶段开始时 | `{ playerId }` | 白胡子领袖生命入手 |
| **ACTIVATE_MAIN** | 玩家主动点击"激活技能" | `{ cardId, costDon }` | 路飞领袖效果、恶魔风脚 |

### 2. 脚本注册表 (Script Registry)
在 `game-server/src/scripts/` 下建立卡牌逻辑映射：

```javascript
// scripts/registry.js
export const CARD_SCRIPTS = {
  'ST01-007': nami_onPlay,      // 奈美
  'ST01-012': zoro_onAttack,    // 索隆
  'OP02-001': whitebeard_end,   // 白胡子领袖
  // ...
};
```

---

## 📋 现有卡牌实现清单 (Based on Database)

### 🔴 草帽一伙 (ST01 Starter Deck)

| 卡号 | 名称 | 触发时机 | 自动化逻辑 | 状态 |
|:---|:---|:---|:---|:---:|
| **ST01-001** | 蒙奇·D·路飞 (Leader) | `ACTIVATE_MAIN` | **条件**: 活跃状态, 1回合1次<br>**效果**: 选1张休息DON给角色/领袖<br>**交互**: 点击领袖技能 -> 选目标 -> 自动转移DON | 🔄 待实现 |
| **ST01-006** | 托尼托尼·乔巴 | `BLOCKER` | **被动**: 引擎 `declareBlocker` 已支持 | ✅ 已支持 |
| **ST01-007** | **奈美** | `ON_PLAY` | **效果**: 看顶5张检索 [Straw Hat Crew]<br>**自动化**: <br>1. 自动调 `viewTopDeck(5)`<br>2. 弹窗 SearchModal (带 `trait='Straw Hat Crew'` 过滤)<br>3. 玩家选卡后自动 `resolveSearch` | 🔄 待实现 |
| **ST01-009** | 弗兰奇 | `ON_PLAY` | **效果**: 选1个3费以下 [Straw Hat Crew] 获得 [Rush]<br>**交互**: 登场 -> 弹窗选目标(filter: cost<=3 & trait) -> 给状态 | 🔄 待实现 |
| **ST01-011** | 蒙奇·D·路飞 (SR) | `RUSH` | **被动**: 引擎 `keywords: ['Rush']` 支持 | ✅ 已支持 |
| **ST01-012** | **罗罗诺亚·佐罗** (SR) | `ON_ATTACK` | **条件**: Don!! x1<br>**效果**: 本次战斗 +1000 Power<br>**自动化**: 攻击宣言时查 Don 数 -> 自动 `modifyPower(+1000)` | 🔄 待实现 |
| **ST01-013** | 橡胶火拳枪 (Event) | `COUNTER` | **效果**: 选1卡 +4000<br>**交互**: 反击阶段出牌 -> 选目标 -> `modifyPower(+4000)` | 🔄 待实现 |
| **ST01-015** | 恶魔风脚 (Event) | `ACTIVATE_MAIN` | **效果**: KO 1个3费以下休息角色<br>**交互**: 主要阶段出牌 -> 选目标(filter: rested & cost<=3) -> `koTarget` | 🔄 待实现 |
| **ST01-017** | 万里阳光号 (Stage) | `ACTIVATE_MAIN` | **效果**: 同领袖, 转移休息DON<br>**交互**: 启动 -> 选目标 -> 转移 | 🔄 待实现 |

### ⚪ 白胡子海盗团 (Whitebeard Pirates)

> *基于 decks.md 补充，需确保 seed.py 有对应数据*

| 卡号 | 名称 | 触发时机 | 自动化逻辑 | 状态 |
|:---|:---|:---|:---|:---:|
| **OP02-001** | **爱德华·纽哥特** (Leader) | `TURN_END` | **效果**: 自动从生命区拿1张上手<br>**自动化**: 回合结束事件 -> 调 `lifeToHand(top)` | ✅ 已实现(硬编码) |
| **OP03-003** | **伊佐** | `ON_PLAY` | **效果**: 看顶5张检索 [Whitebeard Pirates]<br>**自动化**: 同奈美，filter 换为白胡子特征 | 🔄 待实现 |
| **OP02-004** | 爱德华·纽哥特 (Char) | `ON_PLAY` | **效果**: 领袖+2000，本回合不能加血<br>**自动化**: `modifyPower(leader, 2000)` + `setRestriction('noLifeGain', true)` | 🔄 待实现 |
| **OP03-013** | **马尔高** (5费) | `ON_KO` | **效果**: 弃1事件卡复活<br>**交互**: 被KO前检测手牌事件卡 -> 弹窗询问 -> 弃牌并移除KO状态 | 🔄 待实现 |

---

## 🛠 开发路线图

### Stage 1: 脚本引擎基础设施 (Script Engine)
1.  **ScriptContext**: 定义脚本执行所需的上下文 API (封装 `koTarget`, `drawCards` 等底层方法，提供更高级易用的 DSL)。
    *   `ctx.player`: 当前玩家
    *   `ctx.target.select(filter)`: 弹窗请求玩家选目标
    *   `ctx.buff(target, power)`: 加攻
2.  **Hooks**: 在 `engine.js` 的 `playCard`, `declareAttack`, `endTurn` 处埋点，调用 `ScriptManager.execute(trigger, cardId)`.

### Stage 2: 检索类技能自动化 (Searchers)
目标: **ST01-007 奈美**, **OP03-003 伊佐**
1.  实现 `ctx.deck.search({ count: 5, filter: trait })`.
2.  前端 SearchModal 支持传入 `filter` 参数（非符合条件的卡置灰，不可选）。
3.  后端校验选中的卡是否符合 Filter。

### Stage 3: 战斗类技能自动化 (Combat Buffs)
目标: **ST01-012 索隆**, **OP02-004 白胡子**
1.  实现 `ctx.don.attached >= X` 检查。
2.  实现 `ON_ATTACK` 钩子。
3.  自动计算并应用临时 Buff (`modifyPower` 需支持 scope: 'battle' | 'turn')。

### Stage 4: 触发类交互 (Trigger Prompts)
目标: **马尔高 (复活)**, **Trigger 效果 (生命区触发)**
1.  实现 `Interrupt` 机制：引擎逻辑暂停，等待前端用户反馈（Yes/No 或 选牌）。
2.  前端统一的 `EffectResolutionModal`。

## ⚠️ 风险与降级
若脚本执行失败或未覆盖，系统应允许玩家**右键卡牌 -> 打开开发者菜单**，使用旧版通用工具手动修正状态（如手动加攻、手动看牌堆顶）。
