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
    // TRIGGER 类型特殊处理：生命牌不注册到 TriggerSystem，直接从 CARD_SCRIPTS 获取
    if (triggerType === TRIGGER_TYPES.TRIGGER) {
      return this._executeTriggerEffect(triggerInfo)
    }

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

  /**
   * 执行生命牌的 TRIGGER 效果
   * 生命牌不注册到 TriggerSystem，需要直接从 CARD_SCRIPTS 获取脚本
   * @param {object} triggerInfo - { sourceCard, player, opponent }
   * @returns {Array}
   */
  _executeTriggerEffect(triggerInfo) {
    const card = triggerInfo.sourceCard
    if (!card?.cardNumber) {
      console.log('[ScriptEngine] _executeTriggerEffect: No card number')
      return []
    }

    const scriptDef = CARD_SCRIPTS[card.cardNumber]
    if (!scriptDef) {
      console.log(`[ScriptEngine] _executeTriggerEffect: No script for ${card.cardNumber}`)
      return []
    }

    // 找到 TRIGGER 类型的脚本
    const triggers = Array.isArray(scriptDef) ? scriptDef : [scriptDef]
    const triggerScript = triggers.find(t => t.triggerType === TRIGGER_TYPES.TRIGGER)
    
    if (!triggerScript) {
      console.log(`[ScriptEngine] _executeTriggerEffect: No TRIGGER script for ${card.cardNumber}`)
      return []
    }

    console.log(`[ScriptEngine] _executeTriggerEffect: Executing TRIGGER for ${card.cardNumber}`)

    const context = new ScriptContext(this.engine, {
      triggerType: TRIGGER_TYPES.TRIGGER,
      sourceCard: card,
      sourceSlot: null,  // 生命牌没有 slot
      player: triggerInfo.player,
      opponent: triggerInfo.opponent,
    })

    const actions = new ActionDSL(context)
    const results = []

    try {
      // 检查条件
      if (!this._checkConditions(triggerScript, context, triggerInfo)) {
        results.push({ cardNumber: card.cardNumber, executed: false, reason: 'conditions_not_met' })
        return results
      }

      // 执行动作
      const result = this._executeActions(triggerScript, context, actions, triggerInfo)
      results.push({ cardNumber: card.cardNumber, executed: true, result })
    } catch (error) {
      console.error(`[ScriptEngine] Error executing TRIGGER ${card.cardNumber}:`, error)
      results.push({ cardNumber: card.cardNumber, executed: false, reason: 'error', error: error.message })
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
   * 检查卡牌对象是否有指定触发类型的脚本
   * @param {object} card - 卡牌对象
   * @param {string} triggerType - 触发类型
   * @returns {boolean}
   */
  hasScriptTrigger(card, triggerType) {
    if (!card?.cardNumber) return false
    return this.hasScript(card.cardNumber, triggerType)
  }

  /**
   * 检查卡牌本回合是否可以发动 ACTIVATE_MAIN 效果
   * 考虑一回合一次的限制
   * @param {object} card - 卡牌对象
   * @param {object} player - 玩家对象
   * @returns {boolean}
   */
  canActivateMain(card, player) {
    if (!card?.cardNumber) return false
    const scriptDef = CARD_SCRIPTS[card.cardNumber]
    if (!scriptDef) return false

    const triggers = Array.isArray(scriptDef) ? scriptDef : [scriptDef]
    const activateMainScript = triggers.find(t => t.triggerType === 'ACTIVATE_MAIN')
    if (!activateMainScript) return false

    // 检查是否有一回合一次的限制
    const conditions = activateMainScript.conditions || []
    for (const cond of conditions) {
      if (cond.type === 'CHECK_ONCE_PER_TURN') {
        // 检查本回合是否已使用
        const used = player.usedOncePerTurn?.[cond.key]
        if (used) return false
      }
    }

    return true
  }

  /**
   * 判断是否应该执行此脚本
   */
  _shouldExecute(triggerType, entry, triggerInfo) {
    console.log(`[ScriptEngine] _shouldExecute: type=${triggerType}, entryCard=${entry.cardNumber}, entryInstance=${entry.instanceId}, sourceInstance=${triggerInfo.sourceCard?.instanceId}`)
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

      case TRIGGER_TYPES.TRIGGER:
        // TRIGGER 执行生命牌翻开时的触发效果（生命区被翻开的卡）
        // 注意: 执行前不需要注册，因为生命牌不在场上
        // 这里检查卡号是否匹配（因为生命牌没有注册过）
        return entry.cardNumber === triggerInfo.sourceCard?.cardNumber

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

      case 'CHECK_RESTED_DON': {
        // 检查玩家的休息DON数量是否 >= minAmount
        const player = context.getCurrentPlayer()
        const restedDon = player.donRested || 0
        const required = condition.minAmount || 1
        console.log(`[ScriptEngine] CHECK_RESTED_DON: player has ${restedDon} rested DON, need ${required}`)
        return restedDon >= required
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
        const isOpponent = !context.isMyTurn()
        console.log(`[ScriptEngine] IS_OPPONENT_TURN check: isMyTurn=${context.isMyTurn()}, result=${isOpponent}`)
        return isOpponent
      }

      case 'CHECK_LEADER': {
        // 检查领袖是否是特定卡号
        const leader = context.getLeader()
        return leader.card.cardNumber === condition.cardNumber
      }

      case 'CHECK_LEADER_TRAIT': {
        // 检查领袖是否具有特定特征
        const leader = context.getLeader()
        console.log(`[ScriptEngine] CHECK_LEADER_TRAIT debug: leader=`, JSON.stringify(leader?.card?.cardNumber), 'traitCn=', leader?.card?.traitCn, 'trait=', leader?.card?.trait)
        // 优先使用中文特征，特征可能有多个用/分隔
        const traits = (leader.card.traitCn || leader.card.trait || '').split('/')
        const result = traits.some(t => t.trim() === condition.trait)
        console.log(`[ScriptEngine] CHECK_LEADER_TRAIT: leader traits='${leader.card.traitCn || leader.card.trait}', need='${condition.trait}', result=${result}`)
        return result
      }

      case 'CHECK_OPPONENT_LIFE': {
        // 检查对手生命值
        const life = context.getOpponent().life.length
        if (condition.operator === '<=') return life <= condition.amount
        if (condition.operator === '>=') return life >= condition.amount
        if (condition.operator === '<') return life < condition.amount
        if (condition.operator === '>') return life > condition.amount
        return life === condition.amount
      }

      case 'SELF_ACTIVE': {
        // 检查自身是否处于活跃状态
        const slot = context.getSourceSlot()
        // 角色缺省就是活跃，只有休息状态才不行
        return slot?.state !== 'RESTED'
      }

      case 'CHECK_ONCE_PER_TURN': {
        // 检查是否已使用过此回合一次的效果
        const key = condition.key
        const player = context.getCurrentPlayer()
        const used = player.usedOncePerTurn?.[key]
        return !used  // 未使用返回true，已使用返回false
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
        
        // 支持多目标 (ALL_SELECTED)
        if (Array.isArray(targetId)) {
          for (const tid of targetId) {
            actions.modifyPower(tid, action.amount, targetPlayerId)
            // 注册带过期的效果
            if (action.expiry) {
              this.engine.registerEffect({
                type: 'POWER_MOD',
                targetId: tid,
                amount: action.amount,
                expiry: action.expiry,
                sourceName: context.sourceCard?.nameCn || context.sourceCard?.name,
              })
            }
          }
          return true
        }
        const result = actions.modifyPower(targetId, action.amount, targetPlayerId)
        // 注册带过期的效果
        if (action.expiry && targetId) {
          this.engine.registerEffect({
            type: 'POWER_MOD',
            targetId: targetId,
            amount: action.amount,
            expiry: action.expiry,
            sourceName: context.sourceCard?.nameCn || context.sourceCard?.name,
          })
        }
        return result
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
        // 收集可贴DON的目标（己方领袖和角色）
        const attachTargets = this._collectValidTargets({
          targetScope: action.targetScope || 'player',
          targetTypes: action.targetTypes || ['leader', 'character'],
        }, context)

        // 检查可用的休息DON数量
        const player = context.getCurrentPlayer()
        const availableRestedDon = player.donRested || 0
        const donToAttach = Math.min(action.donCount || action.count || 1, availableRestedDon)
        
        if (donToAttach === 0) {
          context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: 没有可用的休息DON`)
          return { needsInteraction: false }
        }

        // 设置待决效果，等待玩家选择目标
        this.engine.pendingEffect = {
          type: 'ATTACH_DON',
          validTargets: attachTargets,
          donCount: donToAttach,  // 要贴的DON数量
          maxSelect: action.maxSelect || 1,  // 可选择的目标数量
          donState: action.donState || 'rested',
          message: action.message || `选择目标贴附 ${donToAttach} 个 DON!!`,
          playerId: context.getCurrentPlayer().id,
          sourceCardNumber: context.sourceCard.cardNumber,
          sourceCardName: context.sourceCard.nameCn || context.sourceCard.name,
        }
        console.log(`[ScriptEngine] PENDING_ATTACH_DON set:`, this.engine.pendingEffect)
        context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: ${this.engine.pendingEffect.message}`)
        return { needsInteraction: true, type: 'ATTACH_DON' }
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

      case 'PENDING_KO_TARGET': {
        // 等待玩家选择要 KO 的目标 (需满足 filter 条件)
        const validTargets = this._collectValidTargets(action, context)
          .filter(t => {
            if (!action.filter) return true
            // 检查 maxPower
            if (action.filter.maxPower !== undefined) {
              const power = this._calculateTargetPower(t)
              if (power > action.filter.maxPower) return false
            }
            // 检查 maxCost
            if (action.filter.maxCost !== undefined) {
              const cost = parseInt(t.card?.cost ?? t.card?.costCn ?? 999, 10)
              if (cost > action.filter.maxCost) return false
            }
            // 检查 hasKeyword (如阻挡者)
            if (action.filter.hasKeyword) {
              const keywords = t.card?.keywords || t.card?.keywordsCn || ''
              const hasKw = keywords.includes(action.filter.hasKeyword) || 
                            keywords.includes('Blocker') || 
                            keywords.includes('阻挡者')
              if (!hasKw) return false
            }
            return true
          })

        if (validTargets.length === 0) {
          context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: 场上没有符合条件的目标`)
          return { needsInteraction: false }
        }

        this.engine.pendingEffect = {
          type: 'KO_TARGET',
          validTargets,
          maxSelect: action.maxSelect || 1,
          message: action.message,
          optional: action.optional ?? false,
          filter: action.filter || {},
          playerId: context.getCurrentPlayer().id,
          sourceCardNumber: context.sourceCard.cardNumber,
          sourceCardName: context.sourceCard.nameCn || context.sourceCard.name,
        }

        context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: ${action.message}`)
        return { needsInteraction: true, type: 'KO_TARGET' }
      }

      case 'GRANT_KEYWORD': {
        // 给目标赋予关键词（速攻/阻挡者等）
        const targetId = this._resolveTarget(action.target, context, triggerInfo)
        const player = context.getCurrentPlayer()
        
        // 找到目标 slot
        let slot = null
        if (targetId === 'leader' || player.leader.card.instanceId === targetId) {
          slot = player.leader
        } else {
          slot = context.findCharacterSlot(targetId, player)
        }

        if (slot) {
          slot.tempKeywords = slot.tempKeywords || []
          if (!slot.tempKeywords.includes(action.keyword)) {
            slot.tempKeywords.push(action.keyword)
          }
          context.log(`获得【${action.keyword}】`)
        }
        return true
      }

      case 'REST_SELF': {
        // 将自身转为休息状态
        const slot = context.getSourceSlot()
        if (slot) {
          slot.state = 'RESTED'
          context.log(`${context.sourceCard.nameCn || context.sourceCard.name} 转为休息状态`)
        }
        return true
      }

      case 'PENDING_DISCARD_EVENT': {
        // 丢弃事件效果（需玩家从手牌中弃1张事件）
        const player = context.getCurrentPlayer()
        const events = player.hand.filter(c => c.cardType === 'EVENT')
        
        if (events.length === 0) {
          context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: 手牌中没有事件卡`)
          return { needsInteraction: false }
        }

        this.engine.pendingEffect = {
          type: 'DISCARD_EVENT',
          validCards: events.map(c => this.engine._sanitizeCard(c)),
          count: action.count || 1,
          message: action.message,
          optional: action.optional ?? true,
          onDiscardActions: action.onDiscard || [],
          playerId: player.id,
          sourceCardNumber: context.sourceCard?.cardNumber,
          sourceCardName: context.sourceCard?.nameCn || context.sourceCard?.name,
        }

        context.log(`${context.sourceCard.nameCn || context.sourceCard.name}: ${action.message}`)
        return { needsInteraction: true, type: 'DISCARD_EVENT' }
      }

      case 'REVIVE_SELF': {
        // 从墓地复活自身（马尔高等卡使用）
        const player = context.getCurrentPlayer()
        const cardNumber = context.sourceCard?.cardNumber
        
        // 在墓地中找到自己
        const idx = player.trash.findIndex(c => c.cardNumber === cardNumber)
        if (idx === -1) {
          context.log(`复活失败: 墓地中找不到 ${cardNumber}`)
          return false
        }

        const [card] = player.trash.splice(idx, 1)
        
        // 登场到场上（休息状态）
        const newSlot = {
          card,
          attachedDon: 0,
          state: action.state === 'RESTED' ? 'RESTED' : 'ACTIVE',
        }
        player.characters.push(newSlot)
        
        // 重新注册脚本
        this.registerCard(card, card.instanceId, player.id)

        context.log(`${card.nameCn || card.name} 从墓地复活!`)
        return true
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

      case 'SET_ONCE_PER_TURN': {
        // 设置每回合一次标记
        const key = action.key
        const player = context.getCurrentPlayer()
        player.usedOncePerTurn = player.usedOncePerTurn || {}
        player.usedOncePerTurn[key] = true
        return true
      }

      case 'PENDING_PLAY_FROM_HAND': {
        // 从手牌中选择一张角色登场
        const player = context.getCurrentPlayer()
        const validCards = player.hand.filter(c => {
          if (action.filter?.cardType === 'CHARACTER' && c.cardType !== 'CHARACTER') {
            return false
          }
          if (action.filter?.maxPower !== undefined) {
            const power = c.power || 0
            if (power > action.filter.maxPower) return false
          }
          if (action.filter?.trait) {
            const traits = (c.traitCn || c.trait || '').split('/')
            if (!traits.some(t => t.trim() === action.filter.trait)) return false
          }
          return true
        })

        if (validCards.length === 0) {
          context.log(`手牌中没有符合条件的角色`)
          return { needsInteraction: false }
        }

        this.engine.pendingEffect = {
          type: 'PLAY_FROM_HAND',
          validCards: validCards.map(c => this.engine._sanitizeCard(c)),
          maxSelect: action.maxSelect || 1,
          optional: action.optional ?? false,
          filter: action.filter || {},
          message: action.message,
          playerId: player.id,
          sourceCardNumber: context.sourceCard?.cardNumber,
          sourceCardName: context.sourceCard?.nameCn || context.sourceCard?.name,
        }

        context.log(`${context.sourceCard?.nameCn || context.sourceCard?.name}: ${action.message}`)
        return { needsInteraction: true, type: 'PLAY_FROM_HAND' }
      }

      case 'PENDING_SEARCH_PLAY': {
        // 检索后直接登场角色
        const player = context.getCurrentPlayer()
        const viewCount = action.viewCount || 5
        const actual = Math.min(viewCount, player.deck.length)
        
        if (actual === 0) {
          context.log(`牌库为空`)
          return { needsInteraction: false }
        }

        const topCards = player.deck.slice(-actual).reverse()
        
        // 过滤符合条件的卡
        const validCards = topCards.filter(c => {
          if (action.filter?.cardType === 'CHARACTER' && c.cardType !== 'CHARACTER') {
            return false
          }
          if (action.filter?.maxPower !== undefined) {
            const power = c.power || 0
            if (power > action.filter.maxPower) return false
          }
          if (action.filter?.maxCost !== undefined) {
            const cost = c.cost || 0
            if (cost > action.filter.maxCost) return false
          }
          if (action.filter?.trait) {
            const traits = (c.traitCn || c.trait || '').split('/')
            if (!traits.some(t => t.trim() === action.filter.trait)) return false
          }
          return true
        })

        this.engine.pendingEffect = {
          type: 'SEARCH_PLAY',
          allCards: topCards.map(c => this.engine._sanitizeCard(c)),
          validCards: validCards.map(c => this.engine._sanitizeCard(c)),
          viewedCount: actual,
          maxSelect: action.maxSelect || 1,
          optional: action.optional ?? true,
          filter: action.filter || {},
          playState: action.playState || 'ACTIVE',
          message: action.message,
          playerId: player.id,
          sourceCardNumber: context.sourceCard?.cardNumber,
          sourceCardName: context.sourceCard?.nameCn || context.sourceCard?.name,
        }

        context.log(`${context.sourceCard?.nameCn || context.sourceCard?.name}: ${action.message}`)
        return { needsInteraction: true, type: 'SEARCH_PLAY' }
      }

      case 'ADD_FIELD_STATE': {
        // 给场上单位添加状态 (如 cannotBeBlocked)
        const targetId = this._resolveTarget(action.target, context, triggerInfo)
        const player = context.getCurrentPlayer()
        
        // 找到目标 slot
        let slot = null
        if (targetId === 'leader' || player.leader.card.instanceId === targetId) {
          slot = player.leader
        } else {
          slot = context.findCharacterSlot(targetId, player) || 
                 context.findCharacterSlot(targetId, context.getOpponent())
        }

        if (slot) {
          slot.fieldStates = slot.fieldStates || {}
          slot.fieldStates[action.state] = action.value ?? true
          if (action.expiry === 'END_OF_TURN') {
            slot.fieldStates[`${action.state}_expiry`] = 'END_OF_TURN'
          }
          context.log(`添加状态: ${action.state}`)
        }
        return true
      }

      case 'PENDING_DISCARD': {
        // 丢弃手牌效果
        const player = context.getCurrentPlayer()
        
        if (player.hand.length === 0) {
          context.log(`手牌为空，无法丢弃`)
          return { needsInteraction: false }
        }

        this.engine.pendingEffect = {
          type: 'DISCARD',
          validCards: player.hand.map(c => this.engine._sanitizeCard(c)),
          count: action.count || 1,
          optional: action.optional ?? false,
          message: action.message,
          onDiscardActions: action.onDiscard || [],
          playerId: player.id,
          sourceCardNumber: context.sourceCard?.cardNumber,
          sourceCardName: context.sourceCard?.nameCn || context.sourceCard?.name,
        }

        context.log(`${context.sourceCard?.nameCn || context.sourceCard?.name}: ${action.message}`)
        return { needsInteraction: true, type: 'DISCARD' }
      }

      case 'PENDING_RECOVER_FROM_TRASH': {
        // 从废弃区回收卡牌到手牌
        const player = context.getCurrentPlayer()
        const filter = action.filter || {}

        // 过滤废弃区中符合条件的卡
        const validCards = player.trash.filter(c => {
          if (filter.cardType && c.cardType !== filter.cardType) {
            return false
          }
          if (filter.maxCost !== undefined) {
            const cost = parseInt(c.cost || 0, 10)
            if (cost > filter.maxCost) return false
          }
          if (filter.trait) {
            const traits = (c.traitCn || c.trait || '').split('/')
            if (!traits.some(t => t.trim() === filter.trait)) return false
          }
          if (filter.excludeCardNumber && c.cardNumber === filter.excludeCardNumber) {
            return false
          }
          return true
        })

        if (validCards.length === 0) {
          context.log(`废弃区没有符合条件的卡牌`)
          return { needsInteraction: false }
        }

        this.engine.pendingEffect = {
          type: 'RECOVER_FROM_TRASH',
          validCards: validCards.map(c => this.engine._sanitizeCard(c)),
          maxSelect: action.maxSelect || 1,
          optional: action.optional ?? false,
          message: action.message,
          filter: filter,
          playerId: player.id,
          sourceCardNumber: context.sourceCard?.cardNumber,
          sourceCardName: context.sourceCard?.nameCn || context.sourceCard?.name,
        }

        context.log(`${context.sourceCard?.nameCn || context.sourceCard?.name}: ${action.message}`)
        return { needsInteraction: true, type: 'RECOVER_FROM_TRASH' }
      }

      default:
        console.warn(`[ScriptEngine] Unknown action type: ${action.type}`)
        return null
    }
  }

  /**
   * 计算目标的实际力量
   * @param {object} target - { instanceId, playerId, card }
   */
  _calculateTargetPower(target) {
    const player = this.engine.players.find(p => p.id === target.playerId)
    if (!player) return 0

    let card = target.card
    let slot = null

    if (target.type === 'leader') {
      slot = player.leader
      card = slot.card
    } else {
      slot = player.characters.find(c => c.card.instanceId === target.instanceId)
      if (slot) card = slot.card
    }

    if (!card) return 0
    return this.engine._calculatePower(card, slot, player)
  }

  /**
   * 获取卡牌的动态力量加成（CONSTANT 类型的 dynamicPower）
   * @param {object} card - 卡牌数据
   * @param {object} slot - 卡牌 slot
   * @param {object} ownerPlayer - 卡牌所属玩家
   * @returns {number} 动态力量加成
   */
  getDynamicPower(card, slot, ownerPlayer) {
    const scriptDef = this._getScriptDefinition(card)
    if (!scriptDef) return 0

    const triggers = Array.isArray(scriptDef) ? scriptDef : [scriptDef]
    let totalBonus = 0

    for (const trigger of triggers) {
      // 只处理 CONSTANT 类型的 dynamicPower
      if (trigger.triggerType !== 'CONSTANT' || !trigger.dynamicPower) continue

      const { amount, conditions } = trigger.dynamicPower
      if (!amount || !conditions) continue

      // 检查所有条件
      const opponent = this.engine.players.find(p => p.id !== ownerPlayer.id)
      const context = new ScriptContext(this.engine, {
        triggerType: 'CONSTANT',
        sourceCard: card,
        sourceSlot: slot,
        player: ownerPlayer,
        opponent,
      })

      let allConditionsMet = true
      for (const condition of conditions) {
        const result = this._evaluateCondition(condition, context, {})
        console.log(`[getDynamicPower] ${card.cardNumber} condition ${condition.type}: ${result}`)
        if (!result) {
          allConditionsMet = false
          break
        }
      }

      if (allConditionsMet) {
        console.log(`[getDynamicPower] ${card.cardNumber} bonus: +${amount}`)
        totalBonus += amount
      }
    }

    return totalBonus
  }

  /**
   * 检查卡牌是否有动态关键词（通过脚本条件获得）
   * 例如 OP02-008: [Don!! x1] 生命<=2 且领袖是白胡子海盗团时获得【速攻】
   * @param {object} card - 卡牌数据
   * @param {object} slot - 卡槽信息（包含 attachedDon 等）
   * @param {object} ownerPlayer - 卡牌所属玩家
   * @param {string} keyword - 要检查的关键词
   * @returns {boolean} 是否有该动态关键词
   */
  /**
   * 检查卡牌是否有条件关键词的定义（不检查条件是否满足）
   * 用于判断卡牌的关键词是条件获得还是固有的
   */
  hasConditionalKeyword(card, keyword) {
    const scriptDef = this._getScriptDefinition(card)
    if (!scriptDef) return false

    const triggers = Array.isArray(scriptDef) ? scriptDef : [scriptDef]
    for (const trigger of triggers) {
      if (trigger.triggerType !== 'CONSTANT' || !trigger.dynamicKeywords) continue
      for (const dynKw of trigger.dynamicKeywords) {
        if (dynKw.keyword?.toLowerCase() === keyword?.toLowerCase()) {
          return true
        }
      }
    }
    return false
  }

  hasDynamicKeyword(card, slot, ownerPlayer, keyword) {
    const scriptDef = this._getScriptDefinition(card)
    if (!scriptDef) return false

    const triggers = Array.isArray(scriptDef) ? scriptDef : [scriptDef]

    for (const trigger of triggers) {
      // 只处理 CONSTANT 类型的 dynamicKeywords
      if (trigger.triggerType !== 'CONSTANT' || !trigger.dynamicKeywords) continue

      for (const dynKw of trigger.dynamicKeywords) {
        // 检查是否是要找的关键词
        if (dynKw.keyword?.toLowerCase() !== keyword?.toLowerCase()) continue

        const conditions = dynKw.conditions || []
        if (conditions.length === 0) {
          // 无条件获得该关键词
          return true
        }

        // 检查所有条件
        const opponent = this.engine.players.find(p => p.id !== ownerPlayer.id)
        const context = new ScriptContext(this.engine, {
          triggerType: 'CONSTANT',
          sourceCard: card,
          sourceSlot: slot,
          player: ownerPlayer,
          opponent,
        })

        let allConditionsMet = true
        for (const condition of conditions) {
          const result = this._evaluateCondition(condition, context, {})
          console.log(`[hasDynamicKeyword] ${card.cardNumber} ${keyword} condition ${condition.type}: ${result}`)
          if (!result) {
            allConditionsMet = false
            break
          }
        }

        if (allConditionsMet) {
          console.log(`[hasDynamicKeyword] ${card.cardNumber} has dynamic keyword: ${keyword}`)
          return true
        }
      }
    }

    return false
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
      case 'ALL_SELECTED':
        // 引用所有被选中的目标
        return context.selectedTargets
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

  /**
   * 执行丢弃手牌后的动作序列
   * @param {object[]} onDiscardActions - 丢弃后要执行的动作
   * @param {object} sourceInfo - 效果来源信息
   * @param {object} player - 玩家
   * @param {object} opponent - 对手
   * @param {object[]} discardedCards - 被丢弃的卡牌
   */
  executeOnDiscardActions(onDiscardActions, sourceInfo, player, opponent, discardedCards) {
    if (!onDiscardActions?.length) return []

    const context = new ScriptContext(this.engine, {
      triggerType: 'ON_ATTACK', // 通常是攻击时触发
      sourceCard: { 
        cardNumber: sourceInfo.sourceCardNumber, 
        nameCn: sourceInfo.sourceCardName,
        name: sourceInfo.sourceCardName,
      },
      sourceSlot: null,
      player,
      opponent,
    })
    context.discardedCards = discardedCards

    const actions = new ActionDSL(context)
    const results = []

    for (const action of onDiscardActions) {
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
