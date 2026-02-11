# 卡牌技能自动化实现计划 (Based on Card DB)

## 🎯 核心目标
针对 **数据库中实际存在的卡牌**，建立自动化脚本覆盖。
当前版本着重于 **OP01/ST01 (草帽一伙)**, **OP02/OP03 (白胡子)** 及 **EB01/OP08 (动物/乔巴)** 三个体系。

## 🏗️ 架构设计: Card Script System

### 1. 触发器模型 (Trigger Model)
引擎将监听以下关键生命周期事件，并查找对应卡牌的脚本 (Script)。

| Trigger | 时机 | 携带上下文 (Context) | 示例 |
|:---|:---|:---|:---|
| **ON_PLAY** | 角色/舞台卡从手牌进入此时区 | `{ triggerCardId, targetId? }` | 奈美登场检索、布鲁克给Don |
| **ON_ATTACK** | 宣言攻击步骤开始时 | `{ attackerId, targetId }` | 路飞/索隆攻击时效果 |
| **ON_BLOCK** | 宣言格挡时 | `{ blockerId, attackerId }` | 乔巴格挡 |
| **ON_KO** | 卡牌即将进入墓地前 | `{ cardId, sourceId }` | 马尔高复活、莉姆退场Debuff |
| **TURN_END** | 回合结束阶段开始时 | `{ playerId }` | 白胡子领袖生命入手 |
| **ACTIVATE_MAIN** | 玩家主动点击"激活技能" | `{ cardId, costDon }` | 恶魔风脚、山智启动效果 |

---

## 📋 数据库卡牌实现清单 (Inventory)

### 🔴 草帽一伙 (Straw Hat Crew) - 红色快攻/中速

| 卡号 | 名称 | 触发时机 | 自动化逻辑 | 状态 |
|:---|:---|:---|:---|:---:|
| **OP01-001** | **罗罗诺亚·佐罗** (Leader) | `CONSTANT` | **效果**: [我方回合] 所有角色+1000 (需绑1 Don)<br>**实现**: 在 `CalculationService` 中添加全局光环检查 `if (leader.don >= 1 && myTurn)` | ✅ 已支持 |
| **OP01-025** | **罗罗诺亚·佐罗** | `KEYWORD` | **效果**: [速攻]<br>**实现**: 引擎原生支持 `Rush` | ✅ 已支持 |
| **ST01-012** | **蒙奇·D·路飞** | `ON_ATTACK` | **条件**: [Don!! x2]<br>**效果**: 本次战斗对手不能发动[阻挡者]<br>**自动化**: `checkDon(2)` -> `addState(self, 'ignoreBlocker')` | 🔄 待实现 |
| **ST01-011** | **布鲁克** | `ON_PLAY` | **效果**: 赋予己方2张休息Don<br>**自动化**: 自动调 `attachDon(target, 2, { from: 'rested' })` | 🔄 待实现 |
| **OP01-016** | **奈美** | `ON_PLAY` | **效果**: 看顶5张检索 [Straw Hat Crew] (除奈美)<br>**自动化**: `viewTop(5)` -> 弹窗(Filter: `trait='Straw Hat Crew' & name!='Nami'`) -> `resolveSearch` | 🔄 待实现 |
| **OP01-013** | **山智** | `ACTIVATE_MAIN` | **条件**: [1回合1次]<br>**效果**:以此卡+2000并贴2休息Don，代价是拿1生命<br>**自动化**: `lifeToHand` -> `modifyPower(+2000)` -> `attachDon(rested, 2)` | 🔄 待实现 |
| **OP01-015** | **乔巴** | `ON_ATTACK` | **条件**: [Don!! x1] & 弃1手牌<br>**效果**: 回收墓地Cost<=4 [Straw Hat]<br>**自动化**: 弹窗(Cost: Discard) -> `recoverFromTrash(filter)` | 🔄 待实现 |
| **ST01-016** | **恶魔风脚** (Event) | `ACTIVATE_MAIN` | **效果**: 选1 [Straw Hat] 本回合无视阻挡<br>**自动化**: 选目标 -> `addState(target, 'ignoreBlocker')` | 🔄 待实现 |
| **ST21-003** | **山智** | `ON_PLAY` | **效果**: 选1 Power>=6000 [Straw Hat] 本回合无视阻挡<br>**自动化**: 选目标(filter: power>=6000) -> `addState(target, 'ignoreBlocker')` | 🔄 待实现 |
| **OP01-026** | **橡皮火拳枪** (Event) | `COUNTER` | **效果**: +4000 并 KO对手<=4000<br>**自动化**: `modifyPower(+4000)` -> 选目标KO | 🔄 待实现 |
| **OP01-029** | **离子光波** (Event) | `COUNTER` | **效果**: +2000, 若生命<=2再+2000<br>**自动化**: 判定生命值 -> `modifyPower(life<=2 ? 4000 : 2000)` | 🔄 待实现 |

### ⚪ 白胡子海盗团 (Whitebeard Pirates) - 红色控制/坦克

| 卡号 | 名称 | 触发时机 | 自动化逻辑 | 状态 |
|:---|:---|:---|:---|:---:|
| **OP02-001** | **爱德华·纽哥特** (Leader) | `TURN_END` | **效果**: 生命区顶牌入手<br>**自动化**: `lifeToHand(0)` | ✅ 已支持 |
| **OP02-004** | **爱德华·纽哥特** (Char) | `ON_PLAY`<br>`ON_ATTACK` | **Play**: 领袖+2000(下回合前), 禁回血<br>**Attack**: [Don!! x2] KO <=3000<br>**自动化**: 复合脚本支持多Trigger | 🔄 待实现 |
| **OP03-003** | **伊佐** | `ON_PLAY` | **效果**: 看顶5张检索 [WB Pirates]<br>**自动化**: 同奈美 (Filter: `trait='Whitebeard Pirates'`) | 🔄 待实现 |
| **OP03-013** | **马尔高** | `ON_PLAY`<br>`ON_KO` | **Play**: KO <=3000<br>**KO**: 弃1事件复活<br>**自动化**: KO时触发 Interrupt 弹窗 -> 弃牌 -> `revive('rested')` | 🔄 待实现 |
| **OP02-013** | **艾斯** | `ON_PLAY` | **效果**: 2个对手-3000; 若领袖是WB则获得[Rush]<br>**自动化**: 双目标Debuff -> 查领袖 -> 给Rush | 🔄 待实现 |
| **OP02-008** | **乔兹** | `CONSTANT` | **效果**: 若生命<=2 & 领袖WB -> 获得[Rush]<br>**自动化**: 动态 `hasKeyword` 检查 | 🔄 待实现 |
| **OP02-015** | **卷乃** | `ACTIVATE_MAIN` | **效果**: 转休息 -> 选1红Cost1角色 +3000<br>**自动化**: `restSelf` -> 选目标 -> `modifyPower(+3000)` | 🔄 待实现 |
| **OP03-015** | **莉姆** | `ON_KO` | **条件**: [对手回合]<br>**效果**: 对手 -2000<br>**自动化**: 检测回合主 -> 选目标Debuff | 🔄 待实现 |

### 🟢 动物/乔巴体系 (Animal / Chopper) - 铺场/其它

| 卡号 | 名称 | 触发时机 | 自动化逻辑 | 状态 |
|:---|:---|:---|:---|:---:|
| **OP08-15** | **Dr.古蕾娃** | `ON_PLAY` | **效果**: 看顶4张检索 [Drum Kingdom]/[Chopper] | 🔄 待实现 |
| **OP08-07** | **乔巴** | `ON_PLAY`<br>`ON_ATTACK` | **效果**: 看顶5张 -> 登场 Cost<=4 [Animal] (Rested)<br>**自动化**: 检索 -> 选卡 -> `playCard(rested)` | 🔄 待实现 |
| **OP04-10** | **乔巴** | `ON_PLAY` | **效果**: 手牌登场 Cost<=3 [Animal]<br>**自动化**: 选手牌 -> `playCard` | 🔄 待实现 |
| **EB01-09** | **少啰唆!!** (Event) | `COUNTER` | **效果**: 看顶5张 -> 登场 Cost<=3 [Animal] (Rested)<br>**自动化**: 反击阶段特殊召唤 | 🔄 待实现 |

---

## 🛠 开发路线图

### Stage 1: 脚本引擎基础设施 (Script Engine) - P0
1.  **ScriptContext**: 封装 `ctx.source`, `ctx.player`, `ctx.game`.
2.  **TriggerSystem**: 在 `engine.js` 关键节点 (`playCard`, `declareAttack`, `koCard`, `setupDefense`) 埋入 Hook。
3.  **Action DSL**: 提供 `ctx.actions.search()`, `ctx.actions.buff()`, `ctx.actions.ko()` 等原子能力。

### Stage 2: 关键词与状态系统 (State System) - P0
1.  **Rush (Condition)**: 完善动态 Rush 判定 (如乔兹/艾斯)。
2.  **Ignore Blocker**: 实现 "无视阻挡" 状态位 (路飞/山智/恶魔风脚)。
3.  **Cost Check**: 实现 "满足条件才触发" 的逻辑 (如 Don x N, Life <= N)。

### Stage 3: 弹窗交互增强 (UI Interaction) - P1
1.  **SearchModal**: 支持 Filter 参数。
2.  **TriggerPrompt**: 支持 "是否发动效果?" 的询问弹窗 (用于 KO 复活、攻击时弃牌等可选效果)。
