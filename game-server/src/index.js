/**
 * ONE PIECE CARD GAME - Socket.IO Server
 * Handles real-time game communication
 */

import { createServer } from 'http'
import { Server } from 'socket.io'
import { RoomManager } from './rooms.js'
import { GameEngine } from './engine.js'
import { getCardPoolAsync } from './cards.js'
import { SOCKET_EVENTS } from '../../shared/constants.js'

const PORT = process.env.GAME_SERVER_PORT || 3001

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: {
    origin: '*', // 允许所有来源（开发环境）
    methods: ['GET', 'POST'],
  },
})

const roomManager = new RoomManager()

// Handle disconnection timeout (forfeit)
roomManager.onTimeoutCallback = (roomId, winnerUserId) => {
  const room = roomManager.getRoom(roomId)
  if (room && room.engine) {
    const winner = room.players.find(p => p.userId === winnerUserId)
    if (winner) {
      console.log(`[Forfeit] Room ${roomId} won by ${winner.name}`)
      room.engine.winner = winner.socketId
      handleGameEnd(room)
    }
  }
}

// Pre-load card pool on startup
getCardPoolAsync().then(() => console.log('Card pool loaded'))

io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`)

  // =====================
  // ROOM EVENTS
  // =====================

  socket.on(SOCKET_EVENTS.ROOM_CREATE, ({ playerName, deckId, userId }) => {
    const { room, userId: newUserId } = roomManager.createRoom(socket.id, playerName, deckId, userId)
    socket.join(room.id)
    socket.emit(SOCKET_EVENTS.ROOM_CREATED, { 
      roomId: room.id,
      room: sanitizeRoom(room),
      userId: newUserId
    })
    console.log(`[房间] ${playerName} 创建了房间 ${room.id}, 卡组: ${deckId} (User: ${newUserId})`)
  })

  socket.on(SOCKET_EVENTS.ROOM_JOIN, ({ roomId, playerName, deckId, userId }) => {
    const result = roomManager.joinRoom(roomId, socket.id, playerName, deckId, userId)
    if (!result) {
      socket.emit('error', { message: '房间不存在或已满' })
      return
    }
    const { room, userId: newUserId } = result

    socket.join(roomId)
    socket.emit(SOCKET_EVENTS.ROOM_JOINED, { 
      roomId,
      room: sanitizeRoom(room),
      userId: newUserId
    })
    
    // Notify other player
    socket.to(roomId).emit(SOCKET_EVENTS.PLAYER_JOINED, {
      player: { name: playerName, deckId },
    })
    
    console.log(`[房间] ${playerName} 加入了房间 ${roomId} (User: ${newUserId})`)
  })

  // REJOIN GAME
  socket.on(SOCKET_EVENTS.REJOIN_GAME, ({ userId }) => {
    console.log(`[Rejoin] Attempting rejoin for User: ${userId}`)
    const result = roomManager.handleRejoin(socket.id, userId)
    
    if (!result.success) {
      console.log(`[Rejoin] Failed: ${result.error}`)
      socket.emit(SOCKET_EVENTS.GAME_REJOIN_FAILED, { message: result.error })
      return
    }

    const { room, player, oldSocketId } = result
    socket.join(room.id)
    
    // Update socket ID in engine if game is running
    if (room.engine) {
      if (oldSocketId) {
        room.engine.reconnectPlayer(oldSocketId, socket.id)
      }
      
      // Send full state to reconnected player
      const state = room.engine.getStateForPlayer(socket.id)
      socket.emit(SOCKET_EVENTS.GAME_SYNC, { 
        roomId: room.id, 
        ...state,
        isReconnected: true 
      })
      
      // Notify opponent that player is back
      socket.to(room.id).emit(SOCKET_EVENTS.PLAYER_JOINED, {
        player: { 
            name: player.name, 
            deckId: player.deckId,
            userId: player.userId,
            isReconnected: true
        }
      })
      
      console.log(`[Rejoin] User ${userId} reconnected to room ${room.id} and synced state`)
    } else {
      // Room in waiting state
      socket.emit(SOCKET_EVENTS.ROOM_JOINED, { 
        roomId: room.id, 
        room: sanitizeRoom(room),
        userId: userId
      })
      console.log(`[Rejoin] User ${userId} reconnected to waiting room ${room.id}`)
    }
  })

  socket.on(SOCKET_EVENTS.ROOM_LIST, () => {
    const rooms = roomManager.getWaitingRooms()
    console.log(`[房间列表] 发送 ${rooms.length} 个等待中的房间:`, rooms.map(r => r.id).join(', ') || '无')
    socket.emit(SOCKET_EVENTS.ROOM_LIST, { rooms })
  })

  socket.on(SOCKET_EVENTS.SET_READY, ({ ready }) => {
    console.log(`[Ready] ${socket.id} set ready to ${ready}`)
    const result = roomManager.setPlayerReady(socket.id, ready)
    if (!result) {
      console.log(`[Ready] No room found for socket ${socket.id}`)
      return
    }

    const { room, allReady } = result
    console.log(`[Ready] Room ${room.id}: players ready state = ${room.players.map(p => `${p.name}:${p.ready}`).join(', ')}, allReady = ${allReady}`)
    io.to(room.id).emit(SOCKET_EVENTS.ROOM_UPDATE, { room: sanitizeRoom(room) })

    if (allReady) {
      console.log(`[Ready] Starting game for room ${room.id}`)
      startGame(room)
    }
  })

  socket.on(SOCKET_EVENTS.SELECT_LEADER, ({ deckId }) => {
    const room = roomManager.updateDeck(socket.id, deckId)
    if (room) {
      io.to(room.id).emit(SOCKET_EVENTS.ROOM_UPDATE, { room: sanitizeRoom(room) })
    }
  })

  // =====================
  // MATCHMAKING
  // =====================

  socket.on(SOCKET_EVENTS.MATCHMAKING_JOIN, ({ playerName, deckId }) => {
    const result = roomManager.addToQueue(socket.id, playerName, deckId)
    
    if (result.matched) {
      const room = result.room
      // Notify both players
      for (const player of result.players) {
        const playerSocket = io.sockets.sockets.get(player.socketId)
        if (playerSocket) {
          playerSocket.join(room.id)
          playerSocket.emit(SOCKET_EVENTS.MATCHMAKING_FOUND, { 
            roomId: room.id,
            room: sanitizeRoom(room),
          })
        }
      }
      // Start game immediately
      startGame(room)
      console.log(`[匹配] 房间 ${room.id} 匹配成功`)
    } else {
      socket.emit(SOCKET_EVENTS.MATCHMAKING_WAITING, { position: result.position })
      console.log(`[匹配] ${playerName} 加入队列 (位置: ${result.position})`)
    }
  })

  socket.on(SOCKET_EVENTS.MATCHMAKING_LEAVE, () => {
    roomManager.removeFromQueue(socket.id)
    socket.emit(SOCKET_EVENTS.MATCHMAKING_LEFT)
  })

  // =====================
  // GAME SYNC - Request current game state
  // =====================
  
  socket.on('game:sync', () => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) {
      console.log(`[Sync] No active game for socket ${socket.id}`)
      return
    }
    console.log(`[Sync] Sending game state to ${socket.id}`)
    const state = room.engine.getStateForPlayer(socket.id)
    socket.emit(SOCKET_EVENTS.GAME_START, { roomId: room.id, ...state })
  })

  // =====================
  // GAME ACTIONS - MAIN PHASE
  // =====================

  socket.on(SOCKET_EVENTS.PLAY_CHARACTER, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.playCharacter(socket.id, cardInstanceId)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.PLAY_EVENT, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.playEvent(socket.id, cardInstanceId)
    if (result.success) {
      // Emit effect text so player can execute manually
      socket.emit(SOCKET_EVENTS.EVENT_PLAYED, { 
        card: result.cardPlayed,
        effectText: result.effectText,
      })
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.PLAY_STAGE, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.playStage(socket.id, cardInstanceId)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.ATTACH_DON, ({ targetId, count }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.attachDon(socket.id, targetId, count || 1)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on('game:detach-don', ({ sourceId, count }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.detachDon(socket.id, sourceId, count || 1)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.END_MAIN_PHASE, () => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.endMainPhase(socket.id)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // =====================
  // GAME ACTIONS - BATTLE PHASE
  // =====================

  socket.on(SOCKET_EVENTS.DECLARE_ATTACK, ({ attackerId, targetId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.declareAttack(socket.id, attackerId, targetId)
    if (result.success) {
      broadcastGameState(room)
      // Notify defender for blocker/counter step
      const opponent = room.players.find(p => p.socketId !== socket.id)
      if (opponent) {
        io.to(opponent.socketId).emit(SOCKET_EVENTS.ATTACK_DECLARED, {
          pendingAttack: result.pendingAttack,
          battleStep: result.battleStep,
        })
      }
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.DECLARE_BLOCKER, ({ blockerInstanceId, blockerId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const targetId = blockerInstanceId || blockerId
    const result = room.engine.declareBlocker(socket.id, targetId)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.SKIP_BLOCKER, () => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.skipBlocker(socket.id)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.PLAY_COUNTER, ({ cardInstanceId, cardInstanceIds, manualPower }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    // Support both single cardInstanceId and array of cardInstanceIds
    const ids = cardInstanceIds || (cardInstanceId ? [cardInstanceId] : [])
    const result = room.engine.playCounter(socket.id, ids, manualPower || 0)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.SKIP_COUNTER, () => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.skipCounter(socket.id)
    if (result.success) {
      broadcastGameState(room)
      // Check for game end
      if (room.engine.winner) {
        handleGameEnd(room)
      }
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.END_BATTLE_PHASE, () => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.endBattlePhase(socket.id)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.END_TURN, () => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.endTurn(socket.id)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // =====================
  // UTILITY ACTIONS (Semi-automatic board)
  // =====================

  socket.on(SOCKET_EVENTS.DRAW_CARDS, ({ count }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.drawCards(socket.id, count || 1)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.KO_TARGET, ({ targetPlayerId, targetInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.koTarget(socket.id, targetPlayerId, targetInstanceId)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.BOUNCE_TO_HAND, ({ targetPlayerId, targetInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.bounceToHand(socket.id, targetPlayerId, targetInstanceId)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.BOUNCE_TO_BOTTOM, ({ targetPlayerId, targetInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.bounceToBottom(socket.id, targetPlayerId, targetInstanceId)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.RECOVER_FROM_TRASH, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.recoverFromTrash(socket.id, cardInstanceId)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.PLAY_FROM_TRASH, ({ cardInstanceId, state }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.playFromTrash(socket.id, cardInstanceId, state)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  socket.on(SOCKET_EVENTS.MODIFY_POWER, ({ targetId, delta }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.modifyPower(socket.id, targetId, delta)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.TRASH_FROM_HAND, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.trashFromHand(socket.id, cardInstanceId)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.REST_TARGET, ({ targetId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.restTarget(socket.id, targetId)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.ACTIVATE_TARGET, ({ targetId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.activateTarget(socket.id, targetId)
    if (result.success) {
      broadcastGameState(room)
    }
  })

  socket.on(SOCKET_EVENTS.MOVE_DON, ({ direction, count }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.moveDon(socket.id, direction, count || 1)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // VIEW TOP DECK
  socket.on(SOCKET_EVENTS.VIEW_TOP_DECK, ({ count }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.viewTopDeck(socket.id, count || 1)
    if (result.success) {
      // Only send the viewed cards to the requesting player
      socket.emit('game:view-top-result', { cards: result.cards })
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // RESOLVE SEARCH (after viewing top cards)
  socket.on(SOCKET_EVENTS.RESOLVE_SEARCH, ({ selectedIds, bottomIds }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.resolveSearch(socket.id, selectedIds || [], bottomIds || [])
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // LIFE TO HAND
  socket.on(SOCKET_EVENTS.LIFE_TO_HAND, ({ lifeIndex }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.lifeToHand(socket.id, lifeIndex ?? 0)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // SET EFFECT RESTRICTION (e.g., OP02-004 登场效果：禁止本回合通过效果将生命牌加入手牌)
  socket.on(SOCKET_EVENTS.SET_EFFECT_RESTRICTION, ({ restriction, value }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.setEffectRestriction(socket.id, restriction, value ?? true)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // SEARCH DECK (with filter)
  socket.on(SOCKET_EVENTS.SEARCH_DECK, ({ filter }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.searchDeckFiltered(socket.id, filter || {})
    if (result.success) {
      socket.emit('game:search-result', { cards: result.cards })
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // PICK FROM DECK (after search)
  socket.on(SOCKET_EVENTS.PICK_FROM_DECK, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.pickFromDeck(socket.id, cardInstanceId)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // TRASH TO LIFE
  socket.on(SOCKET_EVENTS.TRASH_TO_LIFE, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.trashToLife(socket.id, cardInstanceId)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // =====================
  // DISCONNECT
  // =====================

  socket.on('disconnect', () => {
    // Remove from matchmaking queue
    roomManager.removeFromQueue(socket.id)
    
    const result = roomManager.handleDisconnect(socket.id)
    
    if (result) {
      const { action, room, userId } = result
      
      if (action === 'timer_started') {
        // Game still in progress, waiting for reconnect
        console.log(`[Disconnect] User ${userId} disconnected, waiting for reconnect...`)
        // Notify opponent?
        io.to(room.id).emit(SOCKET_EVENTS.PLAYER_LEFT, { 
          socketId: socket.id,
          reason: 'reconnecting',
          timeout: 60
        })
      } else if (action === 'removed' && room) {
        // Normal removal (waiting room or finished)
        io.to(room.id).emit(SOCKET_EVENTS.PLAYER_LEFT, { socketId: socket.id })
      }
    } else {
        // Fallback for cases not handled by handleDisconnect (e.g. not in room)
    }

    console.log(`[断开] ${socket.id}`)
  })
})

// =====================
// HELPER FUNCTIONS
// =====================

async function startGame(room) {
  console.log(`[DEBUG] startGame called for room ${room.id}`)
  try {
    console.log(`[DEBUG] Creating GameEngine...`)
    const engine = new GameEngine(room)
    console.log(`[DEBUG] GameEngine created, setting room engine...`)
    roomManager.setEngine(room.id, engine)
    console.log(`[DEBUG] Starting game (async)...`)
    const initialState = await engine.startGame()
    console.log(`[DEBUG] Game started, broadcasting to players...`)

    room.players.forEach((player) => {
      console.log(`[DEBUG] Broadcasting to ${player.socketId}...`)
      const state = engine.getStateForPlayer(player.socketId)
      io.to(player.socketId).emit(SOCKET_EVENTS.GAME_START, { roomId: room.id, ...state })
      console.log(`[DEBUG] Sent GAME_START to ${player.socketId}`)
    })
    
    console.log(`[游戏] 房间 ${room.id} 游戏开始`)
  } catch (error) {
    console.error(`[错误] 游戏启动失败:`, error)
    console.error(`[错误] Stack:`, error.stack)
    io.to(room.id).emit('error', { message: 'Game initialization failed: ' + error.message })
  }
}

function broadcastGameState(room) {
  if (!room.engine) return

  room.players.forEach((player) => {
    const state = room.engine.getStateForPlayer(player.socketId)
    io.to(player.socketId).emit(SOCKET_EVENTS.GAME_UPDATE, state)
  })
}

function handleGameEnd(room) {
  if (!room.engine?.winner) return
  
  roomManager.finishRoom(room.id, room.engine.winner)
  
  io.to(room.id).emit(SOCKET_EVENTS.GAME_END, {
    winner: room.engine.winner,
    finalState: room.engine.getState(),
  })
  
  console.log(`[游戏] 房间 ${room.id} 游戏结束，获胜者: ${room.engine.winner}`)
}

function sanitizeRoom(room) {
  return {
    id: room.id,
    status: room.status,
    players: room.players.map(p => ({
      name: p.name,
      deckId: p.deckId,
      ready: p.ready,
      isSelf: false, // Will be set on client
    })),
    createdAt: room.createdAt,
  }
}

// Periodic cleanup
setInterval(() => {
  roomManager.cleanup()
}, 300000) // Every 5 minutes

httpServer.listen(PORT, () => {
  console.log(`🎮 ONE PIECE CARD GAME Server running on http://localhost:${PORT}`)
})
