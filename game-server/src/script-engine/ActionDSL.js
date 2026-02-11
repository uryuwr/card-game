/**
 * ActionDSL - 原子动作库
 * 提供脚本可调用的所有原子操作
 * 每个 action 接收 ScriptContext 并执行具体的引擎操作
 */

import { CARD_STATES } from '../../../shared/constants.js'

export class ActionDSL {
  /**
   * @param {import('./ScriptContext.js').ScriptContext} context
   */
  constructor(context) {
    this.context = context
  }

  // =====================
  // DON 操作
  // =====================

  /**
   * 检查是否有足够的 DON 支付费用
   * @param {number} cost - 需要的费用
   * @returns {boolean}
   */
  canPayCost(cost) {
    return this.context.getCurrentPlayer().donActive >= cost
  }

  /**
   * 支付 DON 费用 (从活跃变为休息)
   * @param {number} cost - 需要的费用
   * @returns {boolean} 是否支付成功
   */
  payCost(cost) {
    const player = this.context.getCurrentPlayer()
    if (player.donActive < cost) {
      this.context.log(`费用不足: 需要 ${cost} DON (当前 ${player.donActive})`)
      return false
    }
    
    player.donActive -= cost
    player.donRested += cost
    this.context.log(`支付 ${cost} DON`)
    return true
  }

  /**
   * 给目标贴 DON
   * @param {string} targetInstanceId - 目标卡牌实例ID
   * @param {number} count - DON 数量
   * @param {object} options - { state: 'rested'|'active', from: 'pool' }
   */
  attachDon(targetInstanceId, count = 1, options = {}) {
    const player = this.context.getCurrentPlayer()
    const donState = options.state || 'active'

    // 找到目标 slot
    let targetSlot = null
    if (targetInstanceId === 'leader' || player.leader.card.instanceId === targetInstanceId) {
      targetSlot = player.leader
    } else {
      targetSlot = this.context.findCharacterSlot(targetInstanceId, player)
    }

    if (!targetSlot) {
      this.context.log(`attachDon 失败: 找不到目标 ${targetInstanceId}`)
      return false
    }

    // 从休息 DON 池分配
    const available = player.donRested
    const actual = Math.min(count, available)
    if (actual <= 0) {
      this.context.log(`attachDon 失败: 没有可用的休息 DON`)
      return false
    }

    player.donRested -= actual
    targetSlot.attachedDon += actual

    this.context.log(`${this.context.sourceCard.nameCn || this.context.sourceCard.name}: 给 ${targetSlot.card.nameCn || targetSlot.card.name} 贴 ${actual} DON!!`)
    return true
  }

  // =====================
  // 力量修改
  // =====================

  /**
   * 修改目标力量
   * @param {string} targetInstanceId
   * @param {number} amount - 正数为加, 负数为减
   * @param {string} targetPlayerId - 目标所属玩家 (默认己方)
   */
  modifyPower(targetInstanceId, amount, targetPlayerId = null) {
    const engine = this.context.engine
    const pendingAttack = engine.pendingAttack

    // 查找目标所属的玩家
    let targetPlayer = targetPlayerId
      ? engine.players.find(p => p.id === targetPlayerId)
      : this.context.getCurrentPlayer()

    // 辅助函数：检查是否是战斗目标
    const isBattleTarget = (instanceId) => {
      if (!pendingAttack) return false
      // 支持 targetId='leader' 或 targetInstanceId 匹配
      return pendingAttack.targetId === instanceId || 
             pendingAttack.targetInstanceId === instanceId
    }
    
    // 辅助函数：追踪力量修改（用于撤销）
    const trackPowerMod = (targetId, amt) => {
      if (engine._trackingPowerMods) {
        engine._trackingPowerMods.push({ targetId, amount: amt })
      }
    }

    // 如果 target 是 'leader' 字符串，用当前玩家的领袖
    if (targetInstanceId === 'leader') {
      if (!targetPlayer) return false
      const leaderInstanceId = targetPlayer.leader.card.instanceId
      targetPlayer.powerMods = targetPlayer.powerMods || new Map()
      const current = targetPlayer.powerMods.get(leaderInstanceId) || 0
      targetPlayer.powerMods.set(leaderInstanceId, current + amount)
      trackPowerMod(leaderInstanceId, amount)
      this.context.log(`领袖力量 ${amount > 0 ? '+' : ''}${amount}`)
      
      // 如果正在战斗中，且修改的目标就是被攻击的单位，更新 targetPower
      if (isBattleTarget(leaderInstanceId) || isBattleTarget('leader')) {
        pendingAttack.targetPower += amount
        engine.pendingCounterPower += amount
        this.context.log(`(战斗力量更新: ${pendingAttack.targetPower})`)
      }
      return true
    }

    // 检查 targetInstanceId 是否是某个玩家的领袖
    for (const player of engine.players) {
      if (player.leader.card.instanceId === targetInstanceId) {
        player.powerMods = player.powerMods || new Map()
        const current = player.powerMods.get(targetInstanceId) || 0
        player.powerMods.set(targetInstanceId, current + amount)
        trackPowerMod(targetInstanceId, amount)
        this.context.log(`${player.leader.card.nameCn || player.leader.card.name} 力量 ${amount > 0 ? '+' : ''}${amount}`)
        
        // 如果正在战斗中，且修改的目标就是被攻击的单位，更新 targetPower
        if (isBattleTarget(targetInstanceId) || isBattleTarget('leader')) {
          pendingAttack.targetPower += amount
          engine.pendingCounterPower += amount
          this.context.log(`(战斗力量更新: ${pendingAttack.targetPower})`)
        }
        return true
      }
    }

    // 否则查找角色
    if (!targetPlayer) return false
    
    const slot = this.context.findCharacterSlot(targetInstanceId, targetPlayer)
    if (!slot) {
      // 尝试在对手那边找
      const opponent = this.context.getOpponent()
      const opponentSlot = this.context.findCharacterSlot(targetInstanceId, opponent)
      if (opponentSlot) {
        targetPlayer = opponent
      } else {
        return false
      }
    }

    targetPlayer.powerMods = targetPlayer.powerMods || new Map()
    const current = targetPlayer.powerMods.get(targetInstanceId) || 0
    targetPlayer.powerMods.set(targetInstanceId, current + amount)
    trackPowerMod(targetInstanceId, amount)

    const finalSlot = this.context.findCharacterSlot(targetInstanceId, targetPlayer)
    this.context.log(`${finalSlot.card.nameCn || finalSlot.card.name} 力量 ${amount > 0 ? '+' : ''}${amount}`)
    
    // 如果正在战斗中，且修改的目标就是被攻击的单位，更新 targetPower
    if (isBattleTarget(targetInstanceId)) {
      pendingAttack.targetPower += amount
      engine.pendingCounterPower += amount
      this.context.log(`(战斗力量更新: ${pendingAttack.targetPower})`)
    }
    return true
  }

  // =====================
  // 状态操作
  // =====================

  /**
   * 给攻击添加状态 (如 ignoreBlocker)
   * @param {string} stateName
   * @param {*} value
   */
  addAttackState(stateName, value = true) {
    const attack = this.context.getPendingAttack()
    if (!attack) {
      this.context.log(`addAttackState 失败: 没有进行中的攻击`)
      return false
    }
    attack[stateName] = value
    this.context.log(`攻击状态: ${stateName} = ${value}`)
    return true
  }

  /**
   * 给玩家添加效果限制
   * @param {string} restriction
   * @param {*} value
   * @param {object} player - 默认己方
   */
  setEffectRestriction(restriction, value = true, player = null) {
    const p = player || this.context.getCurrentPlayer()
    p.effectRestrictions = p.effectRestrictions || {}
    p.effectRestrictions[restriction] = value
    this.context.log(`效果限制: ${restriction} = ${value}`)
    return true
  }

  // =====================
  // 抽卡 / 生命操作
  // =====================

  /**
   * 抽卡
   * @param {number} count
   * @param {object} player - 默认己方
   */
  drawCards(count = 1, player = null) {
    const p = player || this.context.getCurrentPlayer()
    let drawn = 0
    for (let i = 0; i < count; i++) {
      if (this.context.engine._drawCard(p)) {
        drawn++
      }
    }
    this.context.log(`抽 ${drawn} 张卡`)
    return drawn
  }

  /**
   * 生命区最上方卡加入手牌
   * @param {object} player - 默认己方
   */
  lifeToHand(player = null) {
    const p = player || this.context.getCurrentPlayer()
    if (p.life.length === 0) {
      this.context.log(`lifeToHand 失败: 生命区为空`)
      return null
    }

    // 检查效果限制
    if (p.effectRestrictions?.cannotLifeToHand) {
      this.context.log(`lifeToHand 被效果限制阻止`)
      return null
    }

    const [card] = p.life.splice(0, 1)
    p.hand.push(card)
    this.context.log(`生命区顶牌加入手牌 (剩余: ${p.life.length})`)
    return card
  }

  // =====================
  // KO / 移除操作
  // =====================

  /**
   * KO 一个角色
   * @param {string} targetInstanceId
   * @param {string} targetPlayerId
   */
  koCharacter(targetInstanceId, targetPlayerId = null) {
    const targetPlayer = targetPlayerId
      ? this.context.engine.players.find(p => p.id === targetPlayerId)
      : this.context.getOpponent()

    if (!targetPlayer) return false

    const charIndex = targetPlayer.characters.findIndex(
      c => c.card.instanceId === targetInstanceId
    )
    if (charIndex === -1) return false

    const [charSlot] = targetPlayer.characters.splice(charIndex, 1)
    targetPlayer.trash.push(charSlot.card)

    // 注销被 KO 卡牌的触发器（由 ScriptEngine 负责）
    this.context.log(`KO: ${charSlot.card.nameCn || charSlot.card.name}`)
    return charSlot.card
  }

  // =====================
  // 弹回操作
  // =====================

  /**
   * 将角色弹回手牌
   * @param {string} targetInstanceId
   * @param {string} targetPlayerId
   */
  bounceToHand(targetInstanceId, targetPlayerId = null) {
    const targetPlayer = targetPlayerId
      ? this.context.engine.players.find(p => p.id === targetPlayerId)
      : this.context.getOpponent()

    if (!targetPlayer) return false

    const charIndex = targetPlayer.characters.findIndex(
      c => c.card.instanceId === targetInstanceId
    )
    if (charIndex === -1) return false

    const [charSlot] = targetPlayer.characters.splice(charIndex, 1)
    targetPlayer.hand.push(charSlot.card)

    this.context.log(`弹回手牌: ${charSlot.card.nameCn || charSlot.card.name}`)
    return charSlot.card
  }

  // =====================
  // 墓地操作
  // =====================

  /**
   * 从墓地回收卡到手牌
   * @param {string} targetInstanceId
   * @param {object} player - 默认己方
   */
  recoverFromTrash(targetInstanceId, player = null) {
    const p = player || this.context.getCurrentPlayer()
    const idx = p.trash.findIndex(c => c.instanceId === targetInstanceId)
    if (idx === -1) return null

    const [card] = p.trash.splice(idx, 1)
    p.hand.push(card)

    this.context.log(`从墓地回收: ${card.nameCn || card.name}`)
    return card
  }

  // =====================
  // 查看牌堆顶
  // =====================

  /**
   * 查看牌堆顶N张
   * @param {number} count
   * @param {object} player - 默认己方
   * @returns {Array} 注意不移除牌
   */
  viewTopDeck(count = 5, player = null) {
    const p = player || this.context.getCurrentPlayer()
    const top = p.deck.slice(-count).reverse() // deck顶在数组末尾
    return top
  }
}
