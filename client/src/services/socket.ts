/**
 * ONE PIECE CARD GAME - Socket Service
 * Handles all Socket.IO communication with the game server
 */

import { io, type Socket } from 'socket.io-client'

// 动态获取主机地址，支持局域网访问
const getGameServerUrl = () => {
  if (import.meta.env.VITE_GAME_SERVER_URL) {
    return import.meta.env.VITE_GAME_SERVER_URL
  }
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `http://${host}:3001`
}
const GAME_SERVER_URL = getGameServerUrl()

class SocketService {
  private socket: Socket | null = null

  connect() {
    // If socket already exists and is connected or actively connecting, reuse it
    if (this.socket?.connected || this.socket?.active) return this.socket
    // Destroy stale socket that's no longer usable
    if (this.socket) {
      console.log('[Socket] Destroying stale socket, creating fresh connection')
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
    this.socket = io(GAME_SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
    return this.socket
  }

  /** Force destroy and recreate the socket (use when entering lobby fresh) */
  forceReconnect() {
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
    return this.connect()
  }

  disconnect() {
    this.socket?.disconnect()
    this.socket = null
  }

  getSocket() {
    return this.socket
  }

  // =====================
  // TOKEN MANAGEMENT
  // =====================
  saveToken(token: string) {
    localStorage.setItem('card_game_token', token)
  }

  getToken() {
    return localStorage.getItem('card_game_token')
  }

  clearToken() {
    localStorage.removeItem('card_game_token')
  }

  // =====================
  // ROOM OPERATIONS  
  // =====================
  
  createRoom(playerName: string, deckId: string) {
    // If we have an existing token, we might want to send it? 
    // But createRoom implies a new game. 
    // Server supports receiving userId to maintain identity if needed, 
    // but typically create room is a new session. 
    // Let's pass userId if we have it? No, keep it simple for now or check server.
    // Server: createRoom(socketId, playerName, deckId, userId)
    const userId = this.getToken() || undefined
    this.socket?.emit('room:create', { playerName, deckId, userId })
  }

  joinRoom(roomId: string, playerName: string, deckId: string) {
    const userId = this.getToken() || undefined
    this.socket?.emit('room:join', { roomId, playerName, deckId, userId })
  }

  rejoinGame(userId: string) {
    this.socket?.emit('game:rejoin', { userId })
  }

  leaveRoom() {
    this.socket?.emit('room:leave')
    this.clearToken()
  }

  setReady(ready: boolean) {
    this.socket?.emit('room:ready', { ready })
  }

  // =====================
  // MATCHMAKING
  // =====================

  joinMatchmaking(playerName: string, deckId: string) {
    this.socket?.emit('matchmaking:join', { playerName, deckId })
  }

  leaveMatchmaking() {
    this.socket?.emit('matchmaking:leave')
  }

  // =====================
  // GAME ACTIONS - MAIN PHASE
  // =====================

  /** Play a Character card from hand to the board */
  playCharacter(cardInstanceId: string, slotIndex: number) {
    this.socket?.emit('game:play-character', { cardInstanceId, slotIndex })
  }

  /** Play an Event card (one-time effect) */
  playEvent(cardInstanceId: string, targets?: string[]) {
    this.socket?.emit('game:play-event', { cardInstanceId, targets })
  }

  /** Play a Stage card (persistent effect) */
  playStage(cardInstanceId: string) {
    this.socket?.emit('game:play-stage', { cardInstanceId })
  }

  /** Attach DON!! card(s) to Leader or Character */
  attachDon(targetId: string, count: number = 1) {
    this.socket?.emit('game:attach-don', { targetId, count })
  }

  /** Detach DON!! card(s) from Leader or Character (return to active area) */
  detachDon(sourceId: string, count: number = 1) {
    this.socket?.emit('game:detach-don', { sourceId, count })
  }

  /** Rest a DON!! card (for effects that require rested DON!!) */
  restDon(donId: string) {
    this.socket?.emit('game:rest-don', { donId })
  }

  /** Activate a card's ability (if it has one) */
  activateAbility(cardId: string, targets?: string[]) {
    this.socket?.emit('game:activate-ability', { cardId, targets })
  }

  /** Activate a card's ACTIVATE_MAIN effect (manually triggered) */
  activateMain(cardInstanceId: string) {
    this.socket?.emit('game:activate-main', { cardInstanceId })
  }

  // =====================
  // GAME ACTIONS - BATTLE PHASE
  // =====================

  /** Declare an attack from Character/Leader to opposing Leader/Character */
  declareAttack(attackerId: string, targetId: string) {
    this.socket?.emit('game:declare-attack', { attackerId, targetId })
  }

  /** Defender declares a Blocker to intercept the attack */
  declareBlocker(blockerId: string) {
    this.socket?.emit('game:declare-blocker', { blockerId })
  }

  /** Defender skips using a Blocker */
  skipBlocker() {
    this.socket?.emit('game:skip-blocker')
  }

  /** Defender plays Counter card(s) from hand */
  playCounter(cardInstanceId: string | string[], manualPower: number = 0) {
    if (Array.isArray(cardInstanceId)) {
      this.socket?.emit('game:play-counter', { cardInstanceIds: cardInstanceId, manualPower })
      return
    }
    this.socket?.emit('game:play-counter', { cardInstanceId, manualPower })
  }

  /** Defender skips using Counter cards */
  skipCounter() {
    this.socket?.emit('game:skip-counter')
  }

  // =====================
  // PHASE TRANSITIONS
  // =====================

  /** End Main Phase and enter Battle Phase */
  endMainPhase() {
    this.socket?.emit('game:end-main-phase')
  }

  /** End Battle Phase (and your turn) */
  endBattlePhase() {
    this.socket?.emit('game:end-battle-phase')
  }

  /** End turn (alias for endBattlePhase) */
  endTurn() {
    this.socket?.emit('game:end-turn')
  }

  // =====================
  // UTILITY ACTIONS (for complex effects)
  // =====================

  /** Draw cards (for card effects) */
  drawCards(count: number) {
    this.socket?.emit('game:draw-cards', { count })
  }

  /** Send cards to bottom of deck */
  sendToBottom(cardInstanceIds: string[]) {
    this.socket?.emit('game:utility-action', { action: 'sendBottom', cardInstanceIds })
  }

  /** Search deck for specific card */
  searchDeck(filter?: { type?: string; cost?: number; attribute?: string }) {
    this.socket?.emit('game:search-deck', { filter })
  }

  /** Pick a card from deck search results */
  pickFromDeck(cardInstanceId: string) {
    this.socket?.emit('game:pick-from-deck', { cardInstanceId })
  }

  /** Give temporary power boost */
  powerBoost(targetId: string, amount: number) {
    this.socket?.emit('game:modify-power', { targetId, delta: amount })
  }

  /** Add extra life (for card effects) */
  addLife(count: number = 1) {
    this.socket?.emit('game:utility-action', { action: 'addLife', count })
  }

  /** View top N cards of own deck */
  viewTopDeck(count: number) {
    this.socket?.emit('game:view-top-deck', { count })
  }

  /** Resolve search: select cards to hand, rest to bottom */
  resolveSearch(selectedIds: string[], bottomIds: string[]) {
    this.socket?.emit('game:resolve-search', { selectedIds, bottomIds })
  }

  /** Use a counter card with script effect (e.g., OP01-029) - legacy, now internally stages + confirms */
  useCounterCard(cardInstanceId: string) {
    this.socket?.emit('game:use-counter-card', { cardInstanceId })
  }

  /** Stage a counter card (can be unstaged/cancelled before confirming) */
  stageCounterCard(cardInstanceId: string) {
    this.socket?.emit('game:stage-counter-card', { cardInstanceId })
  }

  /** Unstage (cancel) a previously staged counter card */
  unstageCounterCard(cardInstanceId: string) {
    this.socket?.emit('game:unstage-counter-card', { cardInstanceId })
  }

  /** Confirm all staged counter cards (move to trash and resolve battle) */
  confirmCounter() {
    this.socket?.emit('game:confirm-counter')
  }

  /** Submit target selection result */
  selectTargetResult(selectedInstanceIds: string[]) {
    this.socket?.emit('game:select-target-result', { selectedInstanceIds })
  }

  /** Respond to trigger effect prompt (activate or skip) */
  respondToTrigger(activate: boolean) {
    this.socket?.emit('game:respond-trigger', { activate })
  }

  /** Resolve discard prompt (select cards to discard) */
  resolveDiscard(cardInstanceIds: string[]) {
    this.socket?.emit('game:resolve-discard', { cardInstanceIds })
  }

  /** Resolve recover from trash prompt (select cards to recover) */
  resolveRecover(cardInstanceIds: string[]) {
    this.socket?.emit('game:resolve-recover', { cardInstanceIds })
  }

  /** Take a Life card and add to hand */
  lifeToHand(lifeIndex: number = 0) {
    this.socket?.emit('game:life-to-hand', { lifeIndex })
  }

  /** Set an effect restriction for this turn (e.g., OP02-004: cannot add life to hand) */
  setEffectRestriction(restriction: string, value: boolean = true) {
    this.socket?.emit('game:set-effect-restriction', { restriction, value })
  }

  /** Move card from trash to Life area */
  trashToLife(cardInstanceId: string) {
    this.socket?.emit('game:trash-to-life', { cardInstanceId })
  }

  /** Play a character from trash to the board */
  playFromTrash(cardInstanceId: string, state: 'active' | 'rested') {
    this.socket?.emit('game:play-from-trash', { cardInstanceId, state })
  }

  /** Trash a card from hand (utility) */
  trashFromHand(cardInstanceId: string) {
    this.socket?.emit('game:trash-from-hand', { cardInstanceId })
  }

  /** KO target character (utility) */
  koTarget(targetPlayerId: string, targetInstanceId: string) {
    this.socket?.emit('game:ko-target', { targetPlayerId, targetInstanceId })
  }

  /** Bounce card to hand (utility) */
  bounceToHand(targetPlayerId: string, targetInstanceId: string) {
    this.socket?.emit('game:bounce-hand', { targetPlayerId, targetInstanceId })
  }

  /** Bounce card to bottom of deck (utility) */
  bounceToBottom(targetPlayerId: string, targetInstanceId: string) {
    this.socket?.emit('game:bounce-bottom', { targetPlayerId, targetInstanceId })
  }

  /** Recover card from trash (utility) */
  recoverFromTrash(cardInstanceId: string) {
    this.socket?.emit('game:recover-trash', { cardInstanceId })
  }

  /** Rest a target card (utility) */
  restTarget(targetId: string) {
    this.socket?.emit('game:rest-target', { targetId })
  }

  /** Activate a target card (utility) */
  activateTarget(targetId: string) {
    this.socket?.emit('game:activate-target', { targetId })
  }

  /** Move DON!! between active/rested areas (utility) */
  moveDon(direction: 'rest' | 'activate', count: number = 1) {
    this.socket?.emit('game:move-don', { direction, count })
  }

  // =====================
  // EVENT LISTENERS
  // =====================

  on(event: string, callback: (...args: any[]) => void) {
    this.socket?.on(event, callback)
  }

  off(event: string, callback?: (...args: any[]) => void) {
    this.socket?.off(event, callback)
  }

  once(event: string, callback: (...args: any[]) => void) {
    this.socket?.once(event, callback)
  }
}

export const socketService = new SocketService()

// 暴露到 window 以便于测试
if (typeof window !== 'undefined') {
  (window as any).socketService = socketService
}
