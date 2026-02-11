/**
 * ScriptEngine - 卡牌脚本引擎主入口
 * 协调 TriggerSystem, ScriptContext, ActionDSL
 * 
 * 核心流程:
 * 1. 游戏开始时，为场上每张有 effectScript 的卡注册触发器
 * 2. 引擎在关键节点调用 executeTrigger(type, context)
 * 3. ScriptEngine 查找匹配的脚本，检查条件，执行动作
 */

import { TriggerSystem, TRIGGER_TYPES } from './TriggerSystem.js'
import { ScriptContext } from './ScriptContext.js'
import { ActionDSL } from './ActionDSL.js'
import { CARD_SCRIPTS } from './CardScripts.js'

export { TRIGGER_TYPES } from './TriggerSystem.js'

export class ScriptEngine {
  /**
   * @param {import('../engine.js').GameEngine} engine
   */
  constructor(engine) {
    this.engine = engine
    this.triggerSystem = new TriggerSystem()
  }

  // =====================
  // 脚本注册 / 注销
  // =====================

  /**
   * 注册一张卡的脚本（登场时调用）
   * @param {object} card - 卡牌数据
   * @param {string} instanceId - 实例ID
   * @param {string} playerId - 所属玩家ID
   */
  registerCard(card, instanceId, playerId) {
    console.log(`[ScriptEngine] registerCard: ${card.cardNumber} (${card.nameCn || card.name})`)
    const scriptDef = this._getScriptDefinition(card)
    if (!scriptDef) {
      console.log(`[ScriptEngine] No script found for ${card.cardNumber}`)
      return
    }
    console.log(`[ScriptEngine] Script found for ${card.cardNumber}:`, JSON.stringify(scriptDef).slice(0, 100))

    const triggers = Array.isArray(scriptDef) ? scriptDef : [scriptDef]

    for (const trigger of triggers) {
      if (!trigger.triggerType || !TRIGGER_TYPES[trigger.triggerType]) {
        console.warn(`[ScriptEngine] Invalid trigger type for ${card.cardNumber}: ${trigger.triggerType}`)
        continue
      }

      this.triggerSystem.register(
        trigger.triggerType,
        instanceId,
        card.cardNumber,
        playerId,
        trigger
      )
    }
  }

  /**
   * 注销一张卡的所有脚本（KO/弹回时调用）
   * @param {string} instanceId
   */
  unregisterCard(instanceId) {
    this.triggerSystem.unregister(instanceId)
  }

  /**
   * 为游戏初始化注册所有在场卡牌的脚本
   * 通常在 startGame 之后调用，注册双方领袖
   */
  registerInitialCards() {
    for (const player of this.engine.players) {
      // 注册领袖
      this.registerCard(player.leader.card, player.leader.card.instanceId, player.id)

      // 注册已在场的角色（通常游戏开始时没有）
      for (const charSlot of player.characters) {
        this.registerCard(charSlot.card, charSlot.card.instanceId, player.id)
      }
    }

    console.log('[ScriptEngine] Initial card registration complete')
    this.triggerSystem.dump()
  }

  // =====================
  // 触发执行
  // =====================

  /**
   * 执行某个触发类型的所有匹配脚本
   * @param {string} triggerType - TRIGGER_TYPES 之一
   * @param {object} triggerInfo - 触发上下文信息
   *   { sourceCard, sourceSlot, player, opponent, extra? }
   * @returns {Array<{cardNumber, executed, result}>}
   */
  executeTrigger(triggerType, triggerInfo) {
    const scripts = this.triggerSystem.getScripts(triggerType)
    console.log(`[ScriptEngine] executeTrigger(${triggerType}): ${scripts.length} scripts found, source: ${triggerInfo.sourceCard?.cardNumber}`)
    if (scripts.length === 0) return []

    const results = []

    for (const entry of scripts) {
      console.log(`[ScriptEngine] Checking script: ${entry.cardNumber}, instanceId: ${entry.instanceId}, sourceInstance: ${triggerInfo.sourceCard?.instanceId}`)
      // 检查是否是相关玩家的脚本
      // ON_PLAY/ON_ATTACK: 只执行触发源所属玩家的脚本
      // ON_KO: 被KO卡牌所属玩家的脚本
      // TURN_END: 当前回合玩家的脚本
      if (!this._shouldExecute(triggerType, entry, triggerInfo)) {
        console.log(`[ScriptEngine] _shouldExecute returned false for ${entry.cardNumber}`)
        continue
      }

      const context = new ScriptContext(this.engine, {
        triggerType,
        sourceCard: triggerInfo.sourceCard,
        sourceSlot: triggerInfo.sourceSlot,
        player: this.engine.players.find(p => p.id === entry.playerId),
        opponent: this.engine.players.find(p => p.id !== entry.playerId),
      })

      const actions = new ActionDSL(context)

      try {
        // 检查条件
        if (!this._checkConditions(entry.script, context, triggerInfo)) {
          results.push({ cardNumber: entry.cardNumber, executed: false, reason: 'conditions_not_met' })
          continue
        }

        // 执行动作
        const result = this._executeActions(entry.script, context, actions, triggerInfo)
        results.push({ cardNumber: entry.cardNumber, executed: true, result })

      } catch (error) {
        console.error(`[ScriptEngine] Error executing ${entry.cardNumber}:`, error)
        results.push({ cardNumber: entry.cardNumber, executed: false, reason: 'error', error: error.message })
      }
    }

    return results
  }

  // =====================
  // 内部方法
  // =====================

  /**
   * 获取卡牌的脚本定义
   * 优先从硬编码的 CARD_SCRIPTS 查找，后续可扩展到 effectScript 字段
   */
  _getScriptDefinition(card) {
    // 优先从 CARD_SCRIPTS 注册表查找
    if (CARD_SCRIPTS[card.cardNumber]) {
      return CARD_SCRIPTS[card.cardNumber]
    }
    // 后续可以从 card.effectScript 解析 JSON 脚本
    return null
  }

  /**
   * 检查卡牌是否有指定触发类型的脚本
   * @param {string} cardNumber - 卡牌编号
   * @param {string} triggerType - 触发类型
   * @returns {boolean}
   */
  hasScript(cardNumber, triggerType) {
    const scriptDef = CARD_SCRIPTS[cardNumber]
    if (!scriptDef) return false
    
    const triggers = Array.isArray(scriptDef) ? scriptDef : [scriptDef]
    return triggers.some(t => t.triggerType === triggerType)
  }

  /**
   * 判断是否应该执行此脚本
   */
  _shouldExecute(triggerType, entry, triggerInfo) {
    switch (triggerType) {
      case TRIGGER_TYPES.ON_PLAY:
        // ON_PLAY 只执行刚登场的那张卡的脚本
        return entry.instanceId === triggerInfo.sourceCard?.instanceId

      case TRIGGER_TYPES.ON_ATTACK:
        // ON_ATTACK 只执行攻击者的脚本
        return entry.instanceId === triggerInfo.sourceCard?.instanceId

      case TRIGGER_TYPES.ON_BLOCK:
        // ON_BLOCK 只执行格挡者的脚本
        return entry.instanceId === triggerInfo.sourceCard?.instanceId

      case TRIGGER_TYPES.ON_KO:
        // ON_KO 只执行被KO卡的脚本
        return entry.instanceId === triggerInfo.sourceCard?.instanceId

      case TRIGGER_TYPES.TURN_END:
        // TURN_END 执行当前回合玩家的所有脚本
        return entry.playerId === triggerInfo.player?.id

      case TRIGGER_TYPES.ACTIVATE_MAIN:
        // ACTIVATE_MAIN 只执行指定卡的脚本
        return entry.instanceId === triggerInfo.sourceCard?.instanceId

      case TRIGGER_TYPES.COUNTER:
        // COUNTER 只执行使用的Counter卡的脚本
        return entry.instanceId === triggerInfo.sourceCard?.instanceId

      default:
        return false
    }
  }

  /**
   * 检查脚本的所有条件是否满足
   */
  _checkConditions(script, context, triggerInfo) {
    if (!script.conditions || script.conditions.length === 0) {
      return true
    }

    for (const condition of script.conditions) {
      if (!this._evaluateCondition(condition, context, triggerInfo)) {
        return false
      }
    }
    return true
  }

  /**
   * 评估单个条件
   */
  _evaluateCondition(condition, context, triggerInfo) {
    switch (condition.type) {
      case 'CHECK_DON': {
        // 检查源卡牌绑定的 DON 数 >= N
        const don = context.getSourceDon()
        const required = condition.amount || 0
        console.log(`[ScriptEngine] CHECK_DON: ${context.getSourceCard()?.cardNumber} has ${don} DON, need ${required}`)
        return don >= required
      }

      case 'CHECK_LIFE': {
        // 检查玩家生命值
        const life = context.getLifeCount()
        if (condition.operator === '<=') return life <= condition.amount
        if (condition.operator === '>=') return life >= condition.amount
        if (condition.operator === '<') return life < condition.amount
        if (condition.operator === '>') return life > condition.amount
        return life === condition.amount
      }

      case 'CHECK_RESTRICTION': {
        // 检查效果限制
        const restrictions = context.getEffectRestrictions()
        return !restrictions[condition.restriction]
      }

      case 'IS_MY_TURN': {
        return context.isMyTurn()
      }

      case 'IS_OPPONENT_TURN': {
        return !context.isMyTurn()
      }

      case 'CHECK_LEADER': {
        // 检查领袖是否是特定卡号
        const leader = context.getLeader()
        return leader.card.cardNumber === condition.cardNumber
      }

      default:
        console.warn(`[ScriptEngine] Unknown condition type: ${condition.type}`)
        return true
    }
  }

  /**
   * 执行脚本的所有动作
   */
  _executeActions(script, context, actions, triggerInfo) {
    if (!script.actions || script.actions.length === 0) {
      return null
    }

    const results = []
    for (const action of script.actions) {
      const result = this._executeAction(action, context, actions, triggerInfo)
      results.push(result)
    }
    return results
  }

  /**
   * 执行单个动作
   */
  _executeAction(action, context, actions, triggerInfo) {
    switch (action.type) {
      case 'ATTACH_DON': {
        // 给目标贴 DON
        const targetId = this._resolveTarget(action.target, context, triggerInfo)
        return actions.attachDon(targetId, action.count || 1, {
          state: action.donState || 'active',
        })
      }

      case 'MODIFY_POWER': {
        // 修改力量
        const targetId = this._resolveTarget(action.target, context, triggerInfo)
        const targetPlayerId = action.targetPlayer === 'opponent'
          ? context.getOpponent().id
          : context.getCurrentPlayer().id
        return actions.modifyPower(targetId, action.amount, targetPlayerId)
      }

      case 'ADD_ATTACK_STATE': {
        // 给攻击添加状态
        return actions.addAttackState(action.state, action.value ?? true)
      }

      case 'SET_RESTRICTION': {
        // 设置效果限制
        const targetPlayer = action.targetPlayer === 'opponent'
          ? context.getOpponent()
          : context.getCurrentPlayer()
        return actions.setEffectRestriction(action.restriction, action.value ?? true, targetPlayer)
      }

      case 'DRAW_CARDS': {
        return actions.drawCards(action.count || 1)
      }

      case 'LIFE_TO_HAND': {
        return actions.lifeToHand()
      }

      case 'KO_CHARACTER': {
        const targetId = this._resolveTarget(action.target, context, triggerInfo)
        const targetPlayerId = action.targetPlayer === 'opponent'
          ? context.getOpponent().id
          : context.getCurrentPlayer().id
        return actions.koCharacter(targetId, targetPlayerId)
      }

      case 'BOUNCE_TO_HAND': {
        const targetId = this._resolveTarget(action.target, context, triggerInfo)
        const targetPlayerId = action.targetPlayer === 'opponent'
          ? context.getOpponent().id
          : context.getCurrentPlayer().id
        return actions.bounceToHand(targetId, targetPlayerId)
      }

      case 'PENDING_ATTACH_DON': {
        // 设置待决效果，等待玩家选择目标
        this.engine.pendingEffect = {
          type: 'ATTACH_DON',
          count: action.count || 1,
          remaining: action.count || 1,
          donState: action.donState || 'rested',
          playerId: context.getCurrentPlayer().id,
          sourceCardNumber: context.sourceCard.cardNumber,
          sourceCardName: context.sourceCard.nameCn || context.sourceCard.name,
        }
        context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: 选择最多 ${action.count} 个目标各贴 1 DON!!`)
        return true
      }

      case 'PENDING_SEARCH': {
        // 检索效果：查看牌库顶部N张，选择符合条件的卡加入手牌
        const player = context.getCurrentPlayer()
        const count = action.count || 5
        const actual = Math.min(count, player.deck.length)
        
        // 获取顶部卡牌 (deck末尾是顶部)
        const topCards = player.deck.slice(-actual).reverse()
        
        // 设置待决效果
        this.engine.pendingEffect = {
          type: 'SEARCH',
          cards: topCards.map(c => this.engine._sanitizeCard(c)),
          viewedCount: actual,
          maxSelect: action.maxSelect || 1,
          filter: action.filter || {},
          playerId: player.id,
          sourceCardNumber: context.sourceCard.cardNumber,
          sourceCardName: context.sourceCard.nameCn || context.sourceCard.name,
        }
        
        context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: ${action.message || `检索顶部${actual}张`}`)
        return { needsInteraction: true, type: 'SEARCH' }
      }

      case 'PENDING_SELECT_TARGET': {
        // 等待玩家选择目标 (用于Buff/Debuff/KO等)
        const validTargets = this._collectValidTargets(action, context)
        
        this.engine.pendingEffect = {
          type: 'SELECT_TARGET',
          validTargets,
          maxSelect: action.maxSelect || 1,
          message: action.message,
          onSelectActions: action.onSelect || [],  // 选中后要执行的动作
          playerId: context.getCurrentPlayer().id,
          sourceCardNumber: context.sourceCard.cardNumber,
          sourceCardName: context.sourceCard.nameCn || context.sourceCard.name,
        }
        
        context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: ${action.message}`)
        return { needsInteraction: true, type: 'SELECT_TARGET' }
      }

      case 'CONDITIONAL_ACTION': {
        // 条件满足时执行子动作
        if (this._evaluateCondition(action.condition, context, triggerInfo)) {
          for (const subAction of action.actions || []) {
            this._executeAction(subAction, context, actions, triggerInfo)
          }
          return true
        }
        return false
      }

      case 'LOG': {
        context.log(action.message)
        return true
      }

      default:
        console.warn(`[ScriptEngine] Unknown action type: ${action.type}`)
        return null
    }
  }

  /**
   * 解析目标引用
   */
  _resolveTarget(target, context, triggerInfo) {
    if (!target) return null

    switch (target) {
      case 'SELF':
        return context.sourceCard?.instanceId
      case 'LEADER':
        return 'leader'
      case 'ATTACKER':
        return triggerInfo.extra?.attackerId
      case 'TARGET':
        return triggerInfo.extra?.targetId
      case 'SELECTED':
        // 引用刚被选中的目标
        return context.selectedTargets?.[0]
      case 'BATTLE_TARGET':
        // 战斗中被攻击的目标
        return this.engine.pendingAttack?.targetId
      default:
        // 直接返回 instanceId
        return target
    }
  }

  /**
   * 收集有效的选择目标
   */
  _collectValidTargets(action, context) {
    const targets = []
    const player = context.getCurrentPlayer()
    const opponent = context.getOpponent()
    const scope = action.targetScope || 'player'  // 'player' | 'opponent' | 'both'
    const types = action.targetTypes || ['character']  // ['leader', 'character']

    const collectFromPlayer = (p, isOwn) => {
      // 领袖
      if (types.includes('leader')) {
        targets.push({
          instanceId: p.leader.card.instanceId,
          type: 'leader',
          playerId: p.id,
          isOwn,
          card: this.engine._sanitizeCard(p.leader.card),
        })
      }
      // 角色
      if (types.includes('character')) {
        for (const slot of p.characters) {
          targets.push({
            instanceId: slot.card.instanceId,
            type: 'character',
            playerId: p.id,
            isOwn,
            card: this.engine._sanitizeCard(slot.card),
          })
        }
      }
    }

    if (scope === 'player' || scope === 'both') {
      collectFromPlayer(player, true)
    }
    if (scope === 'opponent' || scope === 'both') {
      collectFromPlayer(opponent, false)
    }

    return targets
  }

  /**
   * 执行目标选择后的动作序列
   * @param {string[]} selectedInstanceIds - 被选中的目标实例ID数组
   * @param {object} pendingEffect - 待决效果信息
   */
  executeOnSelectActions(selectedInstanceIds, pendingEffect) {
    if (!pendingEffect?.onSelectActions?.length) return []

    // 找到触发卡牌的玩家
    const player = this.engine.players.find(p => p.id === pendingEffect.playerId)
    const opponent = this.engine.players.find(p => p.id !== pendingEffect.playerId)

    // 重建 context，加入选中的目标
    const context = new ScriptContext(this.engine, {
      triggerType: 'COUNTER',
      sourceCard: { 
        cardNumber: pendingEffect.sourceCardNumber, 
        nameCn: pendingEffect.sourceCardName,
        name: pendingEffect.sourceCardName,
      },
      sourceSlot: null,
      player,
      opponent,
    })
    context.selectedTargets = selectedInstanceIds

    const actions = new ActionDSL(context)
    const results = []

    for (const action of pendingEffect.onSelectActions) {
      const result = this._executeAction(action, context, actions, {})
      results.push(result)
    }

    return results
  }

  /** 清理所有状态 */
  reset() {
    this.triggerSystem.clear()
  }
}
