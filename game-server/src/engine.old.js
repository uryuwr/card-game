import { CARD_POOL } from './cards.js'

export class GameEngine {
  constructor(room) {
    this.room = room
    this.players = []
    this.currentTurnIndex = 0
    this.turnNumber = 0
    this.winner = null
  }

  startGame() {
    // 为每个玩家初始化状态
    this.players = this.room.players.map((p, index) => ({
      id: p.socketId,
      name: p.name,
      health: 30,
      mana: 0,
      maxMana: 0,
      hand: [],
      field: [],
      deck: this._buildDeck(),
    }))

    // 各抽 3 张初始手牌
    this.players.forEach((p) => {
      for (let i = 0; i < 3; i++) {
        this._drawCard(p)
      }
    })

    // 先手玩家获得 1 费
    this.currentTurnIndex = 0
    this._startTurn()

    return this.getState()
  }

  playCard(socketId, cardId, targetId) {
    const player = this._getPlayer(socketId)
    if (!player || !this._isCurrentTurn(socketId)) {
      return { success: false, message: '不是你的回合' }
    }

    const cardIndex = player.hand.findIndex((c) => c.id === cardId)
    if (cardIndex === -1) {
      return { success: false, message: '手牌不存在' }
    }

    const card = player.hand[cardIndex]
    if (card.cost > player.mana) {
      return { success: false, message: '法力值不足' }
    }

    // 扣费，从手牌移到场上
    player.mana -= card.cost
    player.hand.splice(cardIndex, 1)

    if (card.type === 'creature') {
      if (player.field.length >= 7) {
        return { success: false, message: '场上随从已满' }
      }
      player.field.push({ ...card, canAttack: false })
    } else if (card.type === 'spell') {
      // 简单法术效果：对对手造成 attack 点伤害
      const opponent = this._getOpponent(socketId)
      if (opponent) {
        opponent.health -= card.attack
        this._checkWinner()
      }
    }

    return { success: true }
  }

  attack(socketId, attackerId, targetId) {
    const player = this._getPlayer(socketId)
    const opponent = this._getOpponent(socketId)
    if (!player || !opponent || !this._isCurrentTurn(socketId)) {
      return { success: false, message: '不是你的回合' }
    }

    const attacker = player.field.find((c) => c.id === attackerId)
    if (!attacker || !attacker.canAttack) {
      return { success: false, message: '该随从无法攻击' }
    }

    if (targetId === 'hero') {
      // 攻击英雄
      opponent.health -= attacker.attack
    } else {
      // 攻击随从
      const target = opponent.field.find((c) => c.id === targetId)
      if (!target) return { success: false, message: '目标不存在' }

      target.health -= attacker.attack
      attacker.health -= target.attack

      // 移除死亡随从
      if (target.health <= 0) {
        opponent.field = opponent.field.filter((c) => c.id !== targetId)
      }
      if (attacker.health <= 0) {
        player.field = player.field.filter((c) => c.id !== attackerId)
      }
    }

    attacker.canAttack = false
    this._checkWinner()
    return { success: true }
  }

  endTurn(socketId) {
    if (!this._isCurrentTurn(socketId)) return

    this.currentTurnIndex = 1 - this.currentTurnIndex
    this._startTurn()
  }

  getState() {
    return {
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        health: p.health,
        mana: p.mana,
        maxMana: p.maxMana,
        hand: p.hand,
        field: p.field,
        deckCount: p.deck.length,
      })),
      currentTurn: this.players[this.currentTurnIndex]?.id,
      winner: this.winner,
    }
  }

  // ---- 内部方法 ----
  _startTurn() {
    const player = this.players[this.currentTurnIndex]
    this.turnNumber++

    // 增加法力水晶（最多 10）
    if (player.maxMana < 10) player.maxMana++
    player.mana = player.maxMana

    // 抽一张牌
    this._drawCard(player)

    // 场上随从可以攻击
    player.field.forEach((c) => (c.canAttack = true))
  }

  _drawCard(player) {
    if (player.deck.length === 0) return
    const card = player.deck.pop()
    if (player.hand.length < 10) {
      player.hand.push(card)
    }
  }

  _buildDeck() {
    // 从卡池中随机选 20 张组成一副牌
    const deck = []
    for (let i = 0; i < 20; i++) {
      const template = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)]
      deck.push({
        ...template,
        id: `${template.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })
    }
    // 洗牌
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }
    return deck
  }

  _getPlayer(socketId) {
    return this.players.find((p) => p.id === socketId)
  }

  _getOpponent(socketId) {
    return this.players.find((p) => p.id !== socketId)
  }

  _isCurrentTurn(socketId) {
    return this.players[this.currentTurnIndex]?.id === socketId
  }

  _checkWinner() {
    for (const p of this.players) {
      if (p.health <= 0) {
        this.winner = this.players.find((o) => o.id !== p.id)?.id
        break
      }
    }
  }
}
