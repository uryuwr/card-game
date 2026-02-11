/**
 * TriggerSystem - 触发器注册与管理
 * 管理卡牌脚本的注册、触发、注销
 */

/** 支持的触发器类型 */
export const TRIGGER_TYPES = {
  ON_PLAY: 'ON_PLAY',
  ON_ATTACK: 'ON_ATTACK',
  ON_BLOCK: 'ON_BLOCK',
  ON_KO: 'ON_KO',
  TURN_END: 'TURN_END',
  ACTIVATE_MAIN: 'ACTIVATE_MAIN',
  CONSTANT: 'CONSTANT',
  COUNTER: 'COUNTER',  // 反击阶段使用事件卡
}

export class TriggerSystem {
  constructor() {
    /**
     * Map<triggerType, Map<instanceId, ScriptEntry>>
     * ScriptEntry = { instanceId, cardNumber, playerId, script }
     */
    this.triggers = new Map()

    // 初始化所有触发器类型
    for (const type of Object.values(TRIGGER_TYPES)) {
      this.triggers.set(type, new Map())
    }
  }

  /**
   * 注册一张卡的脚本到对应的触发器
   * @param {string} triggerType - TRIGGER_TYPES 之一
   * @param {string} instanceId - 卡牌实例ID
   * @param {string} cardNumber - 卡号 (如 'ST01-011')
   * @param {string} playerId - 所属玩家 socketId
   * @param {object} script - 脚本定义 { conditions, actions }
   */
  register(triggerType, instanceId, cardNumber, playerId, script) {
    const bucket = this.triggers.get(triggerType)
    if (!bucket) {
      console.warn(`[TriggerSystem] Unknown trigger type: ${triggerType}`)
      return
    }

    bucket.set(instanceId, {
      instanceId,
      cardNumber,
      playerId,
      script,
    })

    console.log(`[TriggerSystem] Registered ${cardNumber} (${instanceId}) -> ${triggerType}`)
  }

  /**
   * 注销一张卡的所有触发器
   * @param {string} instanceId
   */
  unregister(instanceId) {
    let removed = 0
    for (const [type, bucket] of this.triggers) {
      if (bucket.delete(instanceId)) {
        removed++
      }
    }
    if (removed > 0) {
      console.log(`[TriggerSystem] Unregistered ${instanceId} from ${removed} trigger(s)`)
    }
  }

  /**
   * 注销某个玩家的所有触发器
   * @param {string} playerId
   */
  unregisterPlayer(playerId) {
    for (const [type, bucket] of this.triggers) {
      for (const [instanceId, entry] of bucket) {
        if (entry.playerId === playerId) {
          bucket.delete(instanceId)
        }
      }
    }
  }

  /**
   * 获取某个触发器类型下所有注册的脚本
   * @param {string} triggerType
   * @returns {Array<ScriptEntry>}
   */
  getScripts(triggerType) {
    const bucket = this.triggers.get(triggerType)
    if (!bucket) return []
    return Array.from(bucket.values())
  }

  /**
   * 获取某个触发器类型下特定玩家的脚本
   * @param {string} triggerType
   * @param {string} playerId
   * @returns {Array<ScriptEntry>}
   */
  getScriptsForPlayer(triggerType, playerId) {
    return this.getScripts(triggerType).filter(entry => entry.playerId === playerId)
  }

  /**
   * 获取某张卡注册的所有触发器
   * @param {string} instanceId
   * @returns {Array<{type: string, entry: ScriptEntry}>}
   */
  getTriggersForCard(instanceId) {
    const result = []
    for (const [type, bucket] of this.triggers) {
      const entry = bucket.get(instanceId)
      if (entry) {
        result.push({ type, entry })
      }
    }
    return result
  }

  /** 清空所有触发器 */
  clear() {
    for (const bucket of this.triggers.values()) {
      bucket.clear()
    }
  }

  /** 调试: 打印当前注册状态 */
  dump() {
    for (const [type, bucket] of this.triggers) {
      if (bucket.size > 0) {
        console.log(`[TriggerSystem] ${type}: ${bucket.size} script(s)`)
        for (const entry of bucket.values()) {
          console.log(`  - ${entry.cardNumber} (${entry.instanceId}) [Player: ${entry.playerId}]`)
        }
      }
    }
  }
}
