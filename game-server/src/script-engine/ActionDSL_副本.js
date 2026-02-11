/**
 * ActionDSL - Domain Specific Language for card effects
 * Executes atomic actions defined in effect scripts
 */

import { CARD_STATES } from '../../../shared/constants.js'

// Action types
export const ACTION_TYPES = {
  ATTACH_DON: 'attach_don',
  DETACH_DON: 'detach_don',
  MODIFY_POWER: 'modify_power',
  ADD_STATE: 'add_state',
  REMOVE_STATE: 'remove_state',
  DRAW_CARDS: 'draw_cards',
  SEARCH_DECK: 'search_deck',
  RECOVER_FROM_TRASH: 'recover_from_trash',
  KO_TARGET: 'ko_target',
  Bounce_TO_HAND: 'bounce_to_hand',
  Bounce_TO_BOTTOM: 'bounce_to_bottom',
  TRASH_FROM_HAND: 'trash_from_hand',
  REST_TARGET: 'rest_target',
  ACTIVATE_TARGET: 'activate_target',
  LIFE_TO_HAND: 'life_to_hand',
  SET_RESTRICTION: 'set_restriction',
  CUSTOM_LOG: 'custom_log',
}

export class ActionDSL {
  constructor(context) {
    this.context = context
  }

  /**
   * Execute an action
   */
  async execute(action, data = {}) {
    const { type } = action

    switch (type) {
      case ACTION_TYPES.ATTACH_DON:
        return this._attachDon(action, data)
      case ACTION_TYPES.DETACH_DON:
        return this._detachDon(action, data)
      case ACTION_TYPES.MODIFY_POWER:
        return this._modifyPower(action, data)
      case ACTION_TYPES.ADD_STATE:
        return this._addState(action, data)
      case ACTION_TYPES.REMOVE_STATE:
        return this._removeState(action, data)
      case ACTION_TYPES.DRAW_CARDS:
        return this._drawCards(action, data)
      case ACTION_TYPES.KO_TARGET:
        return this._koTarget(action, data)
      case ACTION_TYPES.BOUNCE_TO_HAND:
        return this._bounceToHand(action, data)
      case ACTION_TYPES.BOUNCE_TO_BOTTOM:
        return this._bounceToBottom(action, data)
      case ACTION_TYPES.REST_TARGET:
        return this._restTarget(action, data)
      case ACTION_TYPES.ACTIVATE_TARGET:
        return this._activateTarget(action, data)
      case ACTION_TYPES.LIFE_TO_HAND:
        return this._lifeToHand(action, data)
      case ACTION_TYPES.SET_RESTRICTION:
        return this._setRestriction(action, data)
      case ACTION_TYPES.CUSTOM_LOG:
        return this._customLog(action, data)
      default:
        console.log(`[ACTION] Unknown action type: ${type}`)
        return { success: false, error: 'Unknown action type' }
    }
  }

  /**
   * Attach DON!! to target
   * params: target (self/opponent), amount, donState (active/rested)
   */
  _attachDon(action, data) {
    const { target, amount = 1, don_state = 'rested' } = action

    let player
    let targetSlot

    // Find target slot
    if (target === 'self' || !target) {
      const owner = this.context.findCardOwner(data.card)
      if (!owner) return { success: false, error: 'Owner not found' }
      player = owner
      targetSlot = this._findTargetSlot(player, data)
    } else if (target === 'opponent') {
      const opponent = this.context.getOpponent()
      if (!opponent) return { success: false, error: 'Opponent not found' }
      player = opponent
      targetSlot = this._findTargetSlot(player, data)
    } else {
      // Target by ID
      const result = this.context.findCharacterSlot(target)
      if (!result) return { success: false, error: 'Target not found' }
      player = result.player
      targetSlot = result.slot
    }

    if (!targetSlot) {
      return { success: false, error: 'Target slot not found' }
    }

    // Check available DON
    const totalDon = player.donActive + player.donRested
    const attachAmount = Math.min(amount, totalDon)
    if (attachAmount < amount) {
      this.context.log(`[效果] ${player.name} 没有足够的 DON!! (需要${amount}, 有${totalDon})`)
      return { success: false, error: 'Not enough DON!!' }
    }

    // Use active DON first, then rested
    const useActive = Math.min(player.donActive, attachAmount)
    const useRested = attachAmount - useActive
    player.donActive -= useActive
    if (useRested > 0) player.donRested -= useRested

    targetSlot.attachedDon += attachAmount

    const targetName = result?.isLeader
      ? targetSlot.card.nameCn || targetSlot.card.name
      : targetSlot.card.nameCn || targetSlot.card.name

    this.context.log(`[效果] ${player.name} 贴附 ${attachAmount} DON!! 到 ${targetName}`)

    return {
      success: true,
      type: ACTION_TYPES.ATTACH_DON,
      amount: attachAmount,
      target: targetSlot.card.cardNumber
    }
  }

  /**
   * Detach DON!! from target
   */
  _detachDon(action, data) {
    const { target, amount = 1 } = action

    let player
    let targetSlot

    if (target === 'self' || !target) {
      const owner = this.context.findCardOwner(data.card)
      if (!owner) return { success: false, error: 'Owner not found' }
      player = owner
      targetSlot = this._findTargetSlot(player, data)
    } else if (target === 'opponent') {
      const opponent = this.context.getOpponent()
      if (!opponent) return { success: false, error: 'Opponent not found' }
      player = opponent
      targetSlot = this._findTargetSlot(player, data)
    } else {
      const result = this.context.findCharacterSlot(target)
      if (!result) return { success: false, error: 'Target not found' }
      player = result.player
      targetSlot = result.slot
    }

    if (!targetSlot || targetSlot.attachedDon < amount) {
      return { success: false, error: 'Not enough DON!! attached' }
    }

    targetSlot.attachedDon -= amount
    player.donActive += amount

    const targetName = targetSlot.card.nameCn || targetSlot.card.name
    this.context.log(`[效果] ${player.name} 移除 ${amount} DON!! 从 ${targetName}`)

    return { success: true, type: ACTION_TYPES.DETACH_DON, amount }
  }

  /**
   * Modify power temporarily
   */
  _modifyPower(action, data) {
    const { target, amount } = action

    let player = this.context.getCurrentPlayer()
    if (!player) return { success: false, error: 'Current player not found' }

    // Use engine's modifyPower method
    const result = this.engine?.modifyPower?.(player.id, target, amount)
    if (result?.success) {
      this.context.log(`[效果] 力量 ${amount > 0 ? '+' : ''}${amount}`)
    }

    return { success: result?.success || false, type: ACTION_TYPES.MODIFY_POWER, amount }
  }

  /**
   * Add state to target (e.g., ignore_blocker)
   */
  _addState(action, data) {
    const { target, state } = action

    if (state === 'ignore_blocker') {
      // Mark that attacker ignores blockers this battle
      if (this.engine.pendingAttack) {
        this.engine.pendingAttack.ignoreBlocker = true
        this.context.log(`[效果] 本次攻击无视阻挡者`)
        return { success: true, type: ACTION_TYPES.ADD_STATE, state }
      }
      return { success: false, error: 'No pending attack' }
    }

    return { success: false, error: 'Unknown state' }
  }

  /**
   * Remove state from target
   */
  _removeState(action, data) {
    const { target, state } = action

    if (state === 'ignore_blocker') {
      if (this.engine.pendingAttack) {
        this.engine.pendingAttack.ignoreBlocker = false
        return { success: true, type: ACTION_TYPES.REMOVE_STATE, state }
      }
    }

    return { success: false, error: 'Unknown state' }
  }

  /**
   * Draw cards
   */
  _drawCards(action, data) {
    const { amount = 1 } = action
    const player = this.context.getCurrentPlayer()
    if (!player) return { success: false, error: 'Player not found' }

    for (let i = 0; i < amount; i++) {
      this.context._drawCard?.(player)
    }

    this.context.log(`[效果] ${player.name} 抽${amount}张牌`)
    return { success: true, type: ACTION_TYPES.DRAW_CARDS, amount }
  }

  /**
   * KO a target
   */
  _koTarget(action, data) {
    const { target } = action

    const result = this.context.findCharacterSlot(target)
    if (!result) return { success: false, error: 'Target not found' }

    const { player, slot } = result
    const card = slot.card

    // Remove from characters
    player.characters = player.characters.filter(c => c.card.instanceId !== card.instanceId)
    // Add to trash
    player.trash.push(card)

    this.context.log(`[效果] ${card.nameCn || card.name} 被击倒`)
    return { success: true, type: ACTION_TYPES.KO_TARGET, card: card.cardNumber }
  }

  /**
   * Bounce to hand
   */
  _bounceToHand(action, data) {
    const { target } = action

    const result = this.context.findCharacterSlot(target)
    if (!result) return { success: false, error: 'Target not found' }

    const { player, slot } = result
    const card = slot.card

    player.characters = player.characters.filter(c => c.card.instanceId !== card.instanceId)
    player.hand.push(card)

    this.context.log(`[效果] ${card.nameCn || card.name} 弹回手牌`)
    return { success: true, type: ACTION_TYPES.BOUNCE_TO_HAND, card: card.cardNumber }
  }

  /**
   * Bounce to bottom of deck
   */
  _bounceToBottom(action, data) {
    const { target } = action

    const result = this.context.findCharacterSlot(target)
    if (!result) return { success: false, error: 'Target not found' }

    const { player, slot } = result
    const card = slot.card

    player.characters = player.characters.filter(c => c.card.instanceId !== card.instanceId)
    player.deck.unshift(card)

    this.context.log(`[效果] ${card.nameCn || card.name} 置于牌堆底部`)
    return { success: true, type: ACTION_TYPES.BOUNCE_TO_BOTTOM, card: card.cardNumber }
  }

  /**
   * Rest a target
   */
  _restTarget(action, data) {
    const { target } = action

    const result = this.context.findCharacterSlot(target)
    if (!result) return { success: false, error: 'Target not found' }

    result.slot.state = CARD_STATES.RESTED

    const cardName = result.slot.card.nameCn || result.slot.card.name
    this.context.log(`[效果] ${cardName} 休息`)
    return { success: true, type: ACTION_TYPES.REST_TARGET }
  }

  /**
   * Activate a target
   */
  _activateTarget(action, data) {
    const { target } = action

    const result = this.context.findCharacterSlot(target)
    if (!result) return { success: false, error: 'Target not found' }

    result.slot.state = CARD_STATES.ACTIVE

    const cardName = result.slot.card.nameCn || result.slot.card.name
    this.context.log(`[效果] ${cardName} 激活`)
    return { success: true, type: ACTION_TYPES.ACTIVATE_TARGET }
  }

  /**
   * Life card to hand
   */
  _lifeToHand(action, data) {
    const { target } = action

    let player
    if (target === 'opponent') {
      player = this.context.getOpponent()
    } else {
      player = this.context.getCurrentPlayer()
    }

    if (!player || player.life.length === 0) {
      return { success: false, error: 'No life cards' }
    }

    const card = player.life.pop()
    player.hand.push(card)

    this.context.log(`[效果] ${player.name} 从生命区拿1张到手中`)
    return { success: true, type: ACTION_TYPES.LIFE_TO_HAND }
  }

  /**
   * Set effect restriction
   */
  _setRestriction(action, data) {
    const { restriction, value = true } = action

    const player = this.context.getCurrentPlayer()
    if (!player) return { success: false, error: 'Player not found' }

    if (!player.effectRestrictions) {
      player.effectRestrictions = {}
    }

    player.effectRestrictions[restriction] = value

    this.context.log(`[效果] ${player.name} 设置效果限制: ${restriction}=${value}`)
    return { success: true, type: ACTION_TYPES.SET_RESTRICTION, restriction, value }
  }

  /**
   * Custom log message
   */
  _customLog(action, data) {
    const { message } = action
    this.context.log(`[效果] ${message}`)
    return { success: true, type: ACTION_TYPES.CUSTOM_LOG, message }
  }

  /**
   * Helper to find target slot from data
   */
  _findTargetSlot(player, data) {
    // If data has target slot info, use it
    if (data.targetSlot) {
      return data.targetSlot
    }

    // Default to the card being played
    if (player.leader?.card?.instanceId === data.card?.instanceId) {
      return player.leader
    }

    for (const char of player.characters) {
      if (char.card.instanceId === data.card?.instanceId) {
        return char
      }
    }

    return null
  }
}

// Re-export action types
export { ACTION_TYPES as default }
