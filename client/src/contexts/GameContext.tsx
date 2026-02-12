import React, { createContext, useContext, useReducer, type ReactNode } from 'react'

// ============ ONE PIECE CARD GAME - Types ============

export type CardType = 'LEADER' | 'CHARACTER' | 'EVENT' | 'STAGE'
export type CardColor = 'RED' | 'GREEN' | 'BLUE' | 'PURPLE' | 'BLACK' | 'YELLOW'
export type CardState = 'ACTIVE' | 'RESTED'
export type GamePhase = 'refresh' | 'draw' | 'don' | 'main' | 'battle' | 'end'
export type BattleStep = 'none' | 'attack' | 'block' | 'counter' | 'damage' | 'resolved'

export interface Card {
  instanceId: string
  cardNumber: string
  name: string
  nameCn?: string
  cardType: CardType
  color: CardColor
  cost: number | null
  power: number | null
  counter: number | null
  life: number | null
  attribute?: string
  effect?: string
  trigger?: string
  trait?: string
  rarity?: string
  imageUrl?: string
  hidden?: boolean // For opponent's hand
}

export interface CardSlot {
  card: Card
  attachedDon: number
  state: CardState
  power: number // Current calculated power
  canAttackThisTurn?: boolean
  hasActivateMain?: boolean
}

export interface Player {
  id: string
  name: string
  isSelf?: boolean
  // Leader card
  leader: CardSlot
  // Character area (max 5)
  characters: CardSlot[]
  // Stage card (max 1)
  stage: { card: Card } | null
  // Life area
  lifeCount: number
  // Deck
  deckCount: number
  // Hand
  hand: Card[]
  handCount: number
  // Trash
  trash: Card[]
  // DON!! resources
  donDeckCount: number
  donActive: number
  donRested: number
}

export interface PendingAttack {
  attackerId: string
  attackerInstanceId: string
  attackerCard: Card
  attackerPower: number
  targetId: string
  targetInstanceId: string
  targetCard: Card
  targetPower: number
  isTargetLeader: boolean
  hasDoubleAttack?: boolean
  hasBanish?: boolean
  blockerUsed?: boolean
}

export interface Room {
  id: string
  status: 'waiting' | 'starting' | 'playing' | 'finished'
  players: {
    name: string
    leaderCard: string
    ready: boolean
    isSelf?: boolean
  }[]
  createdAt: number
}

export interface GameState {
  // Connection state
  phase: 'idle' | 'connecting' | 'lobby' | 'matchmaking' | 'room' | 'playing' | 'ended'
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  
  // Room info
  roomId: string | null
  room: Room | null
  
  // Game state
  gamePhase: GamePhase
  battleStep: BattleStep
  turnNumber: number
  currentTurn: string | null
  pendingAttack: PendingAttack | null
  pendingCounterPower: number
  stagedCounterCards: Array<{
    card: Card
    counterValue: number
    donCostPaid: number
    powerModsApplied: Array<{ targetId: string; amount: number }>
    effectType: string
    expiry: string
  }>
  activeEffects: Array<{
    type: string
    targetId?: string
    amount?: number
    expiry: string
    sourceName?: string
  }>
  
  // Players
  player: Player | null
  opponent: Player | null
  
  // Result
  winner: string | null
  
  // Opponent Status
  opponentReconnecting: boolean
  opponentReconnectingTimeout?: number
  
  // UI state
  selectedCard: string | null
  targetingMode: 'none' | 'attack' | 'blocker' | 'counter' | 'effect'
  
  // Action log
  actionLog: { message: string; timestamp: number }[]
  
  // Error
  error: string | null
}

const normalizeCardState = (state?: string): CardState => {
  if (state === 'active' || state === 'ACTIVE') return 'ACTIVE'
  if (state === 'rested' || state === 'RESTED') return 'RESTED'
  return 'ACTIVE'
}

const normalizePlayer = (player: Player | null): Player | null => {
  if (!player) return player
  return {
    ...player,
    leader: {
      ...player.leader,
      state: normalizeCardState(player.leader.state),
    },
    characters: player.characters.map((slot) => ({
      ...slot,
      state: normalizeCardState(slot.state),
    })),
  }
}

type GameAction =
  | { type: 'SET_PHASE'; phase: GameState['phase'] }
  | { type: 'SET_CONNECTION_STATUS'; status: GameState['connectionStatus'] }
  | { type: 'SET_ROOM'; roomId: string; room: Room }
  | { type: 'UPDATE_ROOM'; room: Room }
  | { type: 'CLEAR_ROOM' }
  | { type: 'GAME_START'; player: Player; opponent: Player; phase: GamePhase; turnNumber: number; currentTurn: string }
  | { type: 'GAME_UPDATE'; state: Partial<GameState>; players: Player[] }
  | { type: 'GAME_SYNC'; roomId: string; state: Partial<GameState>; players: Player[] }
  | { type: 'SET_PENDING_ATTACK'; attack: PendingAttack | null; battleStep: BattleStep }
  | { type: 'SET_SELECTED_CARD'; cardId: string | null }
  | { type: 'SET_TARGETING_MODE'; mode: GameState['targetingMode'] }
  | { type: 'ADD_LOG'; message: string }
  | { type: 'SET_WINNER'; winner: string }
  | { type: 'SET_OPPONENT_RECONNECTING'; isReconnecting: boolean; timeout?: number }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' }

// ============ Initial State ============
const initialState: GameState = {
  phase: 'idle',
  connectionStatus: 'disconnected',
  roomId: null,
  room: null,
  gamePhase: 'main',
  battleStep: 'none',
  turnNumber: 0,
  currentTurn: null,
  pendingAttack: null,
  pendingCounterPower: 0,
  stagedCounterCards: [],
  activeEffects: [],
  player: null,
  opponent: null,
  winner: null,
  opponentReconnecting: false,
  selectedCard: null,
  targetingMode: 'none',
  actionLog: [],
  error: null,
}

// ============ Reducer ============
function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_PHASE':
      return { ...state, phase: action.phase, error: null }
    
    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.status }
    
    case 'SET_ROOM':
      return { 
        ...state, 
        roomId: action.roomId, 
        room: action.room, 
        phase: 'room',
        error: null,
      }
    
    case 'UPDATE_ROOM':
      return { ...state, room: action.room }
    
    case 'CLEAR_ROOM':
      return { 
        ...state, 
        roomId: null, 
        room: null, 
        phase: 'lobby',
      }
    
    case 'GAME_START': {
      return {
        ...state,
        phase: 'playing',
        player: normalizePlayer(action.player),
        opponent: normalizePlayer(action.opponent),
        gamePhase: action.phase,
        turnNumber: action.turnNumber,
        currentTurn: action.currentTurn,
        winner: null,
        pendingAttack: null,
        battleStep: 'none',
        error: null,
      }
    }
    
    case 'GAME_UPDATE': {
      // Find self and opponent from players array
      const self = normalizePlayer(action.players.find(p => p.isSelf) || null)
      const opp = normalizePlayer(action.players.find(p => !p.isSelf) || null)
      
      return {
        ...state,
        ...action.state,
        player: self || state.player,
        opponent: opp || state.opponent,
      }
    }
    case 'GAME_SYNC': {
      // Full state hydration
      const self = normalizePlayer(action.players.find(p => p.isSelf) || null)
      const opp = normalizePlayer(action.players.find(p => !p.isSelf) || null)
      
      return {
        ...state,
        phase: 'playing',
        roomId: action.roomId,
        ...action.state,
        player: self || state.player,
        opponent: opp || state.opponent,
        error: null,
      }
    }    
    case 'SET_PENDING_ATTACK':
      return { 
        ...state, 
        pendingAttack: action.attack,
        battleStep: action.battleStep,
      }
    
    case 'SET_SELECTED_CARD':
      return { ...state, selectedCard: action.cardId }
    
    case 'SET_TARGETING_MODE':
      return { ...state, targetingMode: action.mode }
    
    case 'ADD_LOG':
      return {
        ...state,
        actionLog: [
          ...state.actionLog.slice(-49),
          { message: action.message, timestamp: Date.now() },
        ],
      }
    
    case 'SET_WINNER':
      return { ...state, winner: action.winner, phase: 'ended' }

    case 'SET_OPPONENT_RECONNECTING':
      return { 
        ...state, 
        opponentReconnecting: action.isReconnecting,
        opponentReconnectingTimeout: action.timeout 
      }
    
    case 'SET_ERROR':
      return { ...state, error: action.error }
    
    case 'RESET':
      return { ...initialState, connectionStatus: state.connectionStatus }
    
    default:
      return state
  }
}

// ============ Context ============
const GameContext = createContext<{
  state: GameState
  dispatch: React.Dispatch<GameAction>
} | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState)
  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  )
}

export function useGame() {
  const context = useContext(GameContext)
  if (!context) throw new Error('useGame must be used within GameProvider')
  return context
}

// ============ Selectors ============
export function useIsMyTurn() {
  const { state } = useGame()
  return state.player?.id === state.currentTurn
}

export function useCanPlayCard() {
  const { state } = useGame()
  return state.gamePhase === 'main' && state.player?.id === state.currentTurn
}

export function useCanAttack() {
  const { state } = useGame()
  return state.gamePhase === 'battle' && state.player?.id === state.currentTurn && !state.pendingAttack
}

export function useIsDefending() {
  const { state } = useGame()
  return state.pendingAttack && state.player?.id !== state.currentTurn
}

