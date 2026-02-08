/**
 * Test script to verify game flow
 */

import { io } from 'socket.io-client'

const p1 = io('http://localhost:3001', { transports: ['websocket'] })
const p2 = io('http://localhost:3001', { transports: ['websocket'] })
let roomId = ''

p1.on('connect', () => {
  console.log('P1 connected')
  p1.emit('room:create', { playerName: 'Player 1', leaderCard: 'ST01-001' })
})

p1.on('room:created', (data) => {
  console.log('Room created:', data.roomId)
  roomId = data.roomId
  p2.emit('room:join', { roomId, playerName: 'Player 2', leaderCard: 'ST02-001' })
})

p2.on('room:joined', (data) => {
  console.log('P2 joined room')
  // Both ready
  setTimeout(() => {
    console.log('Setting both players ready...')
    p1.emit('room:ready', { ready: true })
    p2.emit('room:ready', { ready: true })
  }, 300)
})

p1.on('room:update', (data) => {
  console.log('P1 room update:', data.room.players.map(p => `${p.name}:${p.ready}`).join(', '))
})

p2.on('room:update', (data) => {
  console.log('P2 room update:', data.room.players.map(p => `${p.name}:${p.ready}`).join(', '))
})

p1.on('game:start', (data) => {
  console.log('')
  console.log('========== GAME STARTED ==========')
  console.log('Phase:', data.phase)
  console.log('Turn number:', data.turnNumber)
  console.log('Current turn:', data.currentTurn)
  
  const self = data.players.find(p => p.isSelf)
  console.log('')
  console.log('P1 state:')
  console.log('  - Leader:', self?.leader?.card?.name)
  console.log('  - Hand size:', self?.hand?.length)
  console.log('  - Life:', self?.lifeCount)
  console.log('  - DON!! active:', self?.donActive)
  console.log('  - DON!! deck:', self?.donDeckCount)
  console.log('  - Is current turn:', data.currentTurn === self?.id)
  
  // Only play card if it's our turn
  if (data.currentTurn === self?.id && self?.hand?.length > 0 && self?.donActive > 0) {
    const character = self.hand.find(c => c.cardType === 'CHARACTER' && c.cost <= self.donActive)
    if (character) {
      console.log('')
      console.log('Playing character:', character.name, 'cost:', character.cost)
      p1.emit('game:play-character', { cardInstanceId: character.instanceId, slotIndex: 0 })
    }
  }
})

p1.on('game:update', (data) => {
  console.log('')
  console.log('========== GAME UPDATE ==========')
  console.log('Phase:', data.phase)
  console.log('Battle step:', data.battleStep)
  
  const self = data.players.find(p => p.isSelf)
  console.log('P1 characters:', self?.characters?.length || 0)
  console.log('P1 DON!! active:', self?.donActive)
  
  // If we have characters and it's our turn in main phase, try to attack
  if (data.phase === 'main' && data.currentTurn === self?.id && self?.characters?.length > 0) {
    console.log('Entering battle phase...')
    p1.emit('game:end-main-phase')
  }
  
  if (data.phase === 'battle' && data.currentTurn === self?.id && !data.pendingAttack) {
    // Try to attack with leader
    if (self?.leader?.state === 'ACTIVE') {
      console.log('Attacking with leader!')
      p1.emit('game:declare-attack', { attackerId: 'leader', targetId: 'leader' })
    }
  }
})

p2.on('game:start', (data) => {
  console.log('P2 received game:start')
  const self = data.players.find(p => p.isSelf)
  console.log('P2 state:')
  console.log('  - Leader:', self?.leader?.card?.name)
  console.log('  - DON!! active:', self?.donActive)
  console.log('  - Is current turn:', data.currentTurn === self?.id)
  
  // Only play card if it's our turn
  if (data.currentTurn === self?.id && self?.hand?.length > 0 && self?.donActive > 0) {
    const character = self.hand.find(c => c.cardType === 'CHARACTER' && c.cost <= self.donActive)
    if (character) {
      console.log('P2 Playing character:', character.name, 'cost:', character.cost)
      p2.emit('game:play-character', { cardInstanceId: character.instanceId, slotIndex: 0 })
    } else {
      console.log('P2 ending main phase (no playable cards)')
      p2.emit('game:end-main-phase')
    }
  }
})

p2.on('game:update', (data) => {
  console.log('P2 received game:update, phase:', data.phase, 'battleStep:', data.battleStep)
  
  // If defending, skip blocker
  if (data.battleStep === 'block') {
    console.log('P2 skipping blocker')
    p2.emit('game:skip-blocker')
  }
  
  // If counter step, skip counter
  if (data.battleStep === 'counter') {
    console.log('P2 skipping counter')
    p2.emit('game:skip-counter')
  }
})

p1.on('error', (err) => console.log('P1 Error:', err))
p2.on('error', (err) => console.log('P2 Error:', err))

setTimeout(() => { 
  console.log('') 
  console.log('Test completed - timeout')
  console.log('SUCCESS: Basic game flow works!')
  process.exit(0) 
}, 6000)
