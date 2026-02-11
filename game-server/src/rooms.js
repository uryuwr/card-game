/**
 * ONE PIECE CARD GAME - Room Manager
 * Handles room creation, matchmaking, and player management
 */

import { v4 as uuidv4 } from 'uuid'

export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map()
    /** @type {Map<string, string>} socketId -> roomId */
    this.socketToRoom = new Map()
    /** @type {Map<string, string>} userId -> roomId */
    this.userIdToRoom = new Map()
    /** @type {Map<string, boolean>} userId -> isConnected */
    this.playerConnectionStatus = new Map()
    /** @type {Map<string, NodeJS.Timeout>} userId -> timeoutId */
    this.disconnectTimers = new Map()

    /** @type {Array<{socketId: string, name: string, deckId: string, timestamp: number}>} */
    this.matchmakingQueue = []
  }

  /**
   * Create a new room with deck selection
   */
  createRoom(socketId, playerName, deckId, userId) {
    // If no userId provided, generate one (fallback)
    const finalUserId = userId || uuidv4()
    
    const roomId = uuidv4().slice(0, 8).toUpperCase()
    const room = {
      id: roomId,
      players: [{ 
        socketId, 
        userId: finalUserId,
        name: playerName,
        deckId,
        ready: false,
      }],
      engine: null,
      status: 'waiting', // waiting, starting, playing, finished
      createdAt: Date.now(),
    }
    this.rooms.set(roomId, room)
    this.socketToRoom.set(socketId, roomId)
    this.userIdToRoom.set(finalUserId, roomId)
    this.playerConnectionStatus.set(finalUserId, true)
    
    return { room, userId: finalUserId }
  }

  /**
   * Join an existing room
   */
  joinRoom(roomId, socketId, playerName, deckId, userId) {
    const room = this.rooms.get(roomId)
    if (!room || room.players.length >= 2) return null
    if (room.status !== 'waiting') return null

    // If no userId provided, generate one (fallback)
    const finalUserId = userId || uuidv4()

    room.players.push({ 
      socketId,
      userId: finalUserId,
      name: playerName,
      deckId,
      ready: false,
    })
    this.socketToRoom.set(socketId, roomId)
    this.userIdToRoom.set(finalUserId, roomId)
    this.playerConnectionStatus.set(finalUserId, true)
    
    return { room, userId: finalUserId }
  }

  /**
   * Set player ready status
   */
  setPlayerReady(socketId, ready = true) {
    const room = this.getRoomBySocket(socketId)
    if (!room) return null

    const player = room.players.find(p => p.socketId === socketId)
    if (player) {
      player.ready = ready
    }

    // Check if all players ready
    const allReady = room.players.length === 2 && 
      room.players.every(p => p.ready)
    
    if (allReady) {
      room.status = 'starting'
    }

    return { room, allReady }
  }

  /**
   * Update player's deck selection
   */
  updateDeck(socketId, deckId) {
    const room = this.getRoomBySocket(socketId)
    if (!room) return null

    const player = room.players.find(p => p.socketId === socketId)
    if (player) {
      player.deckId = deckId
    }
    return room
  }

  /**
   * Get room by socket ID
   */
  getRoomBySocket(socketId) {
    const roomId = this.socketToRoom.get(socketId)
    return roomId ? this.rooms.get(roomId) : null
  }

  /**
   * Get room by room ID
   */
  getRoom(roomId) {
    return this.rooms.get(roomId)
  }

  /**
   * Set game engine for room
   */
  setEngine(roomId, engine) {
    const room = this.rooms.get(roomId)
    if (room) {
      room.engine = engine
      room.status = 'playing'
    }
  }

  /**
   * Mark room as finished
   */
  finishRoom(roomId, winnerId) {
    const room = this.rooms.get(roomId)
    if (room) {
      room.status = 'finished'
      room.winnerId = winnerId
    }
  }

  /**
   * Remove player from room (immediately)
   */
  removePlayer(socketId) {
    const roomId = this.socketToRoom.get(socketId)
    if (!roomId) return null
    
    this.socketToRoom.delete(socketId)
    
    const room = this.rooms.get(roomId)
    if (room) {
      const player = room.players.find(p => p.socketId === socketId)
      if (player) {
         this.userIdToRoom.delete(player.userId)
         this.playerConnectionStatus.delete(player.userId)
         if (this.disconnectTimers.has(player.userId)) {
             clearTimeout(this.disconnectTimers.get(player.userId))
             this.disconnectTimers.delete(player.userId)
         }
      }

      room.players = room.players.filter((p) => p.socketId !== socketId)
      if (room.players.length === 0) {
        this.rooms.delete(roomId)
        return null
      }
      // Room still has one player
      room.status = 'waiting'
      return room
    }
    return null
  }

  /**
   * Handle player disconnect (with timeout for reconnection)
   */
  handleDisconnect(socketId) {
    const roomId = this.socketToRoom.get(socketId)
    if (!roomId) return null

    const room = this.rooms.get(roomId)
    if (!room) return null

    const player = room.players.find(p => p.socketId === socketId)
    if (!player) return null

    // Mark as disconnected
    this.playerConnectionStatus.set(player.userId, false)

    // If game is in progress, start grace period timer
    if (room.status === 'playing' || room.status === 'starting') {
      console.log(`[Disconnect] Player ${player.name} (${player.userId}) disconnected. Starting 60s timer.`)
      
      const timer = setTimeout(() => {
        console.log(`[Timeout] Player ${player.name} (${player.userId}) reconnection timeout. Forfeiting game.`)
        // Calculate winner (the other player)
        const winner = room.players.find(p => p.userId !== player.userId)
        
        if (winner) {
            this.finishRoom(roomId, winner.userId) // Mark as finished with winner
            // We should probably notify the winner if they are still connected, 
            // but since we are inside a timeout, we generally rely on the client checking status or 
            // maybe we can emit an event if we had access to 'io' here, but we don't.
            // The RoomManager doesn't emit events directly. 
            // We'll rely on the winner seeing the 'finished' state or connection close later,
            // OR we can pass a callback to handleDisconnect?
            // For now, let's just finish the room. 
            // Ideally we need to emit 'game_over' to the remaining player.
            // We can add an 'onTimeout' callback to this method or class.
            
            if (this.onTimeoutCallback) {
                this.onTimeoutCallback(roomId, winner.userId)
            }
        }
        
        // Use cleanUpRoom logic (simulated by removePlayer for both?)
        // Or just leave it as finished.
        // If we want to clean up:
        // this.removePlayer(player.socketId) // This would convert it to 'waiting' which is wrong.
        
        // Proper cleanup for a finished room would only happen when players leave.
        // But the disconnected player is GONE. So we should remove their socket mapping.
        this.socketToRoom.delete(socketId)
        // And userId mapping? Maybe keep it so they can see the result if they come back late?
        // But for now let's just clean up the timer.
        this.disconnectTimers.delete(player.userId)
        
      }, 60000) // 60 seconds

      this.disconnectTimers.set(player.userId, timer)
      return { action: 'timer_started', room, userId: player.userId }
    } else {
      // If waiting or finished, remove immediately
      return { action: 'removed', room: this.removePlayer(socketId) }
    }
  }

  /**
   * Handle player rejoin
   */
  handleRejoin(socketId, userId) {
    const roomId = this.userIdToRoom.get(userId)
    if (!roomId) return { success: false, error: 'Room not found' }

    const room = this.rooms.get(roomId)
    if (!room) return { success: false, error: 'Room expired' }

    const player = room.players.find(p => p.userId === userId)
    if (!player) return { success: false, error: 'Player not in room' }

    // Clear disconnect timer if exists
    if (this.disconnectTimers.has(userId)) {
      clearTimeout(this.disconnectTimers.get(userId))
      this.disconnectTimers.delete(userId)
      console.log(`[Rejoin] Timer cleared for ${userId}`)
    }

    // Update socket mapping
    const oldSocketId = player.socketId
    if (oldSocketId) {
        this.socketToRoom.delete(oldSocketId) // Remove old socket mapping
    }
    player.socketId = socketId
    this.socketToRoom.set(socketId, roomId)
    this.playerConnectionStatus.set(userId, true)

    return { success: true, room, player, oldSocketId }
  }

  /**
   * Get all public waiting rooms
   */
  getWaitingRooms() {
    const waiting = []
    for (const room of this.rooms.values()) {
      if (room.status === 'waiting' && room.players.length < 2) {
        waiting.push({
          id: room.id,
          hostName: room.players[0]?.name || 'Unknown',
          hostDeckId: room.players[0]?.deckId,
          createdAt: room.createdAt,
        })
      }
    }
    return waiting
  }

  // =====================
  // MATCHMAKING
  // =====================

  /**
   * Add player to matchmaking queue
   */
  addToQueue(socketId, playerName, deckId) {
    // Remove if already in queue
    this.removeFromQueue(socketId)
    
    this.matchmakingQueue.push({
      socketId,
      name: playerName,
      deckId,
      timestamp: Date.now(),
    })

    return this._tryMatch(socketId)
  }

  /**
   * Remove player from queue
   */
  removeFromQueue(socketId) {
    this.matchmakingQueue = this.matchmakingQueue.filter(
      p => p.socketId !== socketId
    )
  }

  /**
   * Try to match with another player in queue
   */
  _tryMatch(socketId) {
    if (this.matchmakingQueue.length < 2) {
      return { matched: false, position: this.matchmakingQueue.length }
    }

    // Simple FIFO matching
    const [player1, player2] = this.matchmakingQueue.splice(0, 2)
    
    // Create room for matched players
    const room = this.createRoom(player1.socketId, player1.name, player1.deckId)
    this.joinRoom(room.id, player2.socketId, player2.name, player2.deckId)
    
    // Auto-ready both players
    room.players.forEach(p => { p.ready = true })
    room.status = 'starting'

    return {
      matched: true,
      room,
      players: [player1, player2],
    }
  }

  /**
   * Get queue position
   */
  getQueuePosition(socketId) {
    const index = this.matchmakingQueue.findIndex(p => p.socketId === socketId)
    return index === -1 ? null : index + 1
  }

  // =====================
  // CLEANUP
  // =====================

  /**
   * Clean up old/stale rooms
   */
  cleanup(maxAgeMs = 3600000) { // 1 hour default
    const now = Date.now()
    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.createdAt > maxAgeMs) {
        // Clear socket mappings
        for (const player of room.players) {
          this.socketToRoom.delete(player.socketId)
        }
        this.rooms.delete(roomId)
      }
    }
  }
}
