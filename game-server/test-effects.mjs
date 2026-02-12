/**
 * Test OP01-015 乔巴 ON_ATTACK -> DISCARD -> RECOVER_FROM_TRASH flow
 * Test cannotBeBlocked field state
 */
import { GameEngine } from './src/engine.js'
import { CARD_STATES, GAME_PHASES } from '../shared/constants.js'

// Create engine
const engine = new GameEngine()

// Mock two players
const p1Id = 'player1'
const p2Id = 'player2'

// Create minimal card data
function makeCard(overrides) {
  return {
    instanceId: `inst-${Math.random().toString(36).slice(2, 8)}`,
    cardNumber: 'TEST-001',
    name: 'Test Card',
    nameCn: '测试卡',
    cardType: 'CHARACTER',
    cost: 1,
    power: 3000,
    counter: 1000,
    color: 'RED',
    attribute: '',
    attributeCn: '',
    effect: '',
    keywords: [],
    imageUrl: '',
    ...overrides,
  }
}

// Init game state manually
engine.players = [
  {
    id: p1Id,
    name: 'P1',
    leader: {
      card: makeCard({ cardNumber: 'ST01-001', cardType: 'LEADER', nameCn: 'Leader1', instanceId: 'leader1' }),
      attachedDon: 0,
      state: CARD_STATES.ACTIVE,
    },
    characters: [],
    hand: [],
    life: [],
    trash: [],
    deck: Array.from({ length: 20 }, (_, i) => makeCard({ instanceId: `deck-${i}`, nameCn: `牌库卡${i}` })),
    donActive: 5,
    donRested: 0,
    donDeckCount: 5,
    powerMods: new Map(),
    usedOncePerTurn: {},
    effectRestrictions: {},
  },
  {
    id: p2Id,
    name: 'P2',
    leader: {
      card: makeCard({ cardNumber: 'ST01-002', cardType: 'LEADER', nameCn: 'Leader2', instanceId: 'leader2' }),
      attachedDon: 0,
      state: CARD_STATES.ACTIVE,
    },
    characters: [],
    hand: [],
    life: [],
    trash: [],
    deck: Array.from({ length: 20 }, (_, i) => makeCard({ instanceId: `deck2-${i}`, nameCn: `牌库卡2-${i}` })),
    donActive: 5,
    donRested: 0,
    donDeckCount: 5,
    powerMods: new Map(),
    usedOncePerTurn: {},
    effectRestrictions: {},
  },
]

engine.currentTurnIndex = 0
engine.turnNumber = 3
engine.phase = 'main'

const p1 = engine.players[0]
const p2 = engine.players[1]

let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${msg}`)
    failed++
  }
}

// === Test 1: OP01-015 乔巴 ON_ATTACK → DISCARD → RECOVER_FROM_TRASH ===
console.log('\n=== Test 1: OP01-015 乔巴 ON_ATTACK → DISCARD → RECOVER_FROM_TRASH ===')

const chopperCard = makeCard({
  instanceId: 'chopper-inst',
  cardNumber: 'OP01-015',
  nameCn: '托尼托尼·乔巴',
  cardType: 'CHARACTER',
  cost: 2,
  power: 3000,
  trait: '动物/草帽一伙',
})

const chopperSlot = {
  card: chopperCard,
  attachedDon: 1,
  state: CARD_STATES.ACTIVE,
  canAttackThisTurn: true,
}
p1.characters.push(chopperSlot)
engine.scriptEngine.registerCard(chopperCard, chopperCard.instanceId, p1Id)

// Hand card for discarding
const handCard = makeCard({ instanceId: 'hand-1', nameCn: '手牌1', cost: 1 })
p1.hand.push(handCard)

// Valid trash target
const trashTarget = makeCard({
  instanceId: 'trash-target',
  cardNumber: 'ST01-006',
  nameCn: '废弃区角色',
  cardType: 'CHARACTER',
  cost: 3,
  power: 4000,
  trait: '草帽一伙',
})
p1.trash.push(trashTarget)

// Invalid trash target (wrong trait)
p1.trash.push(makeCard({
  instanceId: 'trash-invalid',
  nameCn: '不符合条件的角色',
  cardType: 'CHARACTER',
  cost: 2,
  trait: '海军',
}))

// P2 life for attack
p2.life = [makeCard({ instanceId: 'life-1' }), makeCard({ instanceId: 'life-2' })]

// Step 1: Declare attack
console.log('--- Step 1: Declare Attack ---')
const attackResult = engine.declareAttack(p1Id, 'chopper-inst', 'leader')
console.log('Attack result:', JSON.stringify(attackResult))
assert(attackResult.success, 'Attack declared successfully')
assert(engine.pendingEffect?.type === 'DISCARD', `pendingEffect is DISCARD (got: ${engine.pendingEffect?.type})`)
console.log('  onDiscardActions:', JSON.stringify(engine.pendingEffect?.onDiscardActions?.map(a => a.type)))

// Step 2: Resolve discard
console.log('--- Step 2: Resolve Discard ---')
const discardResult = engine.resolveDiscard(p1Id, ['hand-1'])
assert(discardResult.success, 'Discard resolved successfully')
assert(discardResult.hasPendingEffect, 'hasPendingEffect is true')
console.log('  pendingEffect type:', engine.pendingEffect?.type)
console.log('  pendingEffect playerId:', engine.pendingEffect?.playerId)
assert(engine.pendingEffect?.type === 'RECOVER_FROM_TRASH', `pendingEffect is RECOVER_FROM_TRASH (got: ${engine.pendingEffect?.type})`)
assert(engine.pendingEffect?.playerId === p1Id, `playerId matches (got: ${engine.pendingEffect?.playerId})`)

if (engine.pendingEffect?.validCards) {
  console.log('  validCards:', engine.pendingEffect.validCards.map(c => ({
    name: c.nameCn,
    cardType: c.cardType,
    cost: c.cost,
    attr: c.attributeCn || c.attribute,
  })))
  assert(engine.pendingEffect.validCards.length === 1, `Only valid trash target returned (got: ${engine.pendingEffect.validCards.length})`)
} else {
  assert(false, 'validCards should exist')
}

// Step 3: Resolve recover
console.log('--- Step 3: Resolve Recover ---')
const recoverResult = engine.resolveRecover(p1Id, ['trash-target'])
assert(recoverResult.success, 'Recover resolved successfully')
assert(p1.hand.some(c => c.instanceId === 'trash-target'), 'Card recovered to hand')

// === Test 2: cannotBeBlocked field state ===
console.log('\n=== Test 2: cannotBeBlocked field state ===')

engine.pendingAttack = null
engine.battleStep = 'none'
engine.pendingEffect = null
engine.phase = 'main'

const attacker = makeCard({
  instanceId: 'attacker-inst',
  cardNumber: 'ST01-010',
  nameCn: '攻击者',
  cardType: 'CHARACTER',
  cost: 3,
  power: 5000,
  attributeCn: '草帽一伙',
})
p1.characters.push({
  card: attacker,
  attachedDon: 0,
  state: CARD_STATES.ACTIVE,
  canAttackThisTurn: true,
  fieldStates: { cannotBeBlocked: true },
})

// P2 blocker
const blocker = makeCard({
  instanceId: 'blocker-inst',
  cardNumber: 'ST01-011',
  nameCn: '阻挡者',
  cardType: 'CHARACTER',
  cost: 2,
  power: 4000,
  keywords: ['Blocker'],
  keywordsCn: ['阻挡者'],
})
p2.characters.push({
  card: blocker,
  attachedDon: 0,
  state: CARD_STATES.ACTIVE,
})

console.log('--- Attack with cannotBeBlocked unit ---')
const attackResult2 = engine.declareAttack(p1Id, 'attacker-inst', 'leader')
assert(attackResult2.success, 'Attack declared')
assert(attackResult2.battleStep === 'counter', `Blocker step skipped (got: ${attackResult2.battleStep})`)

// === Test 3: endTurn blocked during battle ===
console.log('\n=== Test 3: endTurn blocked during battle ===')
// Currently in battle phase (from attack above)
const endTurnResult = engine.endTurn(p1Id)
console.log('  endTurn during battle result:', endTurnResult)
// Check current behavior - this is where the bug is

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
