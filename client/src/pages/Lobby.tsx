/**
 * ONE PIECE CARD GAME - Lobby Page
 * Room creation, joining, and matchmaking
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../contexts/GameContext'
import { socketService } from '../services/socket'
import { apiService } from '../services/api'
import type { Deck } from '../services/api'
import './Lobby.css'

// 用户ID - 后续可以从登录系统获取
const USER_ID = 'system'

export default function Lobby() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('playerName') || '')
  const [roomId, setRoomId] = useState('')
  const [decks, setDecks] = useState<Deck[]>([])
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [deckLoading, setDeckLoading] = useState(false)
  const [deckError, setDeckError] = useState<string | null>(null)
  const [mode, setMode] = useState<'menu' | 'room' | 'matchmaking'>('menu')
  const [isConnecting, setIsConnecting] = useState(false)
  const [waitingRooms, setWaitingRooms] = useState<any[]>([])

  // Fetch decks from API
  const fetchDecks = async () => {
    setDeckLoading(true)
    setDeckError(null)
    try {
      const data = await apiService.getDecks(USER_ID)
      setDecks(data)
      if (data.length > 0 && !selectedDeckId) {
        setSelectedDeckId(data[0].id)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载卡组失败'
      setDeckError(message)
      console.error('Failed to fetch decks:', err)
    } finally {
      setDeckLoading(false)
    }
  }

  useEffect(() => {
    fetchDecks()
  }, [])

  // Save name to localStorage
  useEffect(() => {
    if (playerName) {
      localStorage.setItem('playerName', playerName)
    }
  }, [playerName])

  // Socket event handlers
  useEffect(() => {
    const socket = socketService.connect()
    if (!socket) return

    const handleRoomCreated = (data: any) => {
      dispatch({ type: 'SET_ROOM', roomId: data.roomId, room: data.room })
      setMode('room')
      setIsConnecting(false)
    }

    const handleRoomJoined = (data: any) => {
      console.log('[Lobby] room:joined received:', data)
      dispatch({ type: 'SET_ROOM', roomId: data.roomId, room: data.room })
      setMode('room')
      setIsConnecting(false)
    }

    const handleRoomUpdate = (data: any) => {
      console.log('[Lobby] room:update received:', data)
      dispatch({ type: 'UPDATE_ROOM', room: data.room })
    }

    const handleGameStart = (data: any) => {
      console.log('[Lobby] game:start received:', data)
      console.log('[Lobby] state.roomId:', state.roomId)
      const gameRoomId = data.roomId || state.roomId
      console.log('[Lobby] navigating to:', `/game/${gameRoomId}`)
      if (gameRoomId) {
        navigate(`/game/${gameRoomId}`)
      } else {
        console.error('No roomId available for game start')
      }
    }

    const handleMatchmakingWaiting = (_data: any) => {
      setMode('matchmaking')
      setIsConnecting(false)
    }

    const handleMatchmakingFound = (data: any) => {
      dispatch({ type: 'SET_ROOM', roomId: data.roomId, room: data.room })
      // Game will start automatically
    }

    const handleRoomList = (data: any) => {
      setWaitingRooms(data.rooms || [])
    }

    const handleError = (data: any) => {
      dispatch({ type: 'SET_ERROR', error: data.message })
      setIsConnecting(false)
    }

    socket.on('room:created', handleRoomCreated)
    socket.on('room:joined', handleRoomJoined)
    socket.on('room:update', handleRoomUpdate)
    socket.on('game:start', handleGameStart)
    socket.on('matchmaking:waiting', handleMatchmakingWaiting)
    socket.on('matchmaking:found', handleMatchmakingFound)
    socket.on('room:list', handleRoomList)
    socket.on('error', handleError)

    // Fetch room list periodically
    const interval = setInterval(() => {
      if (mode === 'menu') {
        socket.emit('room:list')
      }
    }, 5000)

    // Initial fetch
    socket.emit('room:list')

    return () => {
      socket.off('room:created', handleRoomCreated)
      socket.off('room:joined', handleRoomJoined)
      socket.off('room:update', handleRoomUpdate)
      socket.off('game:start', handleGameStart)
      socket.off('matchmaking:waiting', handleMatchmakingWaiting)
      socket.off('matchmaking:found', handleMatchmakingFound)
      socket.off('room:list', handleRoomList)
      socket.off('error', handleError)
      clearInterval(interval)
    }
  }, [dispatch, navigate, state.roomId, mode])

  // Connect to server on mount
  useEffect(() => {
    const socket = socketService.connect()
    
    if (socket?.connected) {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' })
      dispatch({ type: 'SET_PHASE', phase: 'lobby' })
    } else {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connecting' })
    }

    const handleConnect = () => {
      console.log('[Lobby] Socket connected!')
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' })
      dispatch({ type: 'SET_PHASE', phase: 'lobby' })
    }

    const handleDisconnect = () => {
      console.log('[Lobby] Socket disconnected!')
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' })
    }

    socket?.on('connect', handleConnect)
    socket?.on('disconnect', handleDisconnect)

    return () => {
      socket?.off('connect', handleConnect)
      socket?.off('disconnect', handleDisconnect)
    }
  }, [dispatch])

  // =====================
  // HANDLERS
  // =====================

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      dispatch({ type: 'SET_ERROR', error: '请输入昵称' })
      return
    }
    if (!selectedDeckId) {
      dispatch({ type: 'SET_ERROR', error: '请选择卡组' })
      return
    }
    setIsConnecting(true)
    socketService.createRoom(playerName, selectedDeckId)
  }

  const handleJoinRoom = () => {
    if (!playerName.trim() || !roomId.trim()) {
      dispatch({ type: 'SET_ERROR', error: '请输入昵称和房间ID' })
      return
    }
    if (!selectedDeckId) {
      dispatch({ type: 'SET_ERROR', error: '请选择卡组' })
      return
    }
    setIsConnecting(true)
    socketService.joinRoom(roomId.toUpperCase(), playerName, selectedDeckId)
  }

  const handleQuickJoin = (targetRoomId: string) => {
    if (!playerName.trim()) {
      dispatch({ type: 'SET_ERROR', error: '请输入昵称' })
      return
    }
    if (!selectedDeckId) {
      dispatch({ type: 'SET_ERROR', error: '请选择卡组' })
      return
    }
    setIsConnecting(true)
    socketService.joinRoom(targetRoomId, playerName, selectedDeckId)
  }

  const handleMatchmaking = () => {
    if (!playerName.trim()) {
      dispatch({ type: 'SET_ERROR', error: '请输入昵称' })
      return
    }
    if (!selectedDeckId) {
      dispatch({ type: 'SET_ERROR', error: '请选择卡组' })
      return
    }
    setIsConnecting(true)
    socketService.joinMatchmaking(playerName, selectedDeckId)
  }

  const handleCancelMatchmaking = () => {
    socketService.leaveMatchmaking()
    setMode('menu')
  }

  const handleReady = () => {
    socketService.setReady(true)
  }

  const handleLeaveRoom = () => {
    socketService.leaveRoom()
    dispatch({ type: 'CLEAR_ROOM' })
    setMode('menu')
  }

  // =====================
  // RENDER
  // =====================

  // Debug info
  console.log('[Lobby Render] mode:', mode, 'state.room:', state.room, 'state.roomId:', state.roomId)

  // Room waiting screen
  if (mode === 'room' && state.room) {
    return (
      <div className="lobby">
        <h1>🏴‍☠️ ONE PIECE CARD GAME</h1>
        <div className="room-waiting">
          <h2>房间 {state.roomId}</h2>
          <div className="players-list">
            {state.room.players.map((player, index) => (
              <div key={index} className={`player-item ${player.ready ? 'ready' : ''}`}>
                <span className="player-name">{player.name}</span>
                <span className="player-leader">卡组已选择</span>
                <span className={`ready-status ${player.ready ? 'is-ready' : ''}`}>
                  {player.ready ? '✓ 准备就绪' : '等待中...'}
                </span>
              </div>
            ))}
            {state.room.players.length < 2 && (
              <div className="player-item empty">
                <span>等待对手加入...</span>
              </div>
            )}
          </div>
          <div className="room-actions">
            {state.room.players.length === 2 && (
              <button className="btn btn-primary" onClick={handleReady}>
                准备就绪
              </button>
            )}
            <button className="btn btn-secondary" onClick={handleLeaveRoom}>
              离开房间
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Matchmaking screen
  if (mode === 'matchmaking') {
    return (
      <div className="lobby">
        <h1>🏴‍☠️ ONE PIECE CARD GAME</h1>
        <div className="matchmaking">
          <div className="matchmaking-spinner" />
          <h2>正在匹配对手...</h2>
          <p>卡组: {decks.find(d => d.id === selectedDeckId)?.name || selectedDeckId}</p>
          <button className="btn btn-secondary" onClick={handleCancelMatchmaking}>
            取消匹配
          </button>
        </div>
      </div>
    )
  }

  // Main lobby menu
  return (
    <div className="lobby">
      <h1>🏴‍☠️ ONE PIECE CARD GAME</h1>
      
      {state.error && (
        <div className="error-message" onClick={() => dispatch({ type: 'SET_ERROR', error: null })}>
          {state.error}
        </div>
      )}
      
      <div className="lobby-form">
        {/* Player Name */}
        <div className="form-section">
          <label>玩家昵称</label>
          <input
            type="text"
            placeholder="输入你的昵称"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="lobby-input"
          />
        </div>

        {/* Deck Selection */}
        <div className="form-section">
          <label>选择卡组</label>
          <div className="leader-select">
            {deckLoading && (
              <div className="leader-loading">卡组加载中...</div>
            )}
            {!deckLoading && deckError && (
              <div className="leader-loading">
                {deckError}
                <button className="btn btn-secondary" onClick={fetchDecks}>重试</button>
              </div>
            )}
            {!deckLoading && !deckError && decks.length === 0 && (
              <div className="leader-loading">暂无卡组，请先创建卡组</div>
            )}
            {!deckLoading && !deckError && decks.length > 0 && (
              decks.map((deck) => (
                <div
                  key={deck.id}
                  className={`leader-option ${selectedDeckId === deck.id ? 'selected' : ''}`}
                  onClick={() => setSelectedDeckId(deck.id)}
                >
                  <span className="leader-emoji">🎴</span>
                  <span className="leader-name">{deck.name}</span>
                  <span className="leader-id">{deck.leader_card_number} ({deck.total_cards}张)</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="lobby-actions">
          <button 
            className="btn btn-primary btn-large"
            onClick={handleMatchmaking}
            disabled={isConnecting || state.connectionStatus !== 'connected' || !selectedDeckId}
          >
            {isConnecting ? '连接中...' : '🎮 快速匹配'}
          </button>

          <div className="lobby-divider">或</div>

          <div className="lobby-row">
            <button 
              className="btn btn-secondary"
              onClick={handleCreateRoom}
              disabled={isConnecting || !selectedDeckId}
            >
              创建房间
            </button>
          </div>
          <div className="lobby-row join-room-row">
            <input
              type="text"
              placeholder="房间ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              className="lobby-input room-id-input"
            />
            <button 
              className="btn btn-secondary"
              onClick={handleJoinRoom}
              disabled={isConnecting || !roomId || !selectedDeckId}
            >
              加入
            </button>
          </div>
        </div>

        {/* Available Rooms */}
        {waitingRooms.length > 0 && (
          <div className="waiting-rooms">
            <h3>公开房间</h3>
            {waitingRooms.map((room) => (
              <div 
                key={room.id} 
                className="room-item"
                onClick={() => handleQuickJoin(room.id)}
              >
                <span className="room-host">{room.hostName}</span>
                <span className="room-leader">{room.hostLeader}</span>
                <span className="room-id">{room.id}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn-back" onClick={() => navigate('/')}>
        ← 返回首页
      </button>

      <div className="connection-status">
        {state.connectionStatus === 'connected' ? '🟢 已连接' : 
         state.connectionStatus === 'connecting' ? '🟡 连接中...' : '🔴 未连接'}
      </div>
    </div>
  )
}

