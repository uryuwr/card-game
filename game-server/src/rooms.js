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
  /** @type {Array<{socketId: string, name: string, deckId: string, timestamp: number}>} */
    this.matchmakingQueue = []
  }

  /**
   * Create a new room with deck selection
   */
  createRoom(socketId, playerName, deckId) {
    const roomId = uuidv4().slice(0, 8).toUpperCase()
    const room = {
      id: roomId,
      players: [{ 
        socketId, 
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
    return room
  }

  /**
   * Join an existing room
   */
  joinRoom(roomId, socketId, playerName, deckId) {
    const room = this.rooms.get(roomId)
    if (!room || room.players.length >= 2) return null
    if (room.status !== 'waiting') return null

    room.players.push({ 
      socketId, 
      name: playerName,
      deckId,
      ready: false,
    })
    this.socketToRoom.set(socketId, roomId)
    return room
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
   * Remove player from room
   */
  removePlayer(socketId) {
    const roomId = this.socketToRoom.get(socketId)
    if (!roomId) return null
    
    this.socketToRoom.delete(socketId)

    const room = this.rooms.get(roomId)
    if (room) {
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
