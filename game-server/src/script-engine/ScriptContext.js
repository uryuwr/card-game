/**
 * ScriptContext - 脚本执行上下文
 * 为卡牌脚本提供安全的引擎访问代理
 */
export class ScriptContext {
  /**
   * @param {import('../engine.js').GameEngine} engine
   * @param {object} triggerInfo - { triggerType, sourceCard, sourceSlot, player, opponent }
   */
  constructor(engine, triggerInfo) {
    this.engine = engine
    this.triggerType = triggerInfo.triggerType
    this.sourceCard = triggerInfo.sourceCard
    this.sourceSlot = triggerInfo.sourceSlot
    this.player = triggerInfo.player
    this.opponent = triggerInfo.opponent
  }

  // =====================
  // 玩家查询
  // =====================

  /** 获取触发效果的卡牌所属玩家 */
  getCurrentPlayer() {
    return this.player
  }

  /** 获取对手玩家 */
  getOpponent() {
    return this.opponent
  }

  /** 获取当前回合玩家 */
  getTurnPlayer() {
    return this.engine._getCurrentPlayer()
  }

  /** 是否是该玩家的回合 */
  isMyTurn() {
    return this.engine._isCurrentTurn(this.player.id)
  }

  // =====================
  // 卡牌查询
  // =====================

  /** 获取玩家的领袖 */
  getLeader(player = null) {
    const p = player || this.player
    return p.leader
  }

  /** 查找角色在场上的 slot */
  findCharacterSlot(instanceId, player = null) {
    const p = player || this.player
    return p.characters.find(c => c.card.instanceId === instanceId) || null
  }

  /** 获取所有己方角色 */
  getMyCharacters() {
    return this.player.characters
  }

  /** 获取所有对手角色 */
  getOpponentCharacters() {
    return this.opponent.characters
  }

  /** 获取触发源卡牌的 slot（角色/领袖） */
  getSourceSlot() {
    return this.sourceSlot
  }

  /** 获取触发源卡牌数据 */
  getSourceCard() {
    return this.sourceCard
  }

  // =====================
  // DON 查询
  // =====================

  /** 获取源卡牌的绑定 DON 数 */
  getSourceDon() {
    return this.sourceSlot?.attachedDon || 0
  }

  /** 获取玩家可用 DON */
  getActiveDon(player = null) {
    const p = player || this.player
    return p.donActive
  }

  // =====================
  // 游戏状态查询
  // =====================

  /** 获取玩家生命数 */
  getLifeCount(player = null) {
    const p = player || this.player
    return p.life.length
  }

  /** 获取当前战斗信息 */
  getPendingAttack() {
    return this.engine.pendingAttack
  }

  /** 获取 effectRestrictions */
  getEffectRestrictions(player = null) {
    const p = player || this.player
    return p.effectRestrictions || {}
  }

  // =====================
  // 工具方法
  // =====================

  /** 输出日志 */
  log(message) {
    this.engine._log(`[技能] ${message}`)
  }

  /** 计算角色力量 */
  calculatePower(card, slot, owner) {
    return this.engine._calculatePower(card, slot, owner)
  }

  /** 检查关键词 */
  hasKeyword(card, keyword) {
    return this.engine._hasKeyword(card, keyword)
  }
}
