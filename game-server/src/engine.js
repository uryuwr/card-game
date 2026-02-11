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
import { getCardPool, buildDeckFromCards, fetchDeckFromAPI } from './cards.js'

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
    this.winner = null
    this.actionLog = []
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
   */
  async startGame() {
    console.log('[ENGINE] startGame called')
    
    // Build players from their actual decks
    this.players = []
    for (let index = 0; index < this.room.players.length; index++) {
      const p = this.room.players[index]
      console.log('[ENGINE] Building player', index, 'socketId:', p.socketId, 'deckId:', p.deckId)
      
      let leaderCard, deckCards, lifeCount
      
      // Try to fetch the player's actual deck from API
      if (p.deckId) {
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
      
      console.log('[ENGINE] Leader card:', leaderCard?.cardNumber, 'Deck size:', deckCards.length)
      
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
    
    // 领袖效果: OP02-001 白胡子 - 回合结束时，将生命区最上方1张加入手牌
    if (player.leader.card.cardNumber === 'OP02-001' && player.life.length > 0) {
      // 检查是否被效果限制禁止
      if (player.effectRestrictions?.cannotLifeToHand) {
        this._log(`[领袖效果] ${player.leader.card.nameCn || '白胡子'}: 本回合无法通过效果将生命牌加入手牌（被限制）`)
      } else {
        const [card] = player.life.splice(0, 1) // 取最上方的卡
        player.hand.push(card)
        this._log(`[领袖效果] ${player.leader.card.nameCn || '白胡子'}: 将生命区最上方1张卡牌加入手牌 (剩余生命: ${player.life.length})`)
      }
    }
    
    // 清除本回合的效果限制
    if (player.effectRestrictions) {
      player.effectRestrictions.cannotLifeToHand = false
    }
    
    this._log(`End Phase: ${player.name} ends turn`)
  }

  _nextTurn() {
    this.currentTurnIndex = 1 - this.currentTurnIndex
    this.turnNumber++
    this.pendingAttack = null
    this.battleStep = BATTLE_STEPS.NONE
    this.pendingCounterPower = 0

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
    const hasRush = this._hasKeyword(card, KEYWORDS.RUSH)
    player.characters.push({
      card,
      attachedDon: 0,
      state: CARD_STATES.ACTIVE,
      canAttackThisTurn: hasRush, // Rush allows immediate attack
    })

    this._log(`${player.name} plays ${card.nameCn || card.name} (Cost: ${cost})`)

    // Handle On Play effects (manual action prompt)
    if (this._hasKeyword(card, KEYWORDS.ON_PLAY)) {
      this._log(`[On Play] ${card.nameCn || card.name} effect triggered - execute manually`)
    }

    // OP02-004 爱德华·纽哥特 登场效果：本回合禁止通过效果将生命牌加入手牌
    if (card.cardNumber === 'OP02-004') {
      player.effectRestrictions = player.effectRestrictions || {}
      player.effectRestrictions.cannotLifeToHand = true
      this._log(`[登场效果] ${card.nameCn || '爱德华·纽哥特'}: 本回合无法通过效果将生命牌加入手牌`)
    }

    return { success: true, cardPlayed: card }
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

    this._log(`${player.name} plays Event: ${card.nameCn || card.name} -> Effect: Execute manually`)
    
    return { success: true, cardPlayed: card, effectText: card.effect }
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
    }

    // Check if opponent has blockers
    const hasBlockers = opponent.characters.some(
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
   * Play counter cards (defender response)
   */
  playCounter(socketId, cardInstanceIds, manualPower = 0) {
    const player = this._getPlayer(socketId)
    
    if (!player || !this.pendingAttack || this.battleStep !== BATTLE_STEPS.COUNTER) {
      return { success: false, message: 'Cannot play counter now' }
    }
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot play counter' }
    }

    let totalCounterPower = 0
    const cardsUsed = []

    for (const instanceId of cardInstanceIds) {
      const cardIndex = player.hand.findIndex(c => c.instanceId === instanceId)
      if (cardIndex === -1) continue

      const card = player.hand[cardIndex]
      const counterValue = card.counter || 0
      totalCounterPower += counterValue
      player.hand.splice(cardIndex, 1)
      player.trash.push(card)
      cardsUsed.push(card)
    }

    const appliedPower = totalCounterPower + Math.max(0, manualPower || 0)
    this.pendingCounterPower += appliedPower
    this.pendingAttack.targetPower += appliedPower

    this._log(`Defender uses Counter cards: +${appliedPower} power`)

    return { 
      success: true, 
      counterPower: appliedPower, 
      cardsUsed,
      newTargetPower: this.pendingAttack.targetPower 
    }
  }

  /**
   * Skip counter, resolve battle
   */
  skipCounter(socketId) {
    if (!this.pendingAttack || this.battleStep !== BATTLE_STEPS.COUNTER) {
      return { success: false, message: 'Cannot skip counter now' }
    }
    if (this._isCurrentTurn(socketId)) {
      return { success: false, message: 'Attacker cannot skip counter' }
    }

    return this._resolveBattle()
  }

  /**
   * Resolve the pending attack
   */
  _resolveBattle() {
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
            
            // Check for Trigger effect
            if (lifeCard.trigger) {
              this._log(`[Trigger] ${lifeCard.nameCn || lifeCard.name}: ${lifeCard.trigger}`)
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
          defender.characters = defender.characters.filter(c => c.card.instanceId !== attack.targetInstanceId)
          defender.trash.push(targetSlot.card)
          result.outcome = 'CHARACTER_KO'
          this._log(`${attack.targetCard.nameCn || attack.targetCard.name} is KO'd`)
        }
      }
    } else {
      // Attack blocked
      result.outcome = 'BLOCKED'
      this._log(`Attack blocked! (${attack.attackerPower} < ${attack.targetPower})`)
    }

    // Clear pending attack
    this.pendingAttack = null
    this.battleStep = BATTLE_STEPS.NONE
    this.pendingCounterPower = 0

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
    targetPlayer.trash.push(charSlot.card)

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
    targetPlayer.hand.push(charSlot.card)

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
    targetPlayer.deck.unshift(charSlot.card) // Add to bottom (array start)

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

    if (selectedIds.length > 1) {
      return { success: false, message: '只能选择1张卡加入手牌' }
    }

    // All IDs must be in the top of the deck
    const allIds = [...selectedIds, ...bottomIds]
    const topCards = player.deck.slice(-allIds.length).map(c => c.instanceId)
    for (const id of allIds) {
      if (!topCards.includes(id)) {
        return { success: false, message: `Card ${id} not in viewed cards` }
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
  // STATE & HELPERS
  // =====================

  getState() {
    return {
      phase: this.phase,
      battleStep: this.battleStep,
      turnNumber: this.turnNumber,
      currentTurn: this.players[this.currentTurnIndex]?.id,
      pendingAttack: this.pendingAttack,
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
        },
        characters: p.characters.map(c => ({
          card: this._sanitizeCard(c.card),
          attachedDon: c.attachedDon,
          state: c.state,
          canAttackThisTurn: c.canAttackThisTurn,
          power: this._calculatePower(c.card, c, p),
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
      effect: card.effect,
      trigger: card.trigger,
      trait: card.trait,
      rarity: card.rarity,
      imageUrl: card.imageUrl,
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
    
    return basePower + donBonus + leaderBonus + manualBonus
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
}
