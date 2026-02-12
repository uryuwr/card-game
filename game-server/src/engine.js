/**
 * ONE PIECE CARD GAME - Game Engine
 * Implements the official OP TCG rules:
 * - DON!! resource system
 * - Leader/Character/Event/Stage card types
 * - Power-based combat
 * - Life area system
 * - 6-phase turn structure
 */

import {
  GAME_CONFIG,
  CARD_TYPES,
  CARD_STATES,
  GAME_PHASES,
  BATTLE_STEPS,
  KEYWORDS,
} from '../../shared/constants.js'
import { getCardPool, buildDeckFromCards, fetchDeckFromAPI, getTestDeck } from './cards.js'
import { ScriptEngine, TRIGGER_TYPES } from './script-engine/index.js'

export class GameEngine {
  constructor(room) {
    this.room = room
    this.players = []
    this.currentTurnIndex = 0
    this.turnNumber = 0
    this.phase = GAME_PHASES.REFRESH
    this.battleStep = BATTLE_STEPS.NONE
    this.pendingAttack = null
    this.pendingCounterPower = 0
    this.stagedCounterCards = []    // 暂存的反击卡（可撤销）
    this.activeEffects = []         // 当前生效中的效果（带过期条件）
    this.pendingEffect = null
    this.pendingTrigger = null      // 等待响应的生命牌触发效果 { card, playerId, damageResult }
    this.winner = null
    this.actionLog = []
    this.scriptEngine = new ScriptEngine(this)
  }

  /**
   * Reconnect a player by updating their socket ID
   */
  reconnectPlayer(oldSocketId, newSocketId) {
    const player = this.players.find(p => p.id === oldSocketId)
    if (player) {
      player.id = newSocketId
      console.log(`[ENGINE] Player reconnected: ${oldSocketId} -> ${newSocketId}`)
      return true
    }
    return false
  }

  /**
   * Initialize and start the game (async version using real deck data)
   * @param {Object} options - Game options
   * @param {boolean} options.useTestDeck - Use test decks for easier testing
   */
  async startGame(options = {}) {
    const { useTestDeck = false } = options
    console.log('[ENGINE] startGame called, useTestDeck:', useTestDeck)
    
    // Build players from their actual decks
    this.players = []
    for (let index = 0; index < this.room.players.length; index++) {
      const p = this.room.players[index]
      console.log('[ENGINE] Building player', index, 'socketId:', p.socketId, 'deckId:', p.deckId)
      
      let leaderCard, deckCards, lifeCount
      
      // 测试模式：使用预定义测试卡组
      if (useTestDeck) {
        console.log('[ENGINE] Using TEST DECK for player', index)
        const testDeckData = getTestDeck(index)
        leaderCard = testDeckData.leader
        deckCards = testDeckData.deck
        lifeCount = leaderCard.life || 5
        console.log('[ENGINE] Test deck loaded:', testDeckData.name, 'with', deckCards.length, 'cards')
      }
      // 正常模式：尝试从 API 获取玩家卡组
      else if (p.deckId) {
        const deckData = await fetchDeckFromAPI(p.deckId)
        if (deckData && deckData.leader && deckData.deck.length > 0) {
          console.log('[ENGINE] Loaded deck:', deckData.name, 'with', deckData.deck.length, 'cards')
          leaderCard = deckData.leader
          deckCards = deckData.deck
          lifeCount = leaderCard.life || 5
        }
      }
      
      // Fallback: build deck from card pool if API fetch failed
      if (!leaderCard || !deckCards || deckCards.length === 0) {
        console.log('[ENGINE] Falling back to auto-generated deck')
        const cardPool = getCardPool()
        const leaders = cardPool.filter(c => c.cardType === CARD_TYPES.LEADER)
        leaderCard = leaders[index] || leaders[0] || cardPool[0]
        const leaderColor = leaderCard?.color || 'RED'
        const result = buildDeckFromCards(cardPool, leaderColor, leaderCard?.life || 5)
        deckCards = result.deck
        lifeCount = leaderCard?.life || 5
      }
      
      console.log('[ENGINE] Leader card:', leaderCard?.cardNumber, 'Deck size:', deckCards.length, 'traitCn:', leaderCard?.traitCn)
      
      // Split deck into main deck and life area
      const shuffledDeck = this._shuffle([...deckCards])
      const lifePile = shuffledDeck.splice(0, lifeCount)
      
      this.players.push({
        id: p.socketId,
        name: p.name,
        // Leader card with state
        leader: {
          card: { ...leaderCard, instanceId: this._genId(leaderCard?.cardNumber) },
          attachedDon: 0,
          state: CARD_STATES.ACTIVE,
        },
        // Character slots (max 5)
        characters: [],
        // Stage card (max 1)
        stage: null,
        // Areas
        life: lifePile.map(c => ({ ...c, instanceId: this._genId(c.cardNumber), faceDown: true })),
        hand: [],
        deck: shuffledDeck.map(c => ({ ...c, instanceId: this._genId(c.cardNumber) })),
        trash: [],
        // DON!! resources
        donDeckCount: GAME_CONFIG.DON_DECK_SIZE,
        donActive: 0,
        donRested: 0,
        // Temporary power modifiers (reset each turn)
        powerMods: new Map(),
        // Effect restrictions (reset each turn)
        // cannotLifeToHand: 禁止通过效果将生命牌加入手牌 (如爱德华·纽哥特OP02-004登场效果)
        effectRestrictions: {
          cannotLifeToHand: false,
        },
      })
    }
    console.log('[ENGINE] Players built:', this.players.length)

    // Each player draws initial hand (5 cards)
    console.log('[ENGINE] Drawing initial hands...')
    this.players.forEach((p, i) => {
      for (let j = 0; j < GAME_CONFIG.INITIAL_HAND_SIZE; j++) {
        this._drawCard(p)
      }
      console.log('[ENGINE] Player', i, 'hand size:', p.hand.length)
    })

    // 投骰子决定先后手
    console.log('[ENGINE] Rolling dice...')
    const diceRolls = this.players.map(() => Math.floor(Math.random() * 6) + 1)
    // 如果平局，重新投掷直到分出胜负
    while (diceRolls[0] === diceRolls[1]) {
      diceRolls[0] = Math.floor(Math.random() * 6) + 1
      diceRolls[1] = Math.floor(Math.random() * 6) + 1
    }
    // 点数大的先手
    this.currentTurnIndex = diceRolls[0] > diceRolls[1] ? 0 : 1
    this.diceRolls = diceRolls
    this.turnNumber = 1
    console.log('[ENGINE] Dice:', diceRolls, 'First player:', this.currentTurnIndex)

    // Start first turn (skip draw phase for first player)
    console.log('[ENGINE] Running refresh phase...')
    this._runRefreshPhase()
    console.log('[ENGINE] Running don phase...')
    this._runDonPhase(true) // First turn gets 1 DON instead of 2
    this.phase = GAME_PHASES.MAIN
    console.log('[ENGINE] Phase set to:', this.phase)

    this._log(`🎲 ${this.players[0].name}: ${diceRolls[0]} vs ${this.players[1].name}: ${diceRolls[1]}`)
    this._log(`${this.players[this.currentTurnIndex].name} 先手!`)
    
    // 注册所有初始卡牌的脚本（领袖）
    this.scriptEngine.registerInitialCards()

    console.log('[ENGINE] Getting state...')
    const state = this.getState()
    console.log('[ENGINE] State keys:', Object.keys(state))
    return state
  }
  
  /**
   * Shuffle an array (Fisher-Yates)
   */
  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]
    }
    return array
  }

  // =====================
  // PHASE MANAGEMENT
  // =====================

  /**
   * Move to MAIN phase (from DON phase - automatic)
   */
  _enterMainPhase() {
    this.phase = GAME_PHASES.MAIN
    this._log(`${this._getCurrentPlayer().name} enters Main Phase`)
  }

  /**
   * End Main Phase, enter Battle Phase
   */
  endMainPhase(socketId) {
    if (!this._isCurrentTurn(socketId) || this.phase !== GAME_PHASES.MAIN) {
      return { success: false, message: 'Cannot end main phase now' }
    }
    this.phase = GAME_PHASES.BATTLE
    this.battleStep = BATTLE_STEPS.NONE
    this._log(`${this._getCurrentPlayer().name} enters Battle Phase`)
    return { success: true }
  }

  /**
   * End Battle Phase, go to End Phase, then next turn
   */
  endBattlePhase(socketId) {
    if (!this._isCurrentTurn(socketId) || this.phase !== GAME_PHASES.BATTLE) {
      return { success: false, message: 'Cannot end battle phase now' }
    }
    this._runEndPhase()
    this._nextTurn()
    return { success: true }
  }

  /**
   * End turn (shortcut - can be called from MAIN or BATTLE)
   */
  endTurn(socketId) {
    if (!this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Not your turn' }
    }
    if (this.phase !== GAME_PHASES.MAIN && this.phase !== GAME_PHASES.BATTLE) {
      return { success: false, message: 'Cannot end turn now' }
    }
    // 战斗中（有未结算的攻击）不能结束回合
    if (this.pendingAttack) {
      return { success: false, message: '战斗结算中，无法结束回合' }
    }
    // 有待处理的效果时不能结束回合
    if (this.pendingEffect) {
      return { success: false, message: '请先处理当前效果' }
    }
    this._runEndPhase()
    this._nextTurn()
    return { success: true }
  }

  _runRefreshPhase() {
    const player = this._getCurrentPlayer()
    
    // 1. Rest -> Active for all cards
    player.leader.state = CARD_STATES.ACTIVE
    player.characters.forEach(c => {
      c.state = CARD_STATES.ACTIVE
      c.canAttackThisTurn = true // Characters that survived a turn can now attack
    })
    
    // 2. Return all attached DON!! to active area
    let returnedDon = player.leader.attachedDon
    player.leader.attachedDon = 0
    player.characters.forEach(c => {
      returnedDon += c.attachedDon
      c.attachedDon = 0
    })
    player.donActive += returnedDon + player.donRested
    player.donRested = 0

    // 3. Clear temporary power modifiers
    player.powerMods.clear()

    // 4. Reset once-per-turn effect usage (山智等卡的效果每回合可用一次)
    player.usedOncePerTurn = {}

    this._log(`Refresh Phase: ${player.name} refreshes all cards, ${returnedDon} DON!! returned`)
  }

  _runDrawPhase(isFirstTurn = false) {
    if (isFirstTurn && this.turnNumber === 1) {
      this._log('Draw Phase skipped (first player, first turn)')
      return
    }
    const player = this._getCurrentPlayer()
    const drawn = this._drawCard(player)
    if (!drawn) {
      // Deck out = lose
      this.winner = this._getOpponent(player.id).id
      this._log(`${player.name} cannot draw - loses!`)
    } else {
      this._log(`${player.name} draws a card`)
    }
  }

  _runDonPhase(isFirstTurn = false) {
    const player = this._getCurrentPlayer()
    const donToAdd = isFirstTurn ? GAME_CONFIG.DON_FIRST_TURN : GAME_CONFIG.DON_PER_TURN
    const actualAdded = Math.min(donToAdd, player.donDeckCount)
    
    player.donDeckCount -= actualAdded
    player.donActive += actualAdded
    
    this._log(`DON!! Phase: ${player.name} adds ${actualAdded} DON!! (Active: ${player.donActive})`)
  }

  _runEndPhase() {
    const player = this._getCurrentPlayer()
    const opponent = this._getOpponent(player.id)
    
    // 触发 TURN_END 脚本（替代硬编码的 OP02-001 白胡子效果）
    this.scriptEngine.executeTrigger(TRIGGER_TYPES.TURN_END, {
      sourceCard: player.leader.card,
      sourceSlot: player.leader,
      player,
      opponent,
    })
    
    // 清除本回合的效果限制
    if (player.effectRestrictions) {
      player.effectRestrictions.cannotLifeToHand = false
    }
    
    this._log(`End Phase: ${player.name} ends turn`)
  }

  _nextTurn() {
    // 清理"本回合"过期的效果
    this._expireEffects('END_OF_TURN')
    
    this.currentTurnIndex = 1 - this.currentTurnIndex
    this.turnNumber++
    this.pendingAttack = null
    this.battleStep = BATTLE_STEPS.NONE
    this.pendingCounterPower = 0
    this.stagedCounterCards = []
    
    // 清理"对手回合开始时"过期的效果
    this._expireEffects('OPPONENT_START')

    const isFirst = this.turnNumber === 2 && this.currentTurnIndex === 1 - (this.turnNumber % 2)
    
    // Run phases: Refresh -> Draw -> DON!! -> (enter Main)
    this._runRefreshPhase()
    this._runDrawPhase(false)
    this._runDonPhase(false)
    this.phase = GAME_PHASES.MAIN
    
    this._log(`Turn ${this.turnNumber}: ${this._getCurrentPlayer().name}'s turn`)
  }

  // =====================
  // MAIN PHASE ACTIONS
  // =====================

  /**
   * Play a Character card from hand
   */
  playCharacter(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    if (!player || !this._isCurrentTurn(socketId) || this.phase !== GAME_PHASES.MAIN) {
      return { success: false, message: 'Cannot play card now' }
    }

    const cardIndex = player.hand.findIndex(c => c.instanceId === cardInstanceId)
    if (cardIndex === -1) {
      return { success: false, message: 'Card not in hand' }
    }

    const card = player.hand[cardIndex]
    if (card.cardType !== CARD_TYPES.CHARACTER) {
      return { success: false, message: 'Not a character card' }
    }

    if (player.characters.length >= GAME_CONFIG.MAX_CHARACTERS) {
      return { success: false, message: 'Character slots full (max 5)' }
    }

    const cost = card.cost || 0
    if (player.donActive < cost) {
      return { success: false, message: `Need ${cost} DON!! (have ${player.donActive})` }
    }

    // Pay cost (rest DON!!)
    player.donActive -= cost
    player.donRested += cost

    // Move card to field
    player.hand.splice(cardIndex, 1)
    // 检查是否有固有速攻（不是条件速攻）
    // 如果卡牌文本有速攻字样，但实际上是条件速攻（通过 dynamicKeywords 定义），则不算固有速攻
    const hasRushText = this._hasKeyword(card, KEYWORDS.RUSH)
    const hasConditionalRush = this.scriptEngine.hasConditionalKeyword(card, KEYWORDS.RUSH)
    const hasInherentRush = hasRushText && !hasConditionalRush
    player.characters.push({
      card,
      attachedDon: 0,
      state: CARD_STATES.ACTIVE,
      canAttackThisTurn: hasInherentRush, // 只有固有速攻才允许立即攻击
    })

    this._log(`${player.name} plays ${card.nameCn || card.name} (Cost: ${cost})`)

    // 注册卡牌脚本
    this.scriptEngine.registerCard(card, card.instanceId, player.id)

    // 触发 ON_PLAY 脚本
    const opponent = this._getOpponent(socketId)
    const charSlot = player.characters[player.characters.length - 1]
    const scriptResults = this.scriptEngine.executeTrigger(TRIGGER_TYPES.ON_PLAY, {
      sourceCard: card,
      sourceSlot: charSlot,
      player,
      opponent,
    })

    // 如果没有脚本处理，回退到手动提示
    const hasAutoEffect = scriptResults.some(r => r.executed)
    if (!hasAutoEffect && this._hasKeyword(card, KEYWORDS.ON_PLAY)) {
      this._log(`[On Play] ${card.nameCn || card.name} effect triggered - execute manually`)
    }

    return { success: true, cardPlayed: card }
  }

  /**
   * Activate a card's ACTIVATE_MAIN effect (manually triggered)
   * @param {string} socketId - Player socket ID
   * @param {string} cardInstanceId - Card instance ID (on field)
   */
  activateMain(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    if (!player || !this._isCurrentTurn(socketId) || this.phase !== GAME_PHASES.MAIN) {
      return { success: false, message: 'Cannot activate now' }
    }

    // 检查是否有待决效果
    if (this.pendingEffect) {
      return { success: false, message: 'Resolve current effect first' }
    }

    const opponent = this._getOpponent(socketId)
    
    // 找到目标卡牌（领袖或角色）
    let card = null
    let slot = null
    
    if (player.leader.card.instanceId === cardInstanceId) {
      card = player.leader.card
      slot = player.leader
    } else {
      slot = player.characters.find(c => c.card.instanceId === cardInstanceId)
      if (slot) card = slot.card
    }
    
    if (!card) {
      return { success: false, message: 'Card not found on field' }
    }
    
    // 检查卡牌是否有 ACTIVATE_MAIN 效果
    if (!this.scriptEngine.hasScriptTrigger(card, 'ACTIVATE_MAIN')) {
      return { success: false, message: 'Card has no ACTIVATE_MAIN effect' }
    }
    
    // 执行 ACTIVATE_MAIN 效果
    const scriptResults = this.scriptEngine.executeTrigger(TRIGGER_TYPES.ACTIVATE_MAIN, {
      sourceCard: card,
      sourceSlot: slot,
      player,
      opponent,
    })
    
    const executed = scriptResults.some(r => r.executed)
    if (!executed) {
      return { success: false, message: 'Effect conditions not met' }
    }
    
    this._log(`${player.name} activates ${card.nameCn || card.name} effect`)
    
    return { 
      success: true, 
      cardActivated: card,
      hasInteraction: this.pendingEffect !== null,
    }
  }

  /**
   * Play an Event card from hand
   */
  playEvent(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    if (!player || !this._isCurrentTurn(socketId) || this.phase !== GAME_PHASES.MAIN) {
      return { success: false, message: 'Cannot play event now' }
    }

    const cardIndex = player.hand.findIndex(c => c.instanceId === cardInstanceId)
    if (cardIndex === -1) {
      return { success: false, message: 'Card not in hand' }
    }

    const card = player.hand[cardIndex]
    if (card.cardType !== CARD_TYPES.EVENT) {
      return { success: false, message: 'Not an event card' }
    }

    const cost = card.cost || 0
    if (player.donActive < cost) {
      return { success: false, message: `Need ${cost} DON!! (have ${player.donActive})` }
    }

    // Pay cost
    player.donActive -= cost
    player.donRested += cost

    // Move to trash
    player.hand.splice(cardIndex, 1)
    player.trash.push(card)

    this._log(`${player.name} plays Event: ${card.nameCn || card.name}`)

    // Execute ACTIVATE_MAIN script if the event card has one
    const opponent = this._getOpponent(socketId)
    if (this.scriptEngine.hasScriptTrigger(card, 'ACTIVATE_MAIN')) {
      // Temporarily register and execute script
      this.scriptEngine.registerCard(card, card.instanceId, player.id)
      this.scriptEngine.executeTrigger(TRIGGER_TYPES.ACTIVATE_MAIN, {
        sourceCard: card,
        sourceSlot: null,
        player,
        opponent,
      })
      this.scriptEngine.unregisterCard(card.instanceId)
      this._log(`${card.nameCn || card.name}: ACTIVATE_MAIN effect executed`)
    }

    return {
      success: true,
      cardPlayed: card,
      effectText: card.effect,
      hasInteraction: this.pendingEffect !== null,
    }
  }

  /**
   * Use a Counter card from hand during battle
   * @param {string} socketId - Player socket ID
   * @param {string} cardInstanceId - Counter card instance ID
   */
  useCounterCard(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    
    // 1. 校验：必须在战斗阶段的Counter步骤 (被攻击方使用)
    if (this.battleStep !== 'counter') {
      return { success: false, message: 'Not in counter step' }
    }
    
    // 必须是被攻击方才能使用Counter
    const attackerId = this.pendingAttack?.attackerPlayerId
    if (player.id === attackerId) {
      return { success: false, message: 'Attacker cannot use counter cards' }
    }
    
    // 2. 获取卡牌
    const cardIndex = player.hand.findIndex(c => c.instanceId === cardInstanceId)
    if (cardIndex === -1) {
      return { success: false, message: 'Card not in hand' }
    }
    
    const card = player.hand[cardIndex]
    if (card.cardType !== CARD_TYPES.EVENT) {
      return { success: false, message: 'Not an event card' }
    }
    
    // 3. 检查费用
    const cost = card.cost || 0
    if (player.donActive < cost) {
      return { success: false, message: `需要 ${cost} DON (当前 ${player.donActive})` }
    }
    
    // 4. 支付费用
    player.donActive -= cost
    player.donRested += cost
    
    // 5. 移入墓地
    player.hand.splice(cardIndex, 1)
    player.trash.push(card)
    
    this._log(`${player.name} 使用 Counter: ${card.nameCn || card.name}`)
    
    // 6. 临时注册卡牌脚本并触发 COUNTER
    this.scriptEngine.registerCard(card, card.instanceId, player.id)
    
    const opponent = this._getOpponent(socketId)
    const results = this.scriptEngine.executeTrigger('COUNTER', {
      sourceCard: card,
      player,
      opponent,
      extra: {
        battleTarget: this.pendingAttack?.targetId,
      },
    })
    
    // 注销脚本
    this.scriptEngine.unregisterCard(card.instanceId)
    
    // 7. 检查是否需要玩家交互 (选择目标)
    if (this.pendingEffect?.type === 'SELECT_TARGET') {
      return { 
        success: true, 
        needsInteraction: true, 
        interactionType: 'SELECT_TARGET',
        validTargets: this.pendingEffect.validTargets,
        message: this.pendingEffect.message,
        maxSelect: this.pendingEffect.maxSelect,
        sourceCardName: this.pendingEffect.sourceCardName,
        cardUsed: card,
      }
    }
    
    return { success: true, cardUsed: card }
  }

  /**
   * Resolve target selection for pending effects
   * @param {string} socketId - Player socket ID
   * @param {string[]} selectedInstanceIds - Selected target instance IDs
   */
  resolveSelectTarget(socketId, selectedInstanceIds) {
    const player = this._getPlayer(socketId)
    const effect = this.pendingEffect
    
    const validEffectTypes = ['SELECT_TARGET', 'KO_TARGET', 'ATTACH_DON']
    if (!effect || !validEffectTypes.includes(effect.type)) {
      return { success: false, message: 'No pending selection' }
    }
    
    if (effect.playerId !== player.id) {
      return { success: false, message: 'Not your pending effect' }
    }
    
    // 验证选择数量
    if (selectedInstanceIds.length > (effect.maxSelect || 1)) {
      return { success: false, message: `最多选择 ${effect.maxSelect || 1} 个目标` }
    }
    
    // 验证选择是否有效
    const validIds = effect.validTargets.map(t => t.instanceId)
    for (const id of selectedInstanceIds) {
      if (!validIds.includes(id)) {
        return { success: false, message: '无效的选择目标' }
      }
    }
    
    // 根据效果类型执行不同操作
    const effectType = effect.type
    this.pendingEffect = null  // 清除当前待决效果（在执行前）
    
    let results = null
    
    switch (effectType) {
      case 'SELECT_TARGET':
        // 执行 onSelectActions（效果会直接更新 pendingAttack.targetPower）
        results = this.scriptEngine.executeOnSelectActions(selectedInstanceIds, effect)
        this._log(`${player.name} 选择了 ${selectedInstanceIds.length} 个目标执行效果`)
        break
        
      case 'KO_TARGET':
        // 执行 KO 操作
        for (const targetId of selectedInstanceIds) {
          this._koCharacterById(targetId, effect)
        }
        this._log(`${player.name} 选择 KO 了 ${selectedInstanceIds.length} 个目标`)
        break
        
      case 'ATTACH_DON':
        // 执行贴 DON 操作
        // donCount 是总共要贴的DON数量，如果选了多个目标则平分
        const donCount = effect.donCount || effect.count || 1
        const donPerTarget = selectedInstanceIds.length > 0 
          ? Math.floor(donCount / selectedInstanceIds.length) 
          : donCount
        const remainder = donCount % selectedInstanceIds.length
        
        for (let i = 0; i < selectedInstanceIds.length; i++) {
          const targetId = selectedInstanceIds[i]
          // 第一个目标获得额外的余数DON
          const count = i === 0 ? donPerTarget + remainder : donPerTarget
          if (count > 0) {
            this._attachDonToTarget(player, targetId, count, effect.donState || 'rested')
          }
        }
        this._log(`${player.name} 选择了 ${selectedInstanceIds.length} 个目标贴了 ${donCount} DON`)
        break
    }
    
    return { 
      success: true, 
      results,
      newTargetPower: this.pendingAttack?.targetPower,
    }
  }

  /**
   * Resolve discard effect: player discards cards from hand
   * @param {string} socketId - Player socket ID
   * @param {string[]} cardInstanceIds - Cards to discard
   */
  resolveDiscard(socketId, cardInstanceIds) {
    const player = this._getPlayer(socketId)
    const effect = this.pendingEffect

    if (!effect || effect.type !== 'DISCARD') {
      return { success: false, message: 'No pending discard effect' }
    }

    if (effect.playerId !== player.id) {
      return { success: false, message: 'Not your pending effect' }
    }

    // 验证选择数量
    if (cardInstanceIds.length !== effect.count) {
      return { success: false, message: `需要丢弃 ${effect.count} 张卡` }
    }

    // 验证并移除手牌
    const discardedCards = []
    for (const id of cardInstanceIds) {
      const cardIndex = player.hand.findIndex(c => c.instanceId === id)
      if (cardIndex === -1) {
        return { success: false, message: '手牌中找不到该卡' }
      }
      const [card] = player.hand.splice(cardIndex, 1)
      player.trash.push(card)
      discardedCards.push(card)
    }

    this._log(`${player.name} 丢弃了 ${discardedCards.map(c => c.nameCn || c.name).join(', ')}`)

    // 保存 onDiscard actions 并清除当前 effect
    const onDiscardActions = effect.onDiscardActions || []
    const sourceInfo = {
      sourceCardNumber: effect.sourceCardNumber,
      sourceCardName: effect.sourceCardName,
      playerId: effect.playerId,
    }
    this.pendingEffect = null

    // 执行 onDiscard 回调（如果有）
    if (onDiscardActions.length > 0) {
      const opponent = this._getOpponent(socketId)
      this.scriptEngine.executeOnDiscardActions(onDiscardActions, sourceInfo, player, opponent, discardedCards)
    }

    return { 
      success: true, 
      discardedCards,
      hasPendingEffect: !!this.pendingEffect,
    }
  }

  /**
   * Resolve recover from trash effect: player selects cards to recover
   * @param {string} socketId - Player socket ID
   * @param {string[]} cardInstanceIds - Cards to recover
   */
  resolveRecover(socketId, cardInstanceIds) {
    const player = this._getPlayer(socketId)
    const effect = this.pendingEffect

    if (!effect || effect.type !== 'RECOVER_FROM_TRASH') {
      return { success: false, message: 'No pending recover effect' }
    }

    if (effect.playerId !== player.id) {
      return { success: false, message: 'Not your pending effect' }
    }

    // 验证选择数量
    if (cardInstanceIds.length > (effect.maxSelect || 1)) {
      return { success: false, message: `最多选择 ${effect.maxSelect || 1} 张卡` }
    }

    // 验证并从废弃区回收
    const validIds = effect.validCards.map(c => c.instanceId)
    const recoveredCards = []
    for (const id of cardInstanceIds) {
      if (!validIds.includes(id)) {
        return { success: false, message: '选择的卡不在有效列表中' }
      }
      const cardIndex = player.trash.findIndex(c => c.instanceId === id)
      if (cardIndex === -1) {
        return { success: false, message: '废弃区中找不到该卡' }
      }
      const [card] = player.trash.splice(cardIndex, 1)
      player.hand.push(card)
      recoveredCards.push(card)
    }

    this._log(`${player.name} 从废弃区回收了 ${recoveredCards.map(c => c.nameCn || c.name).join(', ')}`)
    this.pendingEffect = null

    return { 
      success: true, 
      recoveredCards,
    }
  }

  /**
   * KO a character by instance ID
   * @private
   */
  _koCharacterById(instanceId, effect) {
    const effectOwner = this.players.find(p => p.id === effect.playerId)
    const opponent = this.players.find(p => p.id !== effect.playerId)
    const slotIndex = opponent.characters.findIndex(c => c.card.instanceId === instanceId)
    if (slotIndex === -1) return
    
    const slot = opponent.characters[slotIndex]
    const card = slot.card
    
    // 触发 ON_KO 效果（在移除前触发，因为需要 slot 信息）
    console.log(`[Engine] ON_KO trigger for ${card.cardNumber} (${card.nameCn})`)
    this.scriptEngine.executeTrigger(TRIGGER_TYPES.ON_KO, {
      sourceCard: card,
      sourceSlot: slot,
      player: opponent,  // 被 KO 卡牌的所有者
      opponent: effectOwner,  // 效果发动者
    })
    
    // 归还附着的 DON 到费用区
    if (slot.attachedDon > 0) {
      opponent.donRested += slot.attachedDon
      this._log(`${slot.attachedDon} attached DON!! returned to cost area`)
    }
    
    // 注销脚本
    this.scriptEngine.unregisterCard(instanceId)
    
    // 移除角色
    opponent.characters.splice(slotIndex, 1)
    opponent.trash.push(card)
    
    this._log(`${card.nameCn || card.name} 被 KO`)
  }

  /**
   * Attach DON to a target (leader or character)
   * @private
   */
  _attachDonToTarget(player, targetId, count, donState) {
    // 检查是否有足够的 DON 可用
    const available = donState === 'rested' ? player.donRested : player.donActive
    if (available < count) return
    
    // 找到目标
    if (targetId === 'leader' || player.leader.card.instanceId === targetId) {
      player.leader.attachedDon += count
      if (donState === 'rested') {
        player.donRested -= count
      } else {
        player.donActive -= count
      }
      return
    }
    
    const slot = player.characters.find(c => c.card.instanceId === targetId)
    if (slot) {
      slot.attachedDon += count
      if (donState === 'rested') {
        player.donRested -= count
      } else {
        player.donActive -= count
      }
    }
  }

  /**
   * Play a Stage card from hand
   */
  playStage(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    if (!player || !this._isCurrentTurn(socketId) || this.phase !== GAME_PHASES.MAIN) {
      return { success: false, message: 'Cannot play stage now' }
    }

    const cardIndex = player.hand.findIndex(c => c.instanceId === cardInstanceId)
    if (cardIndex === -1) {
      return { success: false, message: 'Card not in hand' }
    }

    const card = player.hand[cardIndex]
    if (card.cardType !== CARD_TYPES.STAGE) {
      return { success: false, message: 'Not a stage card' }
    }

    const cost = card.cost || 0
    if (player.donActive < cost) {
      return { success: false, message: `Need ${cost} DON!! (have ${player.donActive})` }
    }

    // Pay cost
    player.donActive -= cost
    player.donRested += cost

    // Replace existing stage (old one goes to trash)
    player.hand.splice(cardIndex, 1)
    if (player.stage) {
      player.trash.push(player.stage.card)
    }
    player.stage = { card }

    this._log(`${player.name} plays Stage: ${card.nameCn || card.name}`)
    
    return { success: true, cardPlayed: card }
  }

  /**
   * Attach DON!! to Leader or Character
   */
  attachDon(socketId, targetId, count = 1) {
    const player = this._getPlayer(socketId)
    if (!player || !this._isCurrentTurn(socketId) || this.phase !== GAME_PHASES.MAIN) {
      return { success: false, message: 'Cannot attach DON!! now' }
    }

    const totalDon = player.donActive + player.donRested
    if (totalDon < count) {
      return { success: false, message: `Not enough DON!! (have ${totalDon})` }
    }

    let target = null
    let targetName = ''

    if (targetId === 'leader') {
      target = player.leader
      targetName = player.leader.card.nameCn || player.leader.card.name
    } else {
      const charSlot = player.characters.find(c => c.card.instanceId === targetId)
      if (charSlot) {
        target = charSlot
        targetName = charSlot.card.nameCn || charSlot.card.name
      }
    }

    if (!target) {
      return { success: false, message: 'Invalid target' }
    }

    const useActive = Math.min(player.donActive, count)
    const useRested = count - useActive
    player.donActive -= useActive
    if (useRested > 0) player.donRested -= useRested
    target.attachedDon += count

    this._log(`${player.name} attaches ${count} DON!! to ${targetName} (+${count * GAME_CONFIG.POWER_PER_DON} power)`)
    
    return { success: true }
  }

  /**
   * Detach DON!! from Leader or Character (return to active area)
   */
  detachDon(socketId, sourceId, count = 1) {
    const player = this._getPlayer(socketId)
    if (!player || !this._isCurrentTurn(socketId) || this.phase !== GAME_PHASES.MAIN) {
      return { success: false, message: 'Cannot detach DON!! now' }
    }

    let source = null
    let sourceName = ''

    if (sourceId === 'leader') {
      source = player.leader
      sourceName = player.leader.card.nameCn || player.leader.card.name
    } else {
      const charSlot = player.characters.find(c => c.card.instanceId === sourceId)
      if (charSlot) {
        source = charSlot
        sourceName = charSlot.card.nameCn || charSlot.card.name
      }
    }

    if (!source) {
      return { success: false, message: 'Invalid source' }
    }

    if (source.attachedDon < count) {
      return { success: false, message: `Not enough DON!! attached (have ${source.attachedDon})` }
    }

    source.attachedDon -= count
    player.donActive += count

    this._log(`${player.name} detaches ${count} DON!! from ${sourceName}`)
    
    return { success: true }
  }

  /**
   * Move DON!! between active/rested areas (manual utility)
   */
  moveDon(socketId, direction, count = 1) {
    const player = this._getPlayer(socketId)
    if (!player || !this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Not your turn' }
    }
    if (this.phase !== GAME_PHASES.MAIN && this.phase !== GAME_PHASES.BATTLE) {
      return { success: false, message: 'Not in main/battle phase' }
    }
    if (direction === 'rest') {
      if (player.donActive < count) {
        return { success: false, message: `Not enough active DON!! (have ${player.donActive})` }
      }
      player.donActive -= count
      player.donRested += count
      this._log(`${player.name} rests ${count} DON!!`)
      return { success: true }
    }
    if (direction === 'activate') {
      if (player.donRested < count) {
        return { success: false, message: `Not enough rested DON!! (have ${player.donRested})` }
      }
      player.donRested -= count
      player.donActive += count
      this._log(`${player.name} activates ${count} DON!!`)
      return { success: true }
    }
    return { success: false, message: 'Invalid DON move' }
  }

  // =====================
  // BATTLE PHASE ACTIONS
  // =====================

  /**
   * Declare an attack
   */
  declareAttack(socketId, attackerId, targetId) {
    const player = this._getPlayer(socketId)
    const opponent = this._getOpponent(socketId)
    
    if (!player || !opponent || !this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Not your turn' }
    }
    // Allow attack from MAIN or BATTLE phase (official rules: battle is part of main phase)
    if (this.phase !== GAME_PHASES.BATTLE && this.phase !== GAME_PHASES.MAIN) {
      return { success: false, message: 'Not in main/battle phase' }
    }
    if (this.pendingAttack) {
      return { success: false, message: 'Attack already pending' }
    }
    // Official rule: Neither player can attack on their first turn
    if (this.turnNumber <= 2) {
      return { success: false, message: '第一回合不能攻击 (First turn: no attacks)' }
    }
    // Auto-transition to battle phase if in main
    if (this.phase === GAME_PHASES.MAIN) {
      this.phase = GAME_PHASES.BATTLE
      this.battleStep = BATTLE_STEPS.NONE
      this._log(`${player.name} enters Battle Phase`)
    }

    // Find attacker
    let attacker = null
    let attackerSlot = null
    
    if (attackerId === 'leader') {
      if (player.leader.state !== CARD_STATES.ACTIVE) {
        return { success: false, message: 'Leader is rested' }
      }
      attacker = player.leader.card
      attackerSlot = player.leader
    } else {
      const charSlot = player.characters.find(c => c.card.instanceId === attackerId)
      if (!charSlot) {
        return { success: false, message: 'Attacker not found' }
      }
      if (charSlot.state !== CARD_STATES.ACTIVE) {
        return { success: false, message: 'Character is rested' }
      }
      // 检查是否可以在本回合攻击（非速攻角色登场当回合不能攻击）
      // 但如果有条件速攻（dynamicKeywords）且条件满足，则允许攻击
      if (!charSlot.canAttackThisTurn) {
        // 检查是否有动态速攻（如 OP02-008）
        console.log(`[declareAttack] ${charSlot.card.cardNumber} canAttackThisTurn=false, checking dynamic Rush...`)
        console.log(`[declareAttack] slot.attachedDon=${charSlot.attachedDon}, player.life=${player.life.length}`)
        const hasDynamicRush = this._hasDynamicKeyword(charSlot.card, charSlot, player, KEYWORDS.RUSH)
        console.log(`[declareAttack] hasDynamicRush=${hasDynamicRush}`)
        if (!hasDynamicRush) {
          return { success: false, message: '角色登场当回合不能攻击（除非有速攻）' }
        }
        console.log(`[declareAttack] ${charSlot.card.cardNumber} has dynamic Rush, allowing attack`)
      }
      attacker = charSlot.card
      attackerSlot = charSlot
    }

    // Validate target
    let target = null
    let targetSlot = null
    
    if (targetId === 'leader') {
      target = opponent.leader.card
      targetSlot = opponent.leader
    } else {
      const charSlot = opponent.characters.find(c => c.card.instanceId === targetId)
      if (!charSlot) {
        return { success: false, message: 'Target not found' }
      }
      // Can only attack rested characters
      if (charSlot.state !== CARD_STATES.RESTED) {
        return { success: false, message: 'Can only attack rested characters' }
      }
      target = charSlot.card
      targetSlot = charSlot
    }

    // Rest the attacker
    attackerSlot.state = CARD_STATES.RESTED

    // Calculate power
    const attackerPower = this._calculatePower(attacker, attackerSlot, player)
    const targetPower = this._calculatePower(target, targetSlot, opponent)

    this.pendingAttack = {
      attackerId,
      attackerInstanceId: attacker.instanceId,
      attackerCard: attacker,
      attackerPower,
      targetId,
      targetInstanceId: target.instanceId,
      targetCard: target,
      targetPower,
      isTargetLeader: targetId === 'leader',
      hasDoubleAttack: this._hasKeyword(attacker, KEYWORDS.DOUBLE_ATTACK),
      hasBanish: this._hasKeyword(attacker, KEYWORDS.BANISH),
      ignoreBlocker: false, // 脚本可设置为 true
    }

    // 触发 ON_ATTACK 脚本（在检查阻挡者之前）
    this.scriptEngine.executeTrigger(TRIGGER_TYPES.ON_ATTACK, {
      sourceCard: attacker,
      sourceSlot: attackerSlot,
      player,
      opponent,
      extra: { attackerId, targetId },
    })

    // Check if opponent has blockers (在脚本执行后，可能被 ignoreBlocker 覆盖)
    // Also check attacker's fieldStates.cannotBeBlocked (set by 恶魔风脚 etc.)
    if (attackerSlot.fieldStates?.cannotBeBlocked) {
      this.pendingAttack.ignoreBlocker = true
    }
    const hasBlockers = !this.pendingAttack.ignoreBlocker && opponent.characters.some(
      c => c.state === CARD_STATES.ACTIVE && this._hasKeyword(c.card, KEYWORDS.BLOCKER)
    )

    this.battleStep = hasBlockers ? BATTLE_STEPS.BLOCK : BATTLE_STEPS.COUNTER
    this.pendingCounterPower = 0

    this._log(`${player.name} attacks ${targetId === 'leader' ? 'Leader' : target.nameCn || target.name} with ${attacker.nameCn || attacker.name} (Power: ${attackerPower} vs ${targetPower})`)

    return { 
      success: true, 
      pendingAttack: this.pendingAttack,
      battleStep: this.battleStep,
      waitingForOpponent: true,
    }
  }

  /**
   * Declare a blocker (defender response)
   */
  declareBlocker(socketId, blockerInstanceId) {
    const player = this._getPlayer(socketId)
    const attacker = this._getOpponent(socketId)
    
    if (!player || !this.pendingAttack || this.battleStep !== BATTLE_STEPS.BLOCK) {
      return { success: false, message: 'Cannot declare blocker now' }
    }
    // Only defender can declare blocker
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot declare blocker' }
    }

    const blockerSlot = player.characters.find(c => c.card.instanceId === blockerInstanceId)
    if (!blockerSlot) {
      return { success: false, message: 'Blocker not found' }
    }
    if (blockerSlot.state !== CARD_STATES.ACTIVE) {
      return { success: false, message: 'Blocker must be active' }
    }
    if (!this._hasKeyword(blockerSlot.card, KEYWORDS.BLOCKER)) {
      return { success: false, message: 'This card does not have Blocker' }
    }

    // Rest the blocker
    blockerSlot.state = CARD_STATES.RESTED

    // Redirect attack to blocker
    this.pendingAttack.targetId = blockerSlot.card.instanceId
    this.pendingAttack.targetInstanceId = blockerSlot.card.instanceId
    this.pendingAttack.targetCard = blockerSlot.card
    this.pendingAttack.targetPower = this._calculatePower(blockerSlot.card, blockerSlot, player)
    this.pendingAttack.isTargetLeader = false
    this.pendingAttack.blockerUsed = true

    this.battleStep = BATTLE_STEPS.COUNTER

    this._log(`${player.name} blocks with ${blockerSlot.card.nameCn || blockerSlot.card.name}`)

    return { success: true, pendingAttack: this.pendingAttack }
  }

  /**
   * Skip blocker declaration
   */
  skipBlocker(socketId) {
    if (!this.pendingAttack || this.battleStep !== BATTLE_STEPS.BLOCK) {
      return { success: false, message: 'Cannot skip blocker now' }
    }
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot skip blocker' }
    }

    this.battleStep = BATTLE_STEPS.COUNTER
    this._log('Defender does not use Blocker')
    
    return { success: true }
  }

  /**
   * 暂存一张Counter卡（预选模式）
   * 效果立即生效，但卡牌不进墓地，可以撤销
   */
  stageCounterCard(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    
    if (!player || !this.pendingAttack || this.battleStep !== BATTLE_STEPS.COUNTER) {
      return { success: false, message: 'Cannot stage counter now' }
    }
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot stage counter' }
    }

    // 检查是否已经暂存
    if (this.stagedCounterCards.some(sc => sc.card.instanceId === cardInstanceId)) {
      return { success: false, message: 'Card already staged' }
    }

    // 1. 查找卡牌
    const cardIndex = player.hand.findIndex(c => c.instanceId === cardInstanceId)
    if (cardIndex === -1) {
      return { success: false, message: 'Card not in hand' }
    }
    
    const card = player.hand[cardIndex]
    let donCostPaid = 0
    
    // 2. 检查并扣除DON费用（事件卡需要消耗DON）
    if (card.cardType === CARD_TYPES.EVENT) {
      const cost = card.cost || 0
      if (player.donActive < cost) {
        return { success: false, message: `DON!!不足: 需要 ${cost}, 当前 ${player.donActive}` }
      }
      // 扣费
      player.donActive -= cost
      player.donRested += cost
      donCostPaid = cost
      if (cost > 0) {
        this._log(`${player.name} 支付 ${cost} DON!!`)
      }
    }
    
    // 3. 检查是否有COUNTER脚本
    const hasScript = this.scriptEngine.hasScript(card.cardNumber, 'COUNTER')
    
    // 创建暂存记录
    const stagedEntry = {
      card: this._sanitizeCard(card),
      counterValue: 0,
      donCostPaid: donCostPaid,
      powerModsApplied: [], // 记录脚本产生的力量修改
      effectType: hasScript ? 'SCRIPT_EFFECT' : 'COUNTER_VALUE',
      expiry: 'END_OF_BATTLE',
    }
    
    if (!hasScript) {
      // 普通卡：累加counter值
      const counterValue = card.counter || 0
      stagedEntry.counterValue = counterValue
      this.pendingCounterPower += counterValue
      this.pendingAttack.targetPower += counterValue
      this._log(`${card.nameCn || card.name}: Counter +${counterValue}`)
      
      this.stagedCounterCards.push(stagedEntry)
      
      return { 
        success: true, 
        cardStaged: card,
        counterAdded: counterValue,
        totalCounterPower: this.pendingCounterPower,
        newTargetPower: this.pendingAttack.targetPower,
        stagedCounterCards: this.stagedCounterCards,
      }
    }
    
    // 4. 脚本卡：执行脚本，但需要追踪效果以便撤销
    this._log(`${card.nameCn || card.name}: 执行Counter效果`)
    
    const opponent = this._getOpponent(socketId)
    
    // 记录执行脚本前的 pendingCounterPower
    const powerBefore = this.pendingCounterPower
    
    // 设置追踪器，记录脚本产生的 powerMods
    this._trackingPowerMods = []
    
    // 临时注册并执行脚本
    this.scriptEngine.registerCard(card, card.instanceId, player.id)
    
    this.scriptEngine.executeTrigger('COUNTER', {
      sourceCard: card,
      player,
      opponent,
      extra: {
        battleTarget: this.pendingAttack?.targetId,
      },
    })
    
    // 注销脚本
    this.scriptEngine.unregisterCard(card.instanceId)
    
    // 记录脚本产生的力量修改
    stagedEntry.powerModsApplied = this._trackingPowerMods || []
    stagedEntry.counterValue = this.pendingCounterPower - powerBefore
    this._trackingPowerMods = null
    
    this.stagedCounterCards.push(stagedEntry)
    
    // 5. 检查是否需要玩家交互
    if (this.pendingEffect) {
      return { 
        success: true, 
        needsInteraction: true, 
        interactionType: this.pendingEffect.type,
        validTargets: this.pendingEffect.validTargets,
        validCards: this.pendingEffect.validCards,
        message: this.pendingEffect.message,
        maxSelect: this.pendingEffect.maxSelect,
        count: this.pendingEffect.count,
        sourceCardName: card.nameCn || card.name,
        cardStaged: card,
        stagedCounterCards: this.stagedCounterCards,
      }
    }
    
    // 脚本不需要交互，直接返回
    return { 
      success: true, 
      cardStaged: card,
      totalCounterPower: this.pendingCounterPower,
      newTargetPower: this.pendingAttack?.targetPower,
      stagedCounterCards: this.stagedCounterCards,
    }
  }

  /**
   * 取消暂存的反击卡（撤销效果）
   */
  unstageCounterCard(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    
    if (!player || !this.pendingAttack || this.battleStep !== BATTLE_STEPS.COUNTER) {
      return { success: false, message: 'Cannot unstage counter now' }
    }
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot unstage counter' }
    }

    // 查找暂存的卡
    const stagedIndex = this.stagedCounterCards.findIndex(
      sc => sc.card.instanceId === cardInstanceId
    )
    if (stagedIndex === -1) {
      return { success: false, message: 'Card not staged' }
    }

    const staged = this.stagedCounterCards[stagedIndex]
    
    // 1. 撤销力量修改
    this.pendingCounterPower -= staged.counterValue
    this.pendingAttack.targetPower -= staged.counterValue
    
    // 2. 撤销脚本效果带来的powerMods
    if (staged.powerModsApplied && staged.powerModsApplied.length > 0) {
      for (const mod of staged.powerModsApplied) {
        for (const p of this.players) {
          if (p.powerMods?.has(mod.targetId)) {
            const current = p.powerMods.get(mod.targetId) || 0
            p.powerMods.set(mod.targetId, current - mod.amount)
          }
        }
        // 也要撤销对 pendingAttack.targetPower 的修改
        if (this.pendingAttack.targetId === mod.targetId || 
            this.pendingAttack.targetInstanceId === mod.targetId) {
          this.pendingAttack.targetPower -= mod.amount
          this.pendingCounterPower -= mod.amount
        }
      }
    }
    
    // 3. 退还DON费用
    if (staged.donCostPaid > 0) {
      player.donActive += staged.donCostPaid
      player.donRested -= staged.donCostPaid
    }
    
    // 4. 标记卡牌为未暂存（从暂存列表移除）
    this.stagedCounterCards.splice(stagedIndex, 1)
    
    this._log(`取消使用 ${staged.card.nameCn || staged.card.name}`)
    
    return {
      success: true,
      unstagedCard: staged.card,
      totalCounterPower: this.pendingCounterPower,
      newTargetPower: this.pendingAttack.targetPower,
      stagedCounterCards: this.stagedCounterCards,
    }
  }

  /**
   * 确认反击（将暂存卡移入墓地）
   */
  confirmCounter(socketId) {
    if (!this.pendingAttack || this.battleStep !== BATTLE_STEPS.COUNTER) {
      return { success: false, message: 'Cannot confirm counter now' }
    }
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot confirm counter' }
    }

    const player = this._getPlayer(socketId)
    
    // 将所有暂存的卡移入墓地
    for (const staged of this.stagedCounterCards) {
      const cardIndex = player.hand.findIndex(c => c.instanceId === staged.card.instanceId)
      if (cardIndex !== -1) {
        const [card] = player.hand.splice(cardIndex, 1)
        player.trash.push(card)
      }
    }
    
    const usedCount = this.stagedCounterCards.length
    this._log(`确认反击，使用了 ${usedCount} 张卡`)
    
    // 清空暂存列表（保留记录用于显示）
    const confirmedCards = [...this.stagedCounterCards]
    this.stagedCounterCards = []
    
    // 解决战斗
    return this._resolveBattle(confirmedCards)
  }

  /**
   * 添加手动反击力量（不使用卡牌）
   */
  addManualCounterPower(socketId, power) {
    const player = this._getPlayer(socketId)
    
    if (!player || !this.pendingAttack || this.battleStep !== BATTLE_STEPS.COUNTER) {
      return { success: false, message: 'Cannot add counter power now' }
    }
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot add counter power' }
    }
    
    const amount = Math.max(0, power || 0)
    this.pendingCounterPower += amount
    this.pendingAttack.targetPower += amount
    
    this._log(`手动添加反击力量: +${amount}`)
    
    return {
      success: true,
      powerAdded: amount,
      totalCounterPower: this.pendingCounterPower,
      newTargetPower: this.pendingAttack.targetPower,
    }
  }

  /**
   * Skip counter (不使用反击卡), resolve battle
   * 如果有暂存的卡，先清理掉
   */
  skipCounter(socketId) {
    if (!this.pendingAttack || this.battleStep !== BATTLE_STEPS.COUNTER) {
      return { success: false, message: 'Cannot skip counter now' }
    }
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot skip counter' }
    }

    // 如果有暂存的卡，撤销所有效果
    if (this.stagedCounterCards.length > 0) {
      const player = this._getPlayer(socketId)
      for (const staged of [...this.stagedCounterCards].reverse()) {
        // 撤销力量修改
        this.pendingCounterPower -= staged.counterValue
        this.pendingAttack.targetPower -= staged.counterValue
        
        // 撤销脚本效果
        if (staged.powerModsApplied) {
          for (const mod of staged.powerModsApplied) {
            for (const p of this.players) {
              if (p.powerMods?.has(mod.targetId)) {
                const current = p.powerMods.get(mod.targetId) || 0
                p.powerMods.set(mod.targetId, current - mod.amount)
              }
            }
            if (this.pendingAttack.targetId === mod.targetId || 
                this.pendingAttack.targetInstanceId === mod.targetId) {
              this.pendingAttack.targetPower -= mod.amount
              this.pendingCounterPower -= mod.amount
            }
          }
        }
        
        // 退还DON
        if (staged.donCostPaid > 0) {
          player.donActive += staged.donCostPaid
          player.donRested -= staged.donCostPaid
        }
      }
      this.stagedCounterCards = []
      this._log('取消所有反击卡')
    }

    return this._resolveBattle()
  }

  /**
   * Resolve the pending attack
   */
  _resolveBattle(confirmedCards = []) {
    if (!this.pendingAttack) {
      return { success: false, message: 'No pending attack' }
    }

    const attack = this.pendingAttack
    const attacker = this._getCurrentPlayer()
    const defender = this._getOpponent(attacker.id)

    this.battleStep = BATTLE_STEPS.DAMAGE

    let result = {
      success: true,
      attackerPower: attack.attackerPower,
      targetPower: attack.targetPower,
      outcome: '',
    }

    // Compare power
    if (attack.attackerPower >= attack.targetPower) {
      // Attack succeeds
      if (attack.isTargetLeader) {
        // Damage to leader = move Life card to hand (or lose if no Life)
        const damage = attack.hasDoubleAttack ? 2 : 1
        
        for (let i = 0; i < damage; i++) {
          if (defender.life.length > 0) {
            const lifeCard = defender.life.pop()
            lifeCard.faceDown = false
            
            // Check for Trigger effect - 检查是否有触发效果脚本
            const hasScriptTrigger = lifeCard.trigger && this._hasTriggerScript(lifeCard.cardNumber)
            
            if (hasScriptTrigger && !attack.hasBanish) {
              // 有触发效果且未被banish，设置 pendingTrigger 让玩家选择
              this._log(`[Trigger] ${lifeCard.nameCn || lifeCard.name} 翻开! 可选择发动触发效果`)
              this.pendingTrigger = {
                card: lifeCard,
                playerId: defender.id,
                triggerText: lifeCard.trigger,
                // 保存战斗状态以便继续处理
                battleContext: {
                  attackerPower: attack.attackerPower,
                  targetPower: attack.targetPower,
                  remainingDamage: damage - i - 1,  // 剩余伤害（双重攻击时）
                  hasBanish: attack.hasBanish,
                },
              }
              result.outcome = 'TRIGGER_PENDING'
              result.pendingTrigger = {
                cardNumber: lifeCard.cardNumber,
                cardName: lifeCard.nameCn || lifeCard.name,
                triggerText: lifeCard.trigger,
                instanceId: lifeCard.instanceId,
              }
              result.lifeRemaining = defender.life.length
              
              // 暂停处理，等待玩家响应
              return result
            }
            
            // 无触发效果或被 banish，正常处理
            if (lifeCard.trigger) {
              this._log(`[Trigger] ${lifeCard.nameCn || lifeCard.name}: ${lifeCard.trigger} (无脚本实现)`)
              result.triggerCard = lifeCard
            }
            
            if (attack.hasBanish) {
              // Banish - card is removed from game (just log, don't add to hand)
              this._log(`Life card banished: ${lifeCard.nameCn || lifeCard.name}`)
            } else {
              defender.hand.push(lifeCard)
              this._log(`Life card added to hand: ${lifeCard.nameCn || lifeCard.name}`)
            }
          } else {
            // No Life left - this attack wins the game!
            this.winner = attacker.id
            result.outcome = 'GAME_WIN'
            this._log(`${attacker.name} WINS! (dealt lethal damage)`)
          }
        }
        
        if (!this.winner) {
          result.outcome = 'LIFE_DAMAGE'
          result.lifeRemaining = defender.life.length
        }
      } else {
        // KO the target character
        const targetSlot = defender.characters.find(c => c.card.instanceId === attack.targetInstanceId)
        if (targetSlot) {
          // 触发 ON_KO 脚本
          console.log(`[Engine] ON_KO trigger for ${targetSlot.card.cardNumber} (${targetSlot.card.nameCn})`)
          const onKoResults = this.scriptEngine.executeTrigger(TRIGGER_TYPES.ON_KO, {
            sourceCard: targetSlot.card,
            sourceSlot: targetSlot,
            player: defender,
            opponent: attacker,
          })
          console.log(`[Engine] ON_KO results:`, JSON.stringify(onKoResults))
          console.log(`[Engine] pendingEffect after ON_KO:`, this.pendingEffect ? JSON.stringify(this.pendingEffect).slice(0, 200) : 'null')

          // 归还附着的 DON 到费用区
          if (targetSlot.attachedDon > 0) {
            defender.donRested += targetSlot.attachedDon
            this._log(`${targetSlot.attachedDon} attached DON!! returned to cost area`)
            targetSlot.attachedDon = 0
          }

          defender.characters = defender.characters.filter(c => c.card.instanceId !== attack.targetInstanceId)
          defender.trash.push(targetSlot.card)
          
          // 注销被 KO 卡牌的脚本
          this.scriptEngine.unregisterCard(attack.targetInstanceId)

          result.outcome = 'CHARACTER_KO'
          this._log(`${attack.targetCard.nameCn || attack.targetCard.name} is KO'd`)
        }
      }
    } else {
      // Attack blocked
      result.outcome = 'BLOCKED'
      this._log(`Attack blocked! (${attack.attackerPower} < ${attack.targetPower})`)
    }

    // 清理"本次战斗"过期的效果
    this._expireEffects('END_OF_BATTLE')
    
    // Clear pending attack
    this.pendingAttack = null
    this.battleStep = BATTLE_STEPS.NONE
    this.pendingCounterPower = 0
    this.stagedCounterCards = []

    return result
  }

  /**
   * 响应生命牌触发效果
   * @param {string} socketId - 玩家ID
   * @param {boolean} activate - 是否发动触发效果
   * @returns {object} - { success, message, ... }
   */
  respondToTrigger(socketId, activate) {
    const trigger = this.pendingTrigger
    if (!trigger) {
      return { success: false, message: 'No pending trigger' }
    }
    if (trigger.playerId !== socketId) {
      return { success: false, message: 'Not your trigger' }
    }

    const player = this._getPlayer(socketId)
    const opponent = this._getOpponent(socketId)
    const card = trigger.card

    let result = {
      success: true,
      activated: activate,
      cardNumber: card.cardNumber,
      cardName: card.nameCn || card.name,
    }

    if (activate) {
      // 发动触发效果
      this._log(`[Trigger] ${card.nameCn || card.name} 触发效果发动!`)
      
      // 执行 TRIGGER 脚本
      const triggerResults = this.scriptEngine.executeTrigger(TRIGGER_TYPES.TRIGGER, {
        sourceCard: card,
        player: player,
        opponent: opponent,
      })
      
      console.log(`[Engine] TRIGGER results:`, JSON.stringify(triggerResults))
      result.scriptResults = triggerResults
      
      // 检查是否有需要玩家交互的效果
      if (this.pendingEffect) {
        result.hasPendingEffect = true
      }
      
      // 发动触发效果后，卡牌进入墓地
      player.trash.push(card)
      this._log(`${card.nameCn || card.name} 进入废弃区`)
    } else {
      // 跳过触发效果，卡牌加入手牌
      this._log(`[Trigger] ${card.nameCn || card.name} 触发效果被跳过`)
      player.hand.push(card)
      this._log(`${card.nameCn || card.name} 加入手牌`)
    }

    // 检查是否还有剩余伤害要处理（双重攻击）
    const ctx = trigger.battleContext
    if (ctx.remainingDamage > 0 && player.life.length > 0) {
      // 继续处理剩余伤害
      const nextLifeCard = player.life.pop()
      nextLifeCard.faceDown = false
      
      const hasScriptTrigger = nextLifeCard.trigger && this._hasTriggerScript(nextLifeCard.cardNumber)
      
      if (hasScriptTrigger && !ctx.hasBanish) {
        // 下一张生命牌也有触发效果
        this._log(`[Trigger] ${nextLifeCard.nameCn || nextLifeCard.name} 翻开! 可选择发动触发效果`)
        this.pendingTrigger = {
          card: nextLifeCard,
          playerId: player.id,
          triggerText: nextLifeCard.trigger,
          battleContext: {
            ...ctx,
            remainingDamage: ctx.remainingDamage - 1,
          },
        }
        result.nextTrigger = {
          cardNumber: nextLifeCard.cardNumber,
          cardName: nextLifeCard.nameCn || nextLifeCard.name,
          triggerText: nextLifeCard.trigger,
          instanceId: nextLifeCard.instanceId,
        }
        return result
      }
      
      // 无触发效果，直接加入手牌
      if (nextLifeCard.trigger) {
        this._log(`[Trigger] ${nextLifeCard.nameCn || nextLifeCard.name}: ${nextLifeCard.trigger} (无脚本实现)`)
      }
      player.hand.push(nextLifeCard)
      this._log(`${nextLifeCard.nameCn || nextLifeCard.name} 加入手牌`)
    }

    // 清除 pendingTrigger
    this.pendingTrigger = null
    
    // 清理战斗状态（如果所有伤害处理完毕）
    this._expireEffects('END_OF_BATTLE')
    this.pendingAttack = null
    this.battleStep = BATTLE_STEPS.NONE
    this.pendingCounterPower = 0
    this.stagedCounterCards = []
    
    result.lifeRemaining = player.life.length
    return result
  }

  // =====================
  // UTILITY ACTIONS (Semi-automatic board)
  // =====================

  /**
   * Draw cards (utility action for effects)
   */
  drawCards(socketId, count = 1) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    const drawn = []
    for (let i = 0; i < count; i++) {
      if (this._drawCard(player)) {
        drawn.push(player.hand[player.hand.length - 1])
      }
    }
    
    this._log(`${player.name} draws ${drawn.length} card(s) (effect)`)
    return { success: true, drawnCount: drawn.length }
  }

  /**
   * KO a target character (utility action)
   */
  koTarget(socketId, targetPlayerId, targetInstanceId) {
    const targetPlayer = this._getPlayer(targetPlayerId)
    if (!targetPlayer) return { success: false, message: 'Target player not found' }

    const charIndex = targetPlayer.characters.findIndex(c => c.card.instanceId === targetInstanceId)
    if (charIndex === -1) return { success: false, message: 'Character not found' }

    const [charSlot] = targetPlayer.characters.splice(charIndex, 1)

    // 归还附着的 DON 到费用区
    if (charSlot.attachedDon > 0) {
      targetPlayer.donRested += charSlot.attachedDon
      this._log(`${charSlot.attachedDon} attached DON!! returned to cost area`)
      charSlot.attachedDon = 0
    }

    // 触发 ON_KO 脚本
    const opponent = this._getOpponent(targetPlayerId)
    this.scriptEngine.executeTrigger(TRIGGER_TYPES.ON_KO, {
      sourceCard: charSlot.card,
      sourceSlot: charSlot,
      player: targetPlayer,
      opponent,
    })

    targetPlayer.trash.push(charSlot.card)
    
    // 注销被 KO 卡牌的脚本
    this.scriptEngine.unregisterCard(targetInstanceId)

    this._log(`${charSlot.card.nameCn || charSlot.card.name} is KO'd (effect)`)
    return { success: true, koCard: charSlot.card }
  }

  /**
   * Bounce card to hand (utility action)
   */
  bounceToHand(socketId, targetPlayerId, targetInstanceId) {
    const targetPlayer = this._getPlayer(targetPlayerId)
    if (!targetPlayer) return { success: false, message: 'Target player not found' }

    const charIndex = targetPlayer.characters.findIndex(c => c.card.instanceId === targetInstanceId)
    if (charIndex === -1) return { success: false, message: 'Character not found' }

    const [charSlot] = targetPlayer.characters.splice(charIndex, 1)

    // 归还附着的 DON 到费用区
    if (charSlot.attachedDon > 0) {
      targetPlayer.donRested += charSlot.attachedDon
      this._log(`${charSlot.attachedDon} attached DON!! returned to cost area`)
      charSlot.attachedDon = 0
    }

    targetPlayer.hand.push(charSlot.card)

    // 注销离场卡牌的脚本
    this.scriptEngine.unregisterCard(targetInstanceId)

    this._log(`${charSlot.card.nameCn || charSlot.card.name} returned to hand (effect)`)
    return { success: true, returnedCard: charSlot.card }
  }

  /**
   * Move card to bottom of deck (utility action)
   */
  bounceToBottom(socketId, targetPlayerId, targetInstanceId) {
    const targetPlayer = this._getPlayer(targetPlayerId)
    if (!targetPlayer) return { success: false, message: 'Target player not found' }

    const charIndex = targetPlayer.characters.findIndex(c => c.card.instanceId === targetInstanceId)
    if (charIndex === -1) return { success: false, message: 'Character not found' }

    const [charSlot] = targetPlayer.characters.splice(charIndex, 1)

    // 归还附着的 DON 到费用区
    if (charSlot.attachedDon > 0) {
      targetPlayer.donRested += charSlot.attachedDon
      this._log(`${charSlot.attachedDon} attached DON!! returned to cost area`)
      charSlot.attachedDon = 0
    }

    targetPlayer.deck.unshift(charSlot.card) // Add to bottom (array start)

    // 注销离场卡牌的脚本
    this.scriptEngine.unregisterCard(targetInstanceId)

    this._log(`${charSlot.card.nameCn || charSlot.card.name} placed at bottom of deck (effect)`)
    return { success: true, movedCard: charSlot.card }
  }

  /**
   * Recover card from trash (utility action)
   */
  recoverFromTrash(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    const trashIndex = player.trash.findIndex(c => c.instanceId === cardInstanceId)
    if (trashIndex === -1) return { success: false, message: 'Card not in trash' }

    const [card] = player.trash.splice(trashIndex, 1)
    player.hand.push(card)

    this._log(`${player.name} recovers ${card.nameCn || card.name} from trash`)
    return { success: true, recoveredCard: card }
  }

  /**
   * Play a character from trash to the board (utility action)
   */
  playFromTrash(socketId, cardInstanceId, desiredState = CARD_STATES.ACTIVE) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    if (player.characters.length >= GAME_CONFIG.MAX_CHARACTERS) {
      return { success: false, message: 'Character slots full (max 5)' }
    }

    const trashIndex = player.trash.findIndex(c => c.instanceId === cardInstanceId)
    if (trashIndex === -1) return { success: false, message: 'Card not in trash' }

    const [card] = player.trash.splice(trashIndex, 1)
    if (card.cardType !== CARD_TYPES.CHARACTER) {
      player.trash.push(card)
      return { success: false, message: 'Not a character card' }
    }

    const nextState = desiredState === CARD_STATES.RESTED ? CARD_STATES.RESTED : CARD_STATES.ACTIVE
    player.characters.push({
      card,
      attachedDon: 0,
      state: nextState,
      canAttackThisTurn: false,
    })

    this._log(`${player.name} plays ${card.nameCn || card.name} from trash (${nextState})`)
    return { success: true, cardPlayed: card }
  }

  /**
   * Modify power temporarily (utility action)
   */
  modifyPower(socketId, targetId, delta) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    // Store in powerMods map (cleared at end of turn)
    const current = player.powerMods.get(targetId) || 0
    player.powerMods.set(targetId, current + delta)

    this._log(`Power modified: ${targetId} ${delta > 0 ? '+' : ''}${delta}`)
    return { success: true, newModifier: current + delta }
  }

  /**
   * Trash a card from hand (utility action)
   */
  trashFromHand(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    const cardIndex = player.hand.findIndex(c => c.instanceId === cardInstanceId)
    if (cardIndex === -1) return { success: false, message: 'Card not in hand' }

    const [card] = player.hand.splice(cardIndex, 1)
    player.trash.push(card)

    this._log(`${player.name} trashes ${card.nameCn || card.name} from hand`)
    return { success: true, trashedCard: card }
  }

  /**
   * Rest a target (utility action)
   */
  restTarget(socketId, targetId) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    if (targetId === 'leader') {
      player.leader.state = CARD_STATES.RESTED
    } else {
      const charSlot = player.characters.find(c => c.card.instanceId === targetId)
      if (charSlot) {
        charSlot.state = CARD_STATES.RESTED
      }
    }

    this._log(`${player.name} rests a card`)
    return { success: true }
  }

  /**
   * Activate a target (utility action)
   */
  activateTarget(socketId, targetId) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    if (targetId === 'leader') {
      player.leader.state = CARD_STATES.ACTIVE
    } else {
      const charSlot = player.characters.find(c => c.card.instanceId === targetId)
      if (charSlot) {
        charSlot.state = CARD_STATES.ACTIVE
      }
    }

    this._log(`${player.name} activates a card`)
    return { success: true }
  }

  /**
   * View top N cards of own deck (utility action for search effects)
   * Returns the cards without removing them from the deck
   */
  viewTopDeck(socketId, count = 1) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    const actual = Math.min(count, player.deck.length)
    // Top of deck is the end of the array
    const topCards = player.deck.slice(-actual).reverse().map(c => this._sanitizeCard(c))
    this._log(`${player.name} views top ${actual} cards of deck`)
    return { success: true, cards: topCards }
  }

  /**
   * Resolve a search: reveal selected cards to hand, send rest to bottom of deck
   * selectedIds = cards the player chose (add to hand)
   * bottomIds = cards to put back to bottom (in order given)
   */
  resolveSearch(socketId, selectedIds = [], bottomIds = []) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    // 获取检索效果的过滤条件（如果有）
    const effect = this.pendingEffect
    const filter = effect?.type === 'SEARCH' && effect?.playerId === socketId ? effect.filter : null
    const maxSelect = effect?.maxSelect || 1

    if (selectedIds.length > maxSelect) {
      return { success: false, message: `最多只能选择${maxSelect}张卡加入手牌` }
    }

    // All IDs must be in the top of the deck
    const allIds = [...selectedIds, ...bottomIds]
    const viewedCount = effect?.viewedCount || allIds.length
    const topCards = player.deck.slice(-viewedCount)
    const topCardIds = topCards.map(c => c.instanceId)
    
    for (const id of allIds) {
      if (!topCardIds.includes(id)) {
        return { success: false, message: `Card ${id} not in viewed cards` }
      }
    }

    // 验证选中的卡符合过滤条件
    if (filter && selectedIds.length > 0) {
      for (const id of selectedIds) {
        const card = topCards.find(c => c.instanceId === id)
        if (!card) continue

        // 检查特征过滤
        if (filter.trait) {
          const cardTrait = card.trait || ''
          if (!cardTrait.includes(filter.trait)) {
            return { success: false, message: `选择的卡牌必须拥有《${filter.trait}》特征` }
          }
        }

        // 检查排除的卡号
        if (filter.excludeCardNumber) {
          if (card.cardNumber === filter.excludeCardNumber) {
            return { success: false, message: `不能选择此卡牌` }
          }
        }

        // 检查颜色过滤
        if (filter.color && card.color !== filter.color) {
          return { success: false, message: `选择的卡牌必须是${filter.color}色` }
        }

        // 检查费用过滤
        if (filter.maxCost !== undefined && (card.cost || 0) > filter.maxCost) {
          return { success: false, message: `选择的卡牌费用不能超过${filter.maxCost}` }
        }
      }
    }

    // Remove all viewed cards from deck
    const removed = []
    for (const id of allIds) {
      const idx = player.deck.findIndex(c => c.instanceId === id)
      if (idx !== -1) {
        removed.push(...player.deck.splice(idx, 1))
      }
    }

    // Add selected to hand
    for (const id of selectedIds) {
      const card = removed.find(c => c.instanceId === id)
      if (card) {
        player.hand.push(card)
        this._log(`${player.name} adds ${card.nameCn || card.name} to hand (from deck search)`)
      }
    }

    // Add bottom cards to bottom of deck (beginning of array)
    for (const id of bottomIds.reverse()) {
      const card = removed.find(c => c.instanceId === id)
      if (card) {
        player.deck.unshift(card)
      }
    }

    if (bottomIds.length > 0) {
      this._log(`${player.name} puts ${bottomIds.length} card(s) to bottom of deck`)
    }

    // 清除检索效果
    if (effect?.type === 'SEARCH' && effect?.playerId === socketId) {
      this.pendingEffect = null
    }

    return { success: true }
  }

  /**
   * Take a Life card and add it to hand (for effects like Whitebeard end-of-turn)
   * lifeIndex: 0 = top Life card
   */
  lifeToHand(socketId, lifeIndex = 0) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    // 检查效果限制
    if (player.effectRestrictions?.cannotLifeToHand) {
      return { success: false, message: '本回合无法通过效果将生命牌加入手牌' }
    }

    if (player.life.length === 0) {
      return { success: false, message: 'No Life cards remaining' }
    }

    const idx = Math.min(lifeIndex, player.life.length - 1)
    const [card] = player.life.splice(idx, 1)
    player.hand.push(card)

    this._log(`${player.name} takes a Life card to hand (Life: ${player.life.length})`)
    return { success: true, card: this._sanitizeCard(card) }
  }

  /**
   * Set an effect restriction for the current player (e.g., OP02-004 登场效果)
   * @param socketId - Player socket ID
   * @param restriction - Restriction key (e.g., 'cannotLifeToHand')
   * @param value - true to enable, false to disable
   */
  setEffectRestriction(socketId, restriction, value = true) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }
    
    if (!player.effectRestrictions) {
      player.effectRestrictions = {}
    }
    
    const validRestrictions = ['cannotLifeToHand']
    if (!validRestrictions.includes(restriction)) {
      return { success: false, message: `Invalid restriction: ${restriction}` }
    }
    
    player.effectRestrictions[restriction] = value
    
    if (value) {
      this._log(`[效果限制] ${player.name}: 本回合禁止通过效果将生命牌加入手牌`)
    } else {
      this._log(`[效果限制] ${player.name}: 限制已解除`)
    }
    
    return { success: true }
  }

  /**
   * Search own deck with filter and return matching cards for player to choose
   */
  searchDeckFiltered(socketId, filter = {}) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    let matches = player.deck.map(c => this._sanitizeCard(c))
    
    if (filter.cardType) {
      matches = matches.filter(c => c.cardType === filter.cardType)
    }
    if (filter.cost != null) {
      matches = matches.filter(c => c.cost != null && c.cost <= filter.cost)
    }
    if (filter.color) {
      matches = matches.filter(c => c.color === filter.color)
    }
    if (filter.trait) {
      matches = matches.filter(c => c.trait && c.trait.includes(filter.trait))
    }

    this._log(`${player.name} searches deck (${matches.length} matches)`)
    return { success: true, cards: matches }
  }

  /**
   * Pick a card from deck search results and add to hand, then shuffle deck
   */
  pickFromDeck(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    const idx = player.deck.findIndex(c => c.instanceId === cardInstanceId)
    if (idx === -1) return { success: false, message: 'Card not in deck' }

    const [card] = player.deck.splice(idx, 1)
    player.hand.push(card)

    // Shuffle deck after search
    for (let i = player.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [player.deck[i], player.deck[j]] = [player.deck[j], player.deck[i]]
    }

    this._log(`${player.name} picks ${card.nameCn || card.name} from deck (deck shuffled)`)
    return { success: true, card: this._sanitizeCard(card) }
  }

  /**
   * Add a card from trash to Life area (for specific effects)
   */
  trashToLife(socketId, cardInstanceId) {
    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }

    const idx = player.trash.findIndex(c => c.instanceId === cardInstanceId)
    if (idx === -1) return { success: false, message: 'Card not in trash' }

    const [card] = player.trash.splice(idx, 1)
    player.life.push(card)

    this._log(`${player.name} adds ${card.nameCn || card.name} from trash to Life (Life: ${player.life.length})`)
    return { success: true }
  }

  // =====================
  // PENDING EFFECT (玩家交互)
  // =====================

  /**
   * 解决待决效果: 玩家选择目标
   */
  resolveEffectTarget(socketId, targetInstanceId) {
    if (!this.pendingEffect) return { success: false, message: 'No pending effect' }
    if (this.pendingEffect.playerId !== socketId) return { success: false, message: 'Not your effect' }

    const player = this._getPlayer(socketId)
    if (!player) return { success: false, message: 'Player not found' }
    const effect = this.pendingEffect

    if (effect.type === 'ATTACH_DON') {
      // 找到目标 slot
      let targetSlot = null
      if (targetInstanceId === 'leader') {
        targetSlot = player.leader
      } else {
        targetSlot = player.characters.find(c => c.card.instanceId === targetInstanceId)
      }
      if (!targetSlot) return { success: false, message: 'Target not found' }

      // 从休息 DON 池分配
      if (player.donRested <= 0) {
        this._log(`[效果] 没有可用的休息 DON!!，效果结束`)
        this.pendingEffect = null
        return { success: true, effectComplete: true }
      }

      player.donRested -= 1
      targetSlot.attachedDon += 1
      effect.remaining -= 1

      const targetName = targetSlot.card.nameCn || targetSlot.card.name
      this._log(`[效果] ${effect.sourceCardName}: 给 ${targetName} 贴 1 DON!!`)

      if (effect.remaining <= 0 || player.donRested <= 0) {
        this.pendingEffect = null
        return { success: true, effectComplete: true }
      }

      return { success: true, effectComplete: false }
    }

    return { success: false, message: 'Unknown effect type' }
  }

  /**
   * 跳过待决效果
   */
  skipEffect(socketId) {
    if (!this.pendingEffect) return { success: false, message: 'No pending effect' }
    if (this.pendingEffect.playerId !== socketId) return { success: false, message: 'Not your effect' }

    this._log(`[效果] ${this.pendingEffect.sourceCardName}: 效果跳过`)
    this.pendingEffect = null
    return { success: true }
  }

  // =====================
  // STATE & HELPERS
  // =====================

  getState() {
    return {
      phase: this.phase,
      battleStep: this.battleStep,
      turnNumber: this.turnNumber,
      currentTurn: this.players[this.currentTurnIndex]?.id,
      pendingAttack: this.pendingAttack,
      pendingEffect: this.pendingEffect,
      pendingTrigger: this.pendingTrigger ? {
        cardNumber: this.pendingTrigger.card?.cardNumber,
        cardName: this.pendingTrigger.card?.nameCn || this.pendingTrigger.card?.name,
        triggerText: this.pendingTrigger.triggerText,
        playerId: this.pendingTrigger.playerId,
        card: this.pendingTrigger.card ? this._sanitizeCard(this.pendingTrigger.card) : null,
      } : null,
      pendingCounterPower: this.pendingCounterPower, // 当前累计的反击力量
      stagedCounterCards: this.stagedCounterCards,   // 暂存的反击卡（可撤销）
      activeEffects: this.activeEffects,             // 当前生效中的效果
      winner: this.winner,
      diceRolls: this.diceRolls, // 骰子结果（仅游戏开始时有意义）
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        leader: {
          card: this._sanitizeCard(p.leader.card),
          attachedDon: p.leader.attachedDon,
          state: p.leader.state,
          power: this._calculatePower(p.leader.card, p.leader, p),
          hasActivateMain: this.scriptEngine.canActivateMain(p.leader.card, p),
        },
        characters: p.characters.map(c => ({
          card: this._sanitizeCard(c.card),
          attachedDon: c.attachedDon,
          state: c.state,
          canAttackThisTurn: c.canAttackThisTurn,
          power: this._calculatePower(c.card, c, p),
          hasActivateMain: this.scriptEngine.canActivateMain(c.card, p),
        })),
        stage: p.stage ? { card: this._sanitizeCard(p.stage.card) } : null,
        lifeCount: p.life.length,
        deckCount: p.deck.length,
        hand: p.hand.map(c => this._sanitizeCard(c)),
        handCount: p.hand.length,
        trash: p.trash.map(c => this._sanitizeCard(c)),
        donDeckCount: p.donDeckCount,
        donActive: p.donActive,
        donRested: p.donRested,
      })),
      actionLog: this.actionLog.slice(-20), // Last 20 actions
    }
  }

  /**
   * Get state for a specific player (hides opponent hand)
   */
  getStateForPlayer(socketId) {
    const state = this.getState()
    const playerIndex = this.players.findIndex(p => p.id === socketId)
    
    if (playerIndex === -1) return state

    const opponentIndex = 1 - playerIndex
    // Hide opponent's hand cards
    state.players[opponentIndex].hand = state.players[opponentIndex].hand.map(() => ({ hidden: true }))
    
    // Mark which player is "self"
    state.players[playerIndex].isSelf = true
    state.players[opponentIndex].isSelf = false

    return state
  }

  _sanitizeCard(card) {
    return {
      instanceId: card.instanceId,
      cardNumber: card.cardNumber,
      name: card.name,
      nameCn: card.nameCn,
      cardType: card.cardType,
      color: card.color,
      cost: card.cost,
      power: card.power,
      counter: card.counter,
      life: card.life,
      attribute: card.attribute,
      attributeCn: card.attributeCn,
      effect: card.effect,
      trigger: card.trigger,
      trait: card.trait,
      traitCn: card.traitCn,
      rarity: card.rarity,
      imageUrl: card.imageUrl,
      effectScript: card.effectScript,
    }
  }

  _calculatePower(card, slot, ownerPlayer = null) {
    const basePower = card.power || 0
    const isOwnerTurn = ownerPlayer
      ? this.players[this.currentTurnIndex]?.id === ownerPlayer.id
      : false
    const donBonus = isOwnerTurn
      ? (slot?.attachedDon || 0) * GAME_CONFIG.POWER_PER_DON
      : 0
    const manualBonus = ownerPlayer
      ? (ownerPlayer.powerMods.get(card.instanceId) || 0)
      : 0
    let leaderBonus = 0
    
    // 领袖效果: OP01-001 索隆 - 【咚!!×1】我方回合中所有角色+1000
    if (ownerPlayer && card.cardType !== '领袖' && card.cardType !== 'LEADER') {
      const leader = ownerPlayer.leader
      if (leader.card.cardNumber === 'OP01-001' && leader.attachedDon >= 1) {
        // 检查是否是该玩家的回合
        if (isOwnerTurn) {
          leaderBonus = 1000
        }
      }
    }

    // CONSTANT 效果的动态力量（如 P-006 路飞）
    let dynamicPowerBonus = 0
    if (ownerPlayer && this.scriptEngine) {
      dynamicPowerBonus = this.scriptEngine.getDynamicPower(card, slot, ownerPlayer)
    }
    
    return basePower + donBonus + leaderBonus + manualBonus + dynamicPowerBonus
  }

  _hasKeyword(card, keyword) {
    if (!card.effect) return false
    const effectText = card.effect.toLowerCase()
    const key = keyword.toLowerCase()
    if (effectText.includes(key)) return true
    if (keyword === KEYWORDS.BLOCKER) {
      return effectText.includes('阻挡')
    }
    if (keyword === KEYWORDS.RUSH) {
      return effectText.includes('速攻')
    }
    return false
  }

  /**
   * 检查卡牌是否有动态关键词（通过脚本条件获得）
   * 例如 OP02-008: [Don!! x1] 生命<=2 且领袖是白胡子海盗团时获得速攻
   */
  _hasDynamicKeyword(card, slot, player, keyword) {
    return this.scriptEngine.hasDynamicKeyword(card, slot, player, keyword)
  }

  /**
   * 检查卡牌是否有 TRIGGER 脚本
   * @param {string} cardNumber - 卡号
   * @returns {boolean}
   */
  _hasTriggerScript(cardNumber) {
    return this.scriptEngine.hasScript(cardNumber, TRIGGER_TYPES.TRIGGER)
  }

  _drawCard(player) {
    if (player.deck.length === 0) return false
    const card = player.deck.pop()
    player.hand.push(card)
    return true
  }

  _getCurrentPlayer() {
    return this.players[this.currentTurnIndex]
  }

  _getPlayer(socketId) {
    return this.players.find(p => p.id === socketId)
  }

  _getOpponent(socketId) {
    return this.players.find(p => p.id !== socketId)
  }

  _isCurrentTurn(socketId) {
    return this.players[this.currentTurnIndex]?.id === socketId
  }

  _genId(prefix = 'card') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  _log(message) {
    const entry = {
      turn: this.turnNumber,
      phase: this.phase,
      message,
      timestamp: Date.now(),
    }
    this.actionLog.push(entry)
    console.log(`[Turn ${this.turnNumber}] ${message}`)
  }

  /**
   * 处理效果过期
   * @param {string} expiryType - 过期类型: END_OF_BATTLE, END_OF_TURN, OPPONENT_START
   */
  _expireEffects(expiryType) {
    // 移除过期的效果
    const expiring = this.activeEffects.filter(e => e.expiry === expiryType)
    
    for (const effect of expiring) {
      // 撤销力量修改
      if (effect.type === 'POWER_MOD' && effect.targetId) {
        // 找到目标并撤销修改
        for (const player of this.players) {
          if (player.powerMods?.has(effect.targetId)) {
            const current = player.powerMods.get(effect.targetId) || 0
            player.powerMods.set(effect.targetId, current - (effect.amount || 0))
            this._log(`效果过期: ${effect.sourceName} 的力量加成消失`)
          }
        }
      }
    }
    
    // 过滤掉已过期的效果
    this.activeEffects = this.activeEffects.filter(e => e.expiry !== expiryType)
  }

  /**
   * 注册一个带过期条件的效果
   * @param {Object} effect - { type, targetId, amount, expiry, sourceName }
   */
  registerEffect(effect) {
    this.activeEffects.push({
      ...effect,
      registeredAt: Date.now(),
      turnRegistered: this.turnNumber,
    })
  }
}
