/**
 * 完整功能测试脚本
 * 测试所有修复后的功能
 */

import { GameEngine } from './src/engine.js'
import { TRIGGER_TYPES } from './src/script-engine/TriggerSystem.js'

// 模拟房间
const mockRoom = {
  id: 'test-room',
  players: [
    { socketId: 'player1', name: 'Player 1', deckId: null },
    { socketId: 'player2', name: 'Player 2', deckId: null },
  ],
}

// 测试每回合重置功能
async function testOncePerTurnReset() {
  console.log('\n=== 测试: 山智每回合一次效果重置 ===')
  
  const engine = new GameEngine(mockRoom)
  await engine.startGame({ useTestDeck: true })
  
  // 获取当前回合玩家 (而不是固定 players[0])
  const player = engine._getCurrentPlayer()
  
  // 模拟玩家使用了山智效果
  player.usedOncePerTurn = { 'OP01-013': true }
  
  console.log('当前回合玩家:', player.name)
  console.log('使用效果前:', JSON.stringify(player.usedOncePerTurn))
  
  // 执行 _runRefreshPhase (这会作用于当前回合玩家)
  engine._runRefreshPhase()
  
  console.log('刷新阶段后:', JSON.stringify(player.usedOncePerTurn))
  
  if (Object.keys(player.usedOncePerTurn).length === 0) {
    console.log('✅ 每回合一次效果正确重置')
    return true
  } else {
    console.log('❌ 每回合一次效果未重置')
    return false
  }
}

// 测试 TRIGGER 效果设置
async function testTriggerEffectSetup() {
  console.log('\n=== 测试: TRIGGER 效果设置 ===')
  
  const engine = new GameEngine(mockRoom)
  await engine.startGame({ useTestDeck: true })
  
  // 检查 hasScript 方法
  const hasTrigger = engine.scriptEngine.hasScript('ST01-016', TRIGGER_TYPES.TRIGGER)
  console.log('ST01-016 has TRIGGER script:', hasTrigger ? '✅' : '❌')
  
  // 检查 _hasTriggerScript 方法
  const hasTriggerScript = engine._hasTriggerScript('ST01-016')
  console.log('_hasTriggerScript("ST01-016"):', hasTriggerScript ? '✅' : '❌')
  
  return hasTrigger && hasTriggerScript
}

// 测试 respondToTrigger 方法
async function testRespondToTrigger() {
  console.log('\n=== 测试: respondToTrigger 方法 ===')
  
  const engine = new GameEngine(mockRoom)
  await engine.startGame({ useTestDeck: true })
  
  const player = engine.players[1]  // 被攻击的玩家
  
  // 设置 pendingTrigger
  const triggerCard = {
    cardNumber: 'ST01-016',
    nameCn: '恶魔风脚',
    instanceId: 'test-trigger-card',
    trigger: 'KO对方费用<=3且有阻挡者的角色',
  }
  
  engine.pendingTrigger = {
    card: triggerCard,
    playerId: player.id,
    triggerText: triggerCard.trigger,
    battleContext: {
      attackerPower: 5000,
      targetPower: 5000,
      remainingDamage: 0,
      hasBanish: false,
    },
  }
  
  // 测试跳过触发效果 (卡牌应该加入手牌)
  const skipResult = engine.respondToTrigger(player.id, false)
  console.log('跳过触发效果结果:', skipResult.success ? '✅ 成功' : '❌ 失败', skipResult.message || '')
  
  // 检查卡牌是否加入手牌
  const cardInHand = player.hand.some(c => c.instanceId === 'test-trigger-card')
  console.log('卡牌加入手牌:', cardInHand ? '✅' : '❌')
  
  // 重置测试发动触发效果
  engine.pendingTrigger = {
    card: { ...triggerCard, instanceId: 'test-trigger-card-2' },
    playerId: player.id,
    triggerText: triggerCard.trigger,
    battleContext: {
      attackerPower: 5000,
      targetPower: 5000,
      remainingDamage: 0,
      hasBanish: false,
    },
  }
  
  // 测试发动触发效果 (卡牌应该进入废弃区)
  const activateResult = engine.respondToTrigger(player.id, true)
  console.log('发动触发效果结果:', activateResult.success ? '✅ 成功' : '❌ 失败', activateResult.message || '')
  
  // 检查卡牌是否进入废弃区
  const cardInTrash = player.trash.some(c => c.instanceId === 'test-trigger-card-2')
  console.log('卡牌进入废弃区:', cardInTrash ? '✅' : '❌')
  
  return skipResult.success && cardInHand && activateResult.success && cardInTrash
}

// 测试 resolveDiscard 方法
async function testResolveDiscard() {
  console.log('\n=== 测试: resolveDiscard 方法 ===')
  
  const engine = new GameEngine(mockRoom)
  await engine.startGame({ useTestDeck: true })
  
  const player = engine.players[0]
  
  // 确保手牌有卡
  if (player.hand.length === 0) {
    console.log('❌ 手牌为空，无法测试')
    return false
  }
  
  const cardToDiscard = player.hand[0]
  
  // 设置 pendingEffect 为 DISCARD 类型
  engine.pendingEffect = {
    type: 'DISCARD',
    count: 1,
    validCards: [cardToDiscard],
    playerId: player.id,
    onDiscardActions: [],
  }
  
  const initialHandSize = player.hand.length
  const initialTrashSize = player.trash.length
  
  // 执行丢弃
  const result = engine.resolveDiscard(player.id, [cardToDiscard.instanceId])
  
  console.log('丢弃结果:', result.success ? '✅ 成功' : '❌ 失败', result.message || '')
  console.log('手牌变化:', initialHandSize, '->', player.hand.length)
  console.log('废弃区变化:', initialTrashSize, '->', player.trash.length)
  
  return result.success && 
         player.hand.length === initialHandSize - 1 && 
         player.trash.length === initialTrashSize + 1
}

// 测试 resolveRecover 方法
async function testResolveRecover() {
  console.log('\n=== 测试: resolveRecover 方法 ===')
  
  const engine = new GameEngine(mockRoom)
  await engine.startGame({ useTestDeck: true })
  
  const player = engine.players[0]
  
  // 先丢弃一张卡到废弃区
  const cardToTrash = player.hand.pop()
  player.trash.push(cardToTrash)
  
  // 设置 pendingEffect 为 RECOVER_FROM_TRASH 类型
  engine.pendingEffect = {
    type: 'RECOVER_FROM_TRASH',
    maxSelect: 1,
    validCards: [engine._sanitizeCard(cardToTrash)],
    playerId: player.id,
  }
  
  const initialHandSize = player.hand.length
  const initialTrashSize = player.trash.length
  
  // 执行回收
  const result = engine.resolveRecover(player.id, [cardToTrash.instanceId])
  
  console.log('回收结果:', result.success ? '✅ 成功' : '❌ 失败', result.message || '')
  console.log('手牌变化:', initialHandSize, '->', player.hand.length)
  console.log('废弃区变化:', initialTrashSize, '->', player.trash.length)
  
  return result.success && 
         player.hand.length === initialHandSize + 1 && 
         player.trash.length === initialTrashSize - 1
}

// 测试 ON_ATTACK 脚本注册
async function testOnAttackRegistration() {
  console.log('\n=== 测试: ON_ATTACK 脚本注册和执行 ===')
  
  const engine = new GameEngine(mockRoom)
  await engine.startGame({ useTestDeck: true })
  
  const player = engine.players[0]
  
  // 创建一个 OP01-015 角色并登场
  const chopperCard = {
    cardNumber: 'OP01-015',
    nameCn: '托尼托尼·乔巴',
    cardType: 'CHARACTER',
    cost: 1,
    power: 3000,
    instanceId: 'test-chopper-1',
  }
  
  // 直接添加到角色区
  player.characters.push({
    card: chopperCard,
    attachedDon: 1,  // 需要 DON!! x1 来触发效果
    state: 'ACTIVE',
  })
  
  // 注册脚本
  engine.scriptEngine.registerCard(chopperCard, chopperCard.instanceId, player.id)
  
  // 检查脚本是否已注册
  const registered = engine.scriptEngine.triggerSystem.getScripts(TRIGGER_TYPES.ON_ATTACK)
  const chopperScript = registered.find(s => s.instanceId === chopperCard.instanceId)
  
  console.log('OP01-015 脚本注册:', chopperScript ? '✅' : '❌')
  
  if (chopperScript) {
    console.log('  - cardNumber:', chopperScript.cardNumber)
    console.log('  - instanceId:', chopperScript.instanceId)
    console.log('  - triggerType:', chopperScript.script?.triggerType)
  }
  
  return !!chopperScript
}

// 运行所有测试
async function runAllTests() {
  console.log('=' .repeat(60))
  console.log('开始完整功能测试')
  console.log('=' .repeat(60))
  
  const results = {
    oncePerTurnReset: await testOncePerTurnReset(),
    triggerEffectSetup: await testTriggerEffectSetup(),
    respondToTrigger: await testRespondToTrigger(),
    resolveDiscard: await testResolveDiscard(),
    resolveRecover: await testResolveRecover(),
    onAttackRegistration: await testOnAttackRegistration(),
  }
  
  console.log('\n' + '=' .repeat(60))
  console.log('测试结果汇总')
  console.log('=' .repeat(60))
  
  let allPassed = true
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${name}`)
    if (!passed) allPassed = false
  }
  
  console.log('\n' + (allPassed ? '✅ 所有测试通过!' : '❌ 部分测试失败'))
  console.log('=' .repeat(60))
  
  return allPassed
}

runAllTests().catch(console.error)
