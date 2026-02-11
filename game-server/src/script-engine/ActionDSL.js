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
    const targetPlayer = targetPlayerId
      ? this.context.engine.players.find(p => p.id === targetPlayerId)
      : this.context.getCurrentPlayer()

    if (!targetPlayer) return false

    // 支持 leader
    if (targetInstanceId === 'leader') {
      targetPlayer.powerMods = targetPlayer.powerMods || new Map()
      const current = targetPlayer.powerMods.get(targetPlayer.leader.card.instanceId) || 0
      targetPlayer.powerMods.set(targetPlayer.leader.card.instanceId, current + amount)
      this.context.log(`领袖力量 ${amount > 0 ? '+' : ''}${amount}`)
      return true
    }

    const slot = this.context.findCharacterSlot(targetInstanceId, targetPlayer)
    if (!slot) return false

    targetPlayer.powerMods = targetPlayer.powerMods || new Map()
    const current = targetPlayer.powerMods.get(targetInstanceId) || 0
    targetPlayer.powerMods.set(targetInstanceId, current + amount)

    this.context.log(`${slot.card.nameCn || slot.card.name} 力量 ${amount > 0 ? '+' : ''}${amount}`)
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
