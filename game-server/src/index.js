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

  // 创建测试房间 - 使用测试卡组快速开始游戏
  socket.on('TEST_ROOM_CREATE', ({ playerName }) => {
    const { room, userId: newUserId } = roomManager.createRoom(socket.id, playerName || 'TestPlayer1', 'test-deck', null)
    room.useTestDeck = true // 标记为测试房间
    socket.join(room.id)
    socket.emit(SOCKET_EVENTS.ROOM_CREATED, { 
      roomId: room.id,
      room: sanitizeRoom(room),
      userId: newUserId,
      isTestRoom: true
    })
    console.log(`[测试房间] ${playerName || 'TestPlayer1'} 创建了测试房间 ${room.id}`)
  })

  // 加入测试房间并立即开始游戏
  socket.on('TEST_ROOM_JOIN', ({ roomId, playerName }) => {
    const result = roomManager.joinRoom(roomId, socket.id, playerName || 'TestPlayer2', 'test-deck', null)
    if (!result) {
      socket.emit('error', { message: '房间不存在或已满' })
      return
    }
    const { room, userId: newUserId } = result
    socket.join(roomId)
    socket.emit(SOCKET_EVENTS.ROOM_JOINED, { 
      roomId,
      room: sanitizeRoom(room),
      userId: newUserId,
      isTestRoom: true
    })
    
    // 自动开始游戏，使用测试卡组
    console.log(`[测试房间] ${playerName || 'TestPlayer2'} 加入了测试房间 ${roomId}，自动开始游戏`)
    startGame(room, { useTestDeck: true })
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
      // Notify both players (with their userId for token saving)
      for (const roomPlayer of room.players) {
        const playerSocket = io.sockets.sockets.get(roomPlayer.socketId)
        if (playerSocket) {
          playerSocket.join(room.id)
          playerSocket.emit(SOCKET_EVENTS.MATCHMAKING_FOUND, { 
            roomId: room.id,
            room: sanitizeRoom(room),
            userId: roomPlayer.userId,
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
      // 检查是否触发了需要交互的效果
      broadcastPendingEffect(room, socket.id)
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
      socket.emit(SOCKET_EVENTS.EVENT_PLAYED, { 
        card: result.cardPlayed,
        effectText: result.effectText,
      })
      // Check if event script created a pending effect
      if (result.hasInteraction) {
        broadcastPendingEffect(room, socket.id)
      }
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

  // 手动发动场上卡牌的 ACTIVATE_MAIN 效果
  socket.on('game:activate-main', ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.activateMain(socket.id, cardInstanceId)
    if (result.success) {
      // 检查是否有需要交互的效果
      broadcastPendingEffect(room, socket.id)
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
      // 检查 ON_ATTACK 脚本是否产生了 pendingEffect（如丢弃效果）
      const pendingEffect = room.engine.pendingEffect
      if (pendingEffect?.playerId === socket.id) {
        broadcastPendingEffect(room, socket.id)
      }
      
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

  // 暂存反击卡（可撤销）
  socket.on(SOCKET_EVENTS.STAGE_COUNTER_CARD, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.stageCounterCard(socket.id, cardInstanceId)
    if (result.success) {
      // 通知攻击方对手暂存了反击卡
      const attacker = room.engine._getOpponent(socket.id)
      if (attacker && result.cardStaged) {
        const attackerSocket = io.sockets.sockets.get(attacker.id)
        if (attackerSocket) {
          attackerSocket.emit('counter:staged', {
            card: {
              name: result.cardStaged.nameCn || result.cardStaged.name,
              cardNumber: result.cardStaged.cardNumber,
              counter: result.cardStaged.counter || 0,
              imageUrl: result.cardStaged.imageUrl,
            },
            counterAdded: result.counterAdded,
            totalCounterPower: result.totalCounterPower,
            newTargetPower: result.newTargetPower,
          })
        }
      }
      
      // 检查是否需要玩家交互（所有类型的 pendingEffect）
      if (result.needsInteraction) {
        broadcastPendingEffect(room, socket.id)
      }
      
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // 撤销暂存的反击卡
  socket.on(SOCKET_EVENTS.UNSTAGE_COUNTER_CARD, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.unstageCounterCard(socket.id, cardInstanceId)
    if (result.success) {
      // 通知攻击方对手撤销了反击卡
      const attacker = room.engine._getOpponent(socket.id)
      if (attacker && result.cardUnstaged) {
        const attackerSocket = io.sockets.sockets.get(attacker.id)
        if (attackerSocket) {
          attackerSocket.emit('counter:unstaged', {
            card: {
              name: result.cardUnstaged.nameCn || result.cardUnstaged.name,
              cardNumber: result.cardUnstaged.cardNumber,
            },
            totalCounterPower: result.totalCounterPower,
          })
        }
      }
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // 确认反击（将暂存卡移入弃牌区并结算战斗）
  socket.on(SOCKET_EVENTS.CONFIRM_COUNTER, () => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.confirmCounter(socket.id)
    if (result.success) {
      // 战斗结算完成，通知双方
      const attacker = room.engine._getOpponent(socket.id)
      if (attacker) {
        const attackerSocket = io.sockets.sockets.get(attacker.id)
        if (attackerSocket) {
          attackerSocket.emit('counter:confirmed', {
            cardsUsed: result.cardsUsed,
            totalCounterPower: result.totalCounterPower,
          })
        }
      }
      
      // 检查是否有触发效果待处理
      if (result.outcome === 'TRIGGER_PENDING' && result.pendingTrigger) {
        const defenderId = room.engine.pendingTrigger?.playerId
        if (defenderId) {
          // 获取完整卡牌信息以便前端展示
          const triggerCard = room.engine.pendingTrigger.card
          io.to(defenderId).emit('game:trigger-prompt', {
            cardNumber: result.pendingTrigger.cardNumber,
            cardName: result.pendingTrigger.cardName,
            triggerText: result.pendingTrigger.triggerText,
            instanceId: result.pendingTrigger.instanceId,
            // 完整卡牌信息用于展示
            card: triggerCard ? room.engine._sanitizeCard(triggerCard) : null,
          })
        }
        broadcastGameState(room)
        return
      }
      
      // 检查战斗结算后是否产生了 pendingEffect (如 ON_KO 触发的效果)
      const pendingEffect = room.engine.pendingEffect
      if (pendingEffect?.type === 'SELECT_TARGET' && pendingEffect.playerId) {
        const effectOwnerSocket = io.sockets.sockets.get(pendingEffect.playerId)
        if (effectOwnerSocket) {
          effectOwnerSocket.emit(SOCKET_EVENTS.SELECT_TARGET_PROMPT, {
            validTargets: pendingEffect.validTargets,
            message: pendingEffect.message,
            maxSelect: pendingEffect.maxSelect,
            sourceCardName: pendingEffect.sourceCardName,
          })
        }
      }
      
      broadcastGameState(room)
      // Check for game end
      if (room.engine.winner) {
        handleGameEnd(room)
      }
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // 兼容旧版：立即使用反击卡（现在内部转为暂存+确认）
  socket.on(SOCKET_EVENTS.USE_COUNTER_CARD, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    // 先暂存
    const stageResult = room.engine.stageCounterCard(socket.id, cardInstanceId)
    if (!stageResult.success) {
      socket.emit('error', { message: stageResult.message })
      return
    }

    // 如果需要交互，广播 pendingEffect
    if (stageResult.needsInteraction) {
      broadcastPendingEffect(room, socket.id)
      broadcastGameState(room)
      return
    }

    // 自动确认
    const confirmResult = room.engine.confirmCounter(socket.id)
    if (confirmResult.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: confirmResult.message })
    }
  })

  // 添加手动反击力量（不使用卡牌）
  socket.on('game:add-manual-counter', ({ power }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.addManualCounterPower(socket.id, power)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // 处理目标选择结果
  socket.on(SOCKET_EVENTS.SELECT_TARGET_RESULT, ({ selectedInstanceIds }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.resolveSelectTarget(socket.id, selectedInstanceIds || [])
    if (result.success) {
      // 检查是否产生了新的 pendingEffect (如 KO 后触发 ON_KO 效果)
      const pendingEffect = room.engine.pendingEffect
      if (pendingEffect?.playerId) {
        broadcastPendingEffect(room, pendingEffect.playerId)
      }
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
      // 检查是否有触发效果待处理
      if (result.outcome === 'TRIGGER_PENDING' && result.pendingTrigger) {
        // 广播触发效果给防守方玩家选择
        const defenderId = room.engine.pendingTrigger?.playerId
        if (defenderId) {
          const triggerCard = room.engine.pendingTrigger.card
          io.to(defenderId).emit('game:trigger-prompt', {
            cardNumber: result.pendingTrigger.cardNumber,
            cardName: result.pendingTrigger.cardName,
            triggerText: result.pendingTrigger.triggerText,
            instanceId: result.pendingTrigger.instanceId,
            card: triggerCard ? room.engine._sanitizeCard(triggerCard) : null,
          })
        }
        broadcastGameState(room)
        return
      }
      
      // 检查战斗结算后是否产生了 pendingEffect (如 ON_KO 触发的效果)
      const pendingEffect = room.engine.pendingEffect
      if (pendingEffect?.playerId) {
        broadcastPendingEffect(room, pendingEffect.playerId)
      }
      
      broadcastGameState(room)
      // Check for game end
      if (room.engine.winner) {
        handleGameEnd(room)
      }
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // 响应触发效果（发动或跳过）
  socket.on('game:respond-trigger', ({ activate }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.respondToTrigger(socket.id, activate)
    if (result.success) {
      // 检查是否还有下一个触发效果 (双重攻击时)
      if (result.nextTrigger) {
        const triggerCard = room.engine.pendingTrigger?.card
        io.to(socket.id).emit('game:trigger-prompt', {
          cardNumber: result.nextTrigger.cardNumber,
          cardName: result.nextTrigger.cardName,
          triggerText: result.nextTrigger.triggerText,
          instanceId: result.nextTrigger.instanceId,
          card: triggerCard ? room.engine._sanitizeCard(triggerCard) : null,
        })
        broadcastGameState(room)
        return
      }

      // 检查触发效果执行后是否有 pendingEffect (需要选择目标)
      if (result.hasPendingEffect || room.engine.pendingEffect) {
        const pendingEffect = room.engine.pendingEffect
        if (pendingEffect?.playerId) {
          broadcastPendingEffect(room, pendingEffect.playerId)
        }
      }
      
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
      // 检查是否产生了新的 pendingEffect (ON_KO 触发)
      const pendingEffect = room.engine.pendingEffect
      if (pendingEffect?.type === 'SELECT_TARGET' && pendingEffect.playerId) {
        const effectOwnerSocket = io.sockets.sockets.get(pendingEffect.playerId)
        if (effectOwnerSocket) {
          effectOwnerSocket.emit(SOCKET_EVENTS.SELECT_TARGET_PROMPT, {
            validTargets: pendingEffect.validTargets,
            message: pendingEffect.message,
            maxSelect: pendingEffect.maxSelect,
            sourceCardName: pendingEffect.sourceCardName,
          })
        }
      }
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

  // VIEW TOP DECK (只允许效果触发时使用)
  socket.on(SOCKET_EVENTS.VIEW_TOP_DECK, ({ count }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return
    
    // 检查是否有待决效果（只允许效果触发时使用）
    if (!room.engine.pendingEffect || room.engine.pendingEffect.type !== 'SEARCH') {
      socket.emit('error', { message: '只能在效果触发时查看牌组顶' })
      return
    }
    
    const result = room.engine.viewTopDeck(socket.id, count || 1)
    if (result.success) {
      socket.emit('game:view-top-result', { cards: result.cards })
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // RESOLVE SEARCH (只允许效果触发时使用)
  socket.on(SOCKET_EVENTS.RESOLVE_SEARCH, ({ selectedIds, bottomIds }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return
    
    const result = room.engine.resolveSearch(socket.id, selectedIds || [], bottomIds || [])
    if (result.success) {
      // 通知对手检索了哪些卡
      if (selectedIds && selectedIds.length > 0) {
        const player = room.engine._getPlayer(socket.id)
        const opponent = room.engine._getOpponent(socket.id)
        if (opponent) {
          const oppSocket = io.sockets.sockets.get(opponent.id)
          if (oppSocket) {
            const addedCards = (player?.hand || []).slice(-selectedIds.length)
            oppSocket.emit('search:revealed', {
              cards: addedCards.map(c => ({
                name: c.nameCn || c.name,
                cardNumber: c.cardNumber,
                imageUrl: c.imageUrl,
              })),
            })
          }
        }
      }
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

  // SEARCH DECK (只允许效果触发时使用)
  socket.on(SOCKET_EVENTS.SEARCH_DECK, ({ filter }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return
    
    // 检查是否有待决效果（只允许效果触发时使用）
    if (!room.engine.pendingEffect) {
      socket.emit('error', { message: '只能在效果触发时检索牌组' })
      return
    }
    
    const result = room.engine.searchDeckFiltered(socket.id, filter || {})
    if (result.success) {
      socket.emit('game:search-result', { cards: result.cards })
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // PICK FROM DECK (只允许效果触发时使用)
  socket.on(SOCKET_EVENTS.PICK_FROM_DECK, ({ cardInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return
    
    // 检查是否有待决效果（只允许效果触发时使用）
    if (!room.engine.pendingEffect) {
      socket.emit('error', { message: '只能在效果触发时从牌组选取卡牌' })
      return
    }
    
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

  // RESOLVE PENDING EFFECT (玩家选择效果目标)
  socket.on(SOCKET_EVENTS.RESOLVE_EFFECT, ({ targetInstanceId }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.resolveEffectTarget(socket.id, targetInstanceId)
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // RESOLVE DISCARD (玩家选择丢弃的手牌)
  socket.on('game:resolve-discard', ({ cardInstanceIds }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.resolveDiscard(socket.id, cardInstanceIds || [])
    if (result.success) {
      // 检查是否有新的 pendingEffect (如 RECOVER_FROM_TRASH)
      const pe = room.engine.pendingEffect
      if (pe) {
        broadcastPendingEffect(room, socket.id)
      }
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // RESOLVE RECOVER (玩家选择从废弃区回收的卡牌)
  socket.on('game:resolve-recover', ({ cardInstanceIds }) => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.resolveRecover(socket.id, cardInstanceIds || [])
    if (result.success) {
      broadcastGameState(room)
    } else {
      socket.emit('error', { message: result.message })
    }
  })

  // SKIP PENDING EFFECT (跳过效果)
  socket.on(SOCKET_EVENTS.SKIP_EFFECT, () => {
    const room = roomManager.getRoomBySocket(socket.id)
    if (!room?.engine) return

    const result = room.engine.skipEffect(socket.id)
    if (result.success) {
      broadcastGameState(room)
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

async function startGame(room, options = {}) {
  const { useTestDeck = false } = options
  console.log(`[DEBUG] startGame called for room ${room.id}, useTestDeck: ${useTestDeck}`)
  try {
    console.log(`[DEBUG] Creating GameEngine...`)
    const engine = new GameEngine(room)
    console.log(`[DEBUG] GameEngine created, setting room engine...`)
    roomManager.setEngine(room.id, engine)
    console.log(`[DEBUG] Starting game (async)...`)
    const initialState = await engine.startGame({ useTestDeck })
    console.log(`[DEBUG] Game started, broadcasting to players...`)

    room.players.forEach((player) => {
      console.log(`[DEBUG] Broadcasting to ${player.socketId}...`)
      const state = engine.getStateForPlayer(player.socketId)
      io.to(player.socketId).emit(SOCKET_EVENTS.GAME_START, { roomId: room.id, userId: player.userId, ...state })
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

/**
 * 广播 pendingEffect 给对应玩家
 * 根据 pendingEffect 的类型发送不同事件
 */
function broadcastPendingEffect(room, socketId) {
  const effect = room.engine.pendingEffect
  if (!effect) return false
  if (effect.playerId !== socketId) {
    return false
  }

  switch (effect.type) {
    case 'SEARCH':
      io.to(socketId).emit('game:view-top-result', {
        cards: effect.cards,
        filter: effect.filter,
        maxSelect: effect.maxSelect,
        sourceCardName: effect.sourceCardName,
      })
      break
    case 'SELECT_TARGET':
    case 'KO_TARGET':
    case 'ATTACH_DON':
      io.to(socketId).emit('game:select-target-prompt', {
        type: effect.type,
        validTargets: effect.validTargets || [],
        message: effect.message || '选择目标',
        maxSelect: effect.maxSelect || 1,
        sourceCardName: effect.sourceCardName || '',
        optional: effect.optional ?? false,
      })
      break
    case 'DISCARD':
      io.to(socketId).emit('game:discard-prompt', {
        type: 'DISCARD',
        validCards: effect.validCards || [],
        count: effect.count || 1,
        message: effect.message || '丢弃手牌',
        optional: effect.optional ?? false,
        sourceCardName: effect.sourceCardName || '',
      })
      break
    case 'RECOVER_FROM_TRASH':
      io.to(socketId).emit('game:recover-prompt', {
        type: 'RECOVER_FROM_TRASH',
        validCards: effect.validCards || [],
        maxSelect: effect.maxSelect || 1,
        message: effect.message || '从废弃区选择卡牌',
        optional: effect.optional ?? false,
        sourceCardName: effect.sourceCardName || '',
      })
      break
    default:
      console.log(`[pendingEffect] Unknown type: ${effect.type}`)
      return false
  }
  return true
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
