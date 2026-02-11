/**
 * ONE PIECE CARD GAME — Battle Board
 * 攻击动作 + 工具动作 + 领袖效果确认
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useGame, useIsMyTurn, useCanPlayCard, useIsDefending,
} from '../contexts/GameContext'
import { socketService } from '../services/socket'
import CardComponent, { CardBack, DonCard } from '../components/Card'
import RadialMenu from '../components/RadialMenu.tsx'
import type { Card } from '../contexts/GameContext'
import './Game.css'

// ============ Phase map ============
const PHASE_LABELS = [
  { key: 'refresh', num: '1', label: '重置' },
  { key: 'draw',    num: '2', label: '抽卡' },
  { key: 'don',     num: '3', label: 'DON' },
  { key: 'main',    num: '4', label: '主要' },
  { key: 'end',     num: '5', label: '结束' },
]

const PHASE_ORDER = ['refresh', 'draw', 'don', 'main', 'end']

function getPhaseHint(
  phase: string, battleStep: string, isMyTurn: boolean,
  isDefending: boolean, turnNumber: number, pendingAttack: any,
) {
  if (!isMyTurn && !isDefending) return '对手正在行动...'
  switch (phase) {
    case 'refresh': return '重置所有卡牌，归还DON!!'
    case 'draw':
      return turnNumber === 1 && isMyTurn ? '先手第一回合不抽卡' : '从牌组抽1张卡'
    case 'don':
      return turnNumber === 1 && isMyTurn ? '放置1张DON!!到费用区' : '放置2张DON!!到费用区'
    case 'main':
      if (pendingAttack && !isDefending) return '等待对手响应攻击...'
      if (isDefending) {
        if (battleStep === 'block') return '选择【阻挡者】格挡，或跳过'
        if (battleStep === 'counter') return '丢弃反击卡增加力量，或跳过'
        return '对手正在攻击'
      }
      return '出牌 | 贴DON!! | 攻击 | 结束回合'
    case 'battle':
      if (pendingAttack && !isDefending) return '等待对手响应...'
      return '攻击进行中...'
    case 'end': return '回合结束阶段'
    default: return ''
  }
}

// ============ Card size calculations (REFACTORED) ============
// Layout Strategy: Scale to Fit (Landscape) or Vertical (Portrait)
// We detect orientation and provide appropriate constants.

const DESIGN_WIDTH = 1260
const DESIGN_HEIGHT = 880
const MOBILE_DESIGN_WIDTH = 390
const MOBILE_DESIGN_HEIGHT = 844

function useScaledLayout() {
  const [scale, setScale] = useState(1)
  const [windowSize, setWindowSize] = useState({ vw: window.innerWidth, vh: window.innerHeight })
  const [isPortrait, setIsPortrait] = useState(window.innerHeight > window.innerWidth)

  useEffect(() => {
    const onResize = () => {
      const sw = window.innerWidth
      const sh = window.innerHeight
      const portrait = sh > sw
      setWindowSize({ vw: sw, vh: sh })
      setIsPortrait(portrait)

      let s = 1
      if (portrait) {
        // Portrait Mode: Scale based on width primarily
        s = Math.min(sw / MOBILE_DESIGN_WIDTH, sh / MOBILE_DESIGN_HEIGHT)
      } else {
        // Landscape Mode
        s = Math.min(sw / DESIGN_WIDTH, sh / DESIGN_HEIGHT)
      }
      setScale(s)
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Fixed sizes for 1280x880 design (Landscape)
  const landSizes = {
    // 之前 boardH=340 太小了，midCardW=86 太大了
    // 整个画板高度880px - (顶部36 + 对手手牌48 + 我方手牌区域120 + 费用40*2) ≈ 600px 剩余给棋盘
    // 600px / 2 = 300px 半场高度。
    // 但是现在的 params 设的是 boardH=340，其实已经撑满了。
    // 关键修正：调小卡牌基准尺寸，让它们能塞进 340px 的高度里而不溢出。
    boardH: 340, 
    midCardW: 64,   // Reduced from 86 -> 64 (约缩小25%)
    charCardW: 64,  // Reduced from 86 -> 64
    handCardW: 80,  // Reduced from 100 -> 80
    lifeCardW: 36,  // Reduced from 45 -> 36
    donCardW: 32,   // Reduced from 40 -> 32
    previewW: 280,
    designW: DESIGN_WIDTH, designH: DESIGN_HEIGHT
  }
  
  // Fixed sizes for 390x844 design (Portrait)
  // Vertical layout needs smaller cards to fit width
  const portSizes = {
    boardH: 260, midCardW: 56, charCardW: 56, handCardW: 64, lifeCardW: 32, donCardW: 28, previewW: 240,
    designW: MOBILE_DESIGN_WIDTH, designH: MOBILE_DESIGN_HEIGHT
  }

  const current = isPortrait ? portSizes : landSizes

  return { scale, ...current, vw: windowSize.vw, vh: windowSize.vh, isPortrait }
}

// ============ MAIN COMPONENT ============
export default function Game() {
  const { roomId: _roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const isMyTurn = useIsMyTurn()
  useCanPlayCard()
  const isDefending = useIsDefending()
  const sizes = useScaledLayout()

  // UI state
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const [pinnedPreviewId, setPinnedPreviewId] = useState<string | null>(null)
  const [previewOrigin, setPreviewOrigin] = useState<'hand' | 'board' | 'other' | null>(null)
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [targeting, setTargeting] = useState(false)
  const [discardSelectMode, setDiscardSelectMode] = useState(false)
  const [koSelectMode, setKoSelectMode] = useState(false)
  
  // DON选择模式状态
  const [donSelectMode, setDonSelectMode] = useState(false)
  const [selectedDonCount, setSelectedDonCount] = useState(0)
  const [selectedDonFromRested, setSelectedDonFromRested] = useState(0) // 从横置DON选择的数量
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  
  // 轮盘菜单状态
  const [radialMenu, setRadialMenu] = useState<{
    type: 'card' | 'deck' | 'trash' | 'don' | 'leader' | 'character' | 'donArea'
    targetId?: string
    targetCard?: Card
    position: { x: number; y: number }
    attachedDon?: number
    isNew?: boolean // 刚登场的卡
  } | null>(null)
  
  // 本回合新登场的卡牌ID
  const [newlyPlayedCards, setNewlyPlayedCards] = useState<Set<string>>(new Set())
  // 领袖效果确认弹窗
  const [leaderEffectPrompt, setLeaderEffectPrompt] = useState<{
    type: string; message: string
  } | null>(null)
  // 反击选择
  const [selectedCounterIds, setSelectedCounterIds] = useState<Set<string>>(new Set())
  const [counterCollapsed, setCounterCollapsed] = useState(false)
  const [manualCounterPower, setManualCounterPower] = useState(0)
  const [powerAdjustSign, setPowerAdjustSign] = useState<1 | -1>(1)
  const [showCounterPowerModal, setShowCounterPowerModal] = useState(false)
  const [counterPowerDraft, setCounterPowerDraft] = useState(0)
  const [showPowerAdjustModal, setShowPowerAdjustModal] = useState(false)
  const [powerAdjustAmount, setPowerAdjustAmount] = useState(0)
  const [powerAdjustOpenedAt, setPowerAdjustOpenedAt] = useState(0)
  const [counterAdjustOpenedAt, setCounterAdjustOpenedAt] = useState(0)
  // 检索弹窗
  const [viewedCards, setViewedCards] = useState<Card[]>([])
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [selectedSearchIds, setSelectedSearchIds] = useState<Set<string>>(new Set())
  // 墓地查看
  const [showTrashViewer, setShowTrashViewer] = useState<'mine' | 'opp' | null>(null)
  const [selectedTrashCardId, setSelectedTrashCardId] = useState<string | null>(null)
  const [zoneActionMenu, setZoneActionMenu] = useState<'deck' | 'life' | 'trash' | null>(null)
  // 骰子结果弹窗
  const [diceResult, setDiceResult] = useState<{
    myRoll: number; oppRoll: number; iWon: boolean; myName: string; oppName: string
  } | null>(null)
  const lastTapRef = useRef<{ id: string | null; time: number }>({ id: null, time: 0 })
  const suppressPreviewUntilRef = useRef(0)
  const lastPowerAdjustOpenRef = useRef(0)
  const suppressRootClickUntilRef = useRef(0)

  // 能否攻击（主要阶段或战斗阶段，且没有待处理攻击）
  const canAttackNow = useMemo(() => {
    return isMyTurn &&
      (state.gamePhase === 'main' || state.gamePhase === 'battle') &&
      !state.pendingAttack
  }, [isMyTurn, state.gamePhase, state.pendingAttack])

  // ============ Socket Handlers ============
  useEffect(() => {
    const socket = socketService.connect()
    if (!socket) { navigate('/lobby'); return }

    const handleGameStart = (data: any) => {
      // 显示骰子结果
      if (data.diceRolls && data.players?.length === 2) {
        const me = data.players.find((p: any) => p.isSelf)
        const opp = data.players.find((p: any) => !p.isSelf)
        const myIndex = data.players.indexOf(me)
        const myRoll = data.diceRolls[myIndex]
        const oppRoll = data.diceRolls[1 - myIndex]
        setDiceResult({
          myRoll, oppRoll,
          iWon: myRoll > oppRoll,
          myName: me?.name || '你',
          oppName: opp?.name || '对手',
        })
        // 3秒后关闭骰子弹窗
        setTimeout(() => setDiceResult(null), 3500)
      }
      dispatch({
        type: 'GAME_START',
        player: data.players.find((p: any) => p.isSelf),
        opponent: data.players.find((p: any) => !p.isSelf),
        phase: data.phase,
        turnNumber: data.turnNumber,
        currentTurn: data.currentTurn,
      })
    }
    const handleGameUpdate = (data: any) => {
      dispatch({
        type: 'GAME_UPDATE',
        state: {
          gamePhase: data.phase,
          turnNumber: data.turnNumber,
          currentTurn: data.currentTurn,
          pendingAttack: data.pendingAttack,
          battleStep: data.battleStep,
          winner: data.winner,
        },
        players: data.players,
      })
      if (data.actionLog?.length > 0) {
        data.actionLog.slice(-5).forEach((entry: any) =>
          dispatch({ type: 'ADD_LOG', message: entry.message })
        )
      }
    }
    const handleAttackDeclared = (data: any) => {
      dispatch({
        type: 'SET_PENDING_ATTACK',
        attack: data.pendingAttack,
        battleStep: data.battleStep,
      })
    }
    const handleGameEnd = (data: any) => {
      dispatch({ type: 'SET_WINNER', winner: data.winner })
    }
    const handleError = (data: any) => {
      dispatch({ type: 'SET_ERROR', error: data.message })
    }
    // 领袖效果提示（白胡子等）
    const handleLeaderEffectPrompt = (data: any) => {
      setLeaderEffectPrompt({ type: data.type, message: data.message })
    }
    // 检索结果
    const handleViewTopResult = (data: any) => {
      setViewedCards(data.cards)
      setSelectedSearchIds(new Set())
      setShowSearchModal(true)
    }

    socket.on('game:start', handleGameStart)
    socket.on('game:update', handleGameUpdate)
    socket.on('attack:declared', handleAttackDeclared)
    socket.on('game:end', handleGameEnd)
    socket.on('error', handleError)
    socket.on('game:leader-effect-prompt', handleLeaderEffectPrompt)
    socket.on('game:view-top-result', handleViewTopResult)
    if (!state.player) socket.emit('game:sync')

    return () => {
      socket.off('game:start', handleGameStart)
      socket.off('game:update', handleGameUpdate)
      socket.off('attack:declared', handleAttackDeclared)
      socket.off('game:end', handleGameEnd)
      socket.off('error', handleError)
      socket.off('game:leader-effect-prompt', handleLeaderEffectPrompt)
      socket.off('game:view-top-result', handleViewTopResult)
    }
  }, [dispatch, navigate, state.player])

  // ============ Error Auto-Dismiss ============
  useEffect(() => {
    if (state.error) {
      const timer = setTimeout(() => {
        dispatch({ type: 'SET_ERROR', error: null })
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [state.error, dispatch])

  // Reset counter selection when leaving counter step
  useEffect(() => {
    if (!isDefending || state.battleStep !== 'counter') {
      setSelectedCounterIds(new Set())
      setCounterCollapsed(false)
      setManualCounterPower(0)
      setShowCounterPowerModal(false)
      setCounterPowerDraft(0)
    }
  }, [isDefending, state.battleStep])

  useEffect(() => {
    setShowPowerAdjustModal(false)
    setPowerAdjustAmount(0)
  }, [hoveredCard?.instanceId])

  // ============ Action Handlers ============
  // 出牌
  const handlePlayCard = useCallback((card: Card) => {
    if (!isMyTurn) return
    let didPlayMain = false
    if (state.gamePhase === 'main') {
      if (card.cardType === 'CHARACTER') {
        const used = state.player?.characters.length || 0
        if (used >= 5) {
          dispatch({ type: 'SET_ERROR', error: '角色区已满(最多5张)' })
          return
        }
        socketService.playCharacter(card.instanceId, used)
        didPlayMain = true
      } else if (card.cardType === 'EVENT') {
        socketService.playEvent(card.instanceId)
        didPlayMain = true
      } else if (card.cardType === 'STAGE') {
        socketService.playStage(card.instanceId)
        didPlayMain = true
      }
    }
    if (didPlayMain) {
      setHoveredCard(null)
      setPinnedPreviewId(null)
      setPreviewOrigin(null)
    }
    // 反击阶段打反击卡
    if (isDefending && state.battleStep === 'counter') {
      if (card.counter && card.counter > 0) {
        socketService.playCounter(card.instanceId)
      }
    }
  }, [isMyTurn, state.gamePhase, state.player?.characters.length, isDefending, state.battleStep, dispatch])

  // 选择攻击者（通过轮盘菜单）
  const handleSelectAttacker = useCallback((cardId: string, isLeader: boolean) => {
    // 攻击模式
    if (!canAttackNow) {
      dispatch({ type: 'SET_ERROR', error: '当前不能攻击' })
      return
    }
    // 第一回合检查：双方第一回合都不能攻击 (turnNumber 1=先手第一回合, 2=后手第一回合)
    if (state.turnNumber <= 2) {
      dispatch({ type: 'SET_ERROR', error: '第一回合不能攻击' })
      return
    }
    if (isLeader) {
      if (state.player?.leader.state !== 'ACTIVE') {
        dispatch({ type: 'SET_ERROR', error: '领袖未竖置，无法攻击' })
        return
      }
      setSelectedCard('leader')
    } else {
      const slot = state.player?.characters.find(s => s.card.instanceId === cardId)
      if (!slot || slot.state !== 'ACTIVE') {
        dispatch({ type: 'SET_ERROR', error: '角色未竖置，无法攻击' })
        return
      }
      setSelectedCard(cardId)
    }
    setTargeting(true)
    setHoveredCard(null)
    setPinnedPreviewId(null)
    setPreviewOrigin(null)
    setRadialMenu(null)
  }, [canAttackNow, state.player, state.turnNumber, dispatch])

  // 选择攻击目标
  const handleSelectTarget = useCallback((targetId: string) => {
    if (!targeting || !selectedCard) return
    const attackerId = selectedCard === 'leader'
      ? 'leader'
      : selectedCard
    socketService.declareAttack(attackerId, targetId)
    setSelectedCard(null)
    setTargeting(false)
  }, [targeting, selectedCard, state.player])

  // 取消动作
  const cancelAction = useCallback(() => {
    setSelectedCard(null)
    setTargeting(false)
    setRadialMenu(null)
    setHoveredCard(null)
    setPinnedPreviewId(null)
    setPreviewOrigin(null)
    setDonSelectMode(false)
    setSelectedDonCount(0)
    setSelectedDonFromRested(0)
    setDiscardSelectMode(false)
    setKoSelectMode(false)
  }, [])

  // DON选择模式：贴DON到目标
  const handleAttachDonToTarget = useCallback((targetId: string) => {
    if (!donSelectMode || selectedDonCount === 0) return
    socketService.attachDon(targetId, selectedDonCount)
    setDonSelectMode(false)
    setSelectedDonCount(0)
    setSelectedDonFromRested(0)
  }, [donSelectMode, selectedDonCount])

  // DON长按处理：横置/竖置
  const handleDonLongPress = useCallback((type: 'active' | 'rested') => {
    if (type === 'active') {
      // 横置一张active DON
      socketService.moveDon('rest', 1)
    } else {
      // 竖置一张rested DON
      socketService.moveDon('activate', 1)
    }
  }, [])

  // DON点击：进入选择模式或调整选中数量
  const handleDonClick = useCallback((type: 'active' | 'rested', _index: number) => {
    if (!isMyTurn || state.gamePhase !== 'main') return
    
    if (!donSelectMode) {
      // 进入DON选择模式
      setDonSelectMode(true)
      setHoveredCard(null)
      setPinnedPreviewId(null)
      setPreviewOrigin(null)
      if (type === 'active') {
        setSelectedDonCount(1)
        setSelectedDonFromRested(0)
      } else {
        setSelectedDonCount(1)
        setSelectedDonFromRested(1)
      }
    } else {
      // 已在选择模式，调整选中数量
      const maxActive = state.player?.donActive ?? 0
      const maxRested = state.player?.donRested ?? 0
      const totalSelected = selectedDonCount
      
      if (type === 'active') {
        const activeSelected = totalSelected - selectedDonFromRested
        if (activeSelected < maxActive) {
          setSelectedDonCount(prev => prev + 1)
        }
      } else {
        if (selectedDonFromRested < maxRested) {
          setSelectedDonCount(prev => prev + 1)
          setSelectedDonFromRested(prev => prev + 1)
        }
      }
    }
  }, [isMyTurn, state.gamePhase, donSelectMode, selectedDonCount, selectedDonFromRested, state.player?.donActive, state.player?.donRested])

  // DON触摸开始（长按检测）
  const handleDonTouchStart = useCallback((type: 'active' | 'rested', _index: number) => {
    const timer = setTimeout(() => {
      handleDonLongPress(type)
    }, 500) // 500ms长按
    setLongPressTimer(timer)
  }, [handleDonLongPress])

  // DON触摸结束
  const handleDonTouchEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }, [longPressTimer])

  // 轮盘菜单操作处理
  const handleRadialMenuAction = useCallback((actionId: string) => {
    if (!radialMenu) return
    
    const { type, targetId, isNew } = radialMenu
    
    switch (actionId) {
      case 'attack':
        // 攻击
        if (targetId && (type === 'character' || type === 'leader')) {
          handleSelectAttacker(targetId, type === 'leader')
        }
        break
      case 'rest':
        // 横置
        if (targetId) socketService.restTarget(targetId)
        break
      case 'activate':
        // 竖置
        if (targetId) socketService.activateTarget(targetId)
        break
      case 'bounceToHand':
        // 返回手牌（刚登场的卡牌）
        if (isNew && targetId && state.player?.id) {
          socketService.bounceToHand(state.player.id, targetId)
          setNewlyPlayedCards(prev => {
            const next = new Set(prev)
            next.delete(targetId)
            return next
          })
        }
        break
      case 'cancel':
        // 取消
        break
    }
    
    setRadialMenu(null)
  }, [radialMenu, handleSelectAttacker, state.player?.donActive, state.player?.id])

  // 获取轮盘菜单选项
  const getRadialMenuOptions = useCallback(() => {
    if (!radialMenu) return []
    
    const { type, isNew } = radialMenu
    const options: { id: string; label: string; icon?: string; color?: string; disabled?: boolean }[] = []
    
    if (type === 'character' || type === 'leader') {
      // 攻击选项
      const canAttack = canAttackNow && state.turnNumber > 2
      options.push({
        id: 'attack',
        label: '攻击',
        color: '#EF5350',
        disabled: !canAttack
      })
      
      // 返回手牌（仅刚登场的角色）
      if (type === 'character' && isNew) {
        options.push({
          id: 'bounceToHand',
          label: '返回手牌',
          icon: '↩️',
          color: '#9C27B0',
        })
      }
    }
    
    // DON相关操作已移至批量选择模式，不再使用轮盘菜单
    
    // 取消选项
    options.push({
      id: 'cancel',
      label: '取消',
      icon: '✕',
      color: '#666',
    })
    
    return options
  }, [radialMenu, canAttackNow, state.turnNumber, state.player?.donActive])

  // Hover preview handlers
  const handleHover = useCallback((card: Card | null, e?: React.MouseEvent) => {
    if (donSelectMode || targeting || discardSelectMode || koSelectMode) return
    // 如果模态框正在打开，不清除 hover 状态
    if (showPowerAdjustModal) {
      if (card) {
        setHoveredCard(card)
        if (e) setHoverPos({ x: e.clientX, y: e.clientY })
      }
      return
    }
    if (pinnedPreviewId) {
      if (!card || card.instanceId !== pinnedPreviewId) return
    } else {
      setHoveredCard(card)
    }
    if (e && card) {
      setHoverPos({ x: e.clientX, y: e.clientY })
    }
    if (!card && !pinnedPreviewId) {
      setHoveredCard(null)
    }
  }, [pinnedPreviewId, donSelectMode, targeting, discardSelectMode, koSelectMode, showPowerAdjustModal])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (hoveredCard) {
      setHoverPos({ x: e.clientX, y: e.clientY })
    }
  }, [hoveredCard])

  const openPowerAdjustModal = useCallback((e?: React.SyntheticEvent) => {
    if (e) {
      e.stopPropagation()
    }
    const now = Date.now()
    if (now - lastPowerAdjustOpenRef.current < 300) return
    lastPowerAdjustOpenRef.current = now
    setPinnedPreviewId(null)
    setPreviewOrigin(null)
    setShowPowerAdjustModal(true)
    setPowerAdjustOpenedAt(now)
    suppressPreviewUntilRef.current = now + 800
    suppressRootClickUntilRef.current = now + 800
  }, [])

  const handleClickPreview = useCallback((card: Card, e?: React.MouseEvent, origin: 'hand' | 'board' | 'other' = 'other') => {
    if (Date.now() < suppressPreviewUntilRef.current) return
    if (e) e.stopPropagation()
    if (pinnedPreviewId === card.instanceId) {
      setPinnedPreviewId(null)
      setHoveredCard(null)
      setPreviewOrigin(null)
      return
    }
    setPinnedPreviewId(card.instanceId)
    setHoveredCard(card)
    setPreviewOrigin(origin)
    if (e) {
      setHoverPos({ x: e.clientX, y: e.clientY })
    } else {
      setHoverPos({ x: sizes.vw / 2, y: sizes.vh / 2 })
    }
  }, [pinnedPreviewId, sizes.vw, sizes.vh])

  // 领袖效果确认/跳过
  const handleLeaderEffectConfirm = useCallback((confirm: boolean) => {
    if (leaderEffectPrompt?.type === 'whitebeard-end-turn') {
      if (confirm) {
        socketService.lifeToHand(0)
      }
    }
    setLeaderEffectPrompt(null)
    // 无论确认或跳过，继续结束回合
    socketService.endTurn()
  }, [leaderEffectPrompt])

  // 检索确认：选中的加入手牌，其余放回底部
  const confirmSearch = useCallback(() => {
    const selectedIds = Array.from(selectedSearchIds)
    const bottomIds = viewedCards
      .filter(c => !selectedSearchIds.has(c.instanceId))
      .map(c => c.instanceId)
    socketService.resolveSearch(selectedIds, bottomIds)
    setShowSearchModal(false)
    setViewedCards([])
    setSelectedSearchIds(new Set())
    setHoveredCard(null)
    setPinnedPreviewId(null)
    setPreviewOrigin(null)
  }, [selectedSearchIds, viewedCards])

  const cancelSearch = useCallback(() => {
    setShowSearchModal(false)
    setViewedCards([])
    setSelectedSearchIds(new Set())
    setHoveredCard(null)
    setPinnedPreviewId(null)
    setPreviewOrigin(null)
  }, [])

  // Phase info
  const phaseHint = getPhaseHint(
    state.gamePhase, state.battleStep, isMyTurn,
    !!isDefending, state.turnNumber, state.pendingAttack,
  )

  const getHandGap = useCallback((count: number, cardW: number) => {
    if (count <= 1) return 0
    const baseGap = -14
    if (count <= 13) return baseGap
    const available = Math.max(240, sizes.vw - 40)
    const raw = Math.floor((available - cardW * count) / (count - 1))
    const gap = Math.min(baseGap, raw)
    return Math.max(gap, -42)
  }, [sizes.vw])

  const isCounterMarked = useCallback((card?: Card) => {
    if (!card?.effect) return false
    const effectText = card.effect.toLowerCase()
    return effectText.includes('counter') || effectText.includes('反击')
  }, [])

  const isBlocker = useCallback((card?: Card) => {
    if (!card?.effect) return false
    const effectText = card.effect.toLowerCase()
    return effectText.includes('blocker') || effectText.includes('阻挡')
  }, [])

  // ============ Render Board Side ============
  const renderBoard = (isOpp: boolean) => {
    const p = isOpp ? state.opponent : state.player
    if (!p) return null
    const cardW = sizes.charCardW
    const midW = sizes.midCardW
    const lifeW = sizes.lifeCardW
    const donW = sizes.donCardW

    // Character row
    const charRow = (
      <div className="char-row">
        {p.characters.length === 0 && <span className="char-row-label">CHARACTER AREA</span>}
        {p.characters.map(slot => (
          <div
            key={slot.card.instanceId}
            className={`char-slot ${slot.canAttackThisTurn === false ? 'newly-played' : ''}`}
          >
            <CardComponent
              card={slot.card} slot={slot} width={cardW}
              showPower
              selectable={!isOpp && (canAttackNow && slot.state === 'ACTIVE' || donSelectMode)}
              selected={!isOpp && selectedCard === slot.card.instanceId}
              targetable={(isOpp && targeting && slot.state === 'RESTED') || (!isOpp && donSelectMode)}
              onClick={(e) => {
                if (Date.now() - counterAdjustOpenedAt < 200) return
                if (showCounterPowerModal) {
                  setShowCounterPowerModal(false)
                  setCounterPowerDraft(0)
                  setKoSelectMode(false)
                  setHoveredCard(null)
                  setPinnedPreviewId(null)
                  setPreviewOrigin(null)
                  return
                }
                if (isOpp && targeting && slot.state === 'RESTED') {
                  handleSelectTarget(slot.card.instanceId)
                } else if (!isOpp) {
                  // DON选择模式：贴DON到角色
                  if (donSelectMode && selectedDonCount > 0) {
                    handleAttachDonToTarget(slot.card.instanceId)
                  } else if (e && !donSelectMode && !targeting) {
                    handleClickPreview(slot.card, e, 'board')
                    // 显示轮盘菜单
                    const rect = (e.target as HTMLElement).getBoundingClientRect()
                    setRadialMenu({
                      type: 'character',
                      targetId: slot.card.instanceId,
                      targetCard: slot.card,
                      position: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
                      attachedDon: slot.attachedDon,
                      isNew: newlyPlayedCards.has(slot.card.instanceId)
                    })
                  }
                }
              }}
              onHover={(c, e) => handleHover(c, e)}
              onDonClick={!isOpp && slot.attachedDon && slot.attachedDon > 0 ? () => {
                socketService.detachDon(slot.card.instanceId, 1)
              } : undefined}
            />
          </div>
        ))}
      </div>
    )

    // Mid row: Life | Leader | Stage | Deck
    const midRow = (
      <div className="mid-row">
        {/* Life */}
        <div
          className="zone-box life-zone"
          onClick={() => {
            if (isOpp || targeting || discardSelectMode || koSelectMode || donSelectMode) return
            setZoneActionMenu('life')
          }}
          style={{ cursor: isOpp ? 'default' : 'pointer' }}
        >
          <span className="zone-label">LIFE {p.lifeCount}</span>
          <div className="life-stack">
            {Array.from({ length: Math.min(p.lifeCount, 8) }).map((_, i) => (
              <div key={i} className="life-card-wrap">
                <CardBack width={lifeW} />
              </div>
            ))}
          </div>
        </div>

        {/* Leader */}
        <div className="zone-box leader-zone">
          <span className="zone-label gold">LEADER</span>
          {p.leader && (
            <CardComponent
              card={p.leader.card} slot={p.leader} width={midW}
              showPower
              selectable={!isOpp && (canAttackNow && p.leader.state === 'ACTIVE' || donSelectMode)}
              selected={!isOpp && selectedCard === 'leader'}
              targetable={(isOpp && targeting) || (!isOpp && donSelectMode)}
              onClick={(e) => {
                if (isOpp && targeting) {
                  handleSelectTarget('leader')
                } else if (!isOpp) {
                  // DON选择模式：贴DON到领袖
                  if (donSelectMode && selectedDonCount > 0) {
                    handleAttachDonToTarget('leader')
                  } else if (e && !donSelectMode && !targeting) {
                    handleClickPreview(p.leader.card, e, 'board')
                    // 显示轮盘菜单
                    const rect = (e.target as HTMLElement).getBoundingClientRect()
                    setRadialMenu({
                      type: 'leader',
                      targetId: 'leader',
                      targetCard: p.leader.card,
                      position: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
                      attachedDon: p.leader.attachedDon,
                      isNew: false
                    })
                  }
                }
              }}
              onHover={(c, e) => handleHover(c, e)}
              onDonClick={!isOpp && p.leader.attachedDon && p.leader.attachedDon > 0 ? () => {
                socketService.detachDon('leader', 1)
              } : undefined}
            />
          )}
        </div>

        {/* Stage */}
        <div className="zone-box stage-zone">
          <span className="zone-label">STAGE</span>
          {p.stage ? (
            <CardComponent
              card={p.stage.card} width={midW}
              onClick={(e) => {
                if (donSelectMode || targeting) return
                handleClickPreview(p.stage!.card, e as React.MouseEvent, 'board')
              }}
              onHover={(c, e) => handleHover(c, e)}
            />
          ) : (
            <div className="empty-slot" style={{ width: midW, height: Math.round(midW * 1.4) }} />
          )}
        </div>

        {/* Deck */}
        <div
          className="zone-box deck-zone"
          onClick={() => {
            if (isOpp || targeting || discardSelectMode || koSelectMode || donSelectMode) return
            setZoneActionMenu('deck')
          }}
          style={{ cursor: isOpp ? 'default' : 'pointer' }}
        >
          <span className="zone-label">DECK</span>
          <CardBack width={midW} />
          <span className="deck-count">{p.deckCount}</span>
        </div>
      </div>
    )

    // Cost row: DON Deck | Cost Area | Trash
    const costRow = (
      <div className="cost-row">
        {/* DON!! Deck - 使用卡背 */}
        <div className="don-deck-zone">
          {p.donDeckCount > 0 ? (
            <DonCard width={donW} faceDown />
          ) : (
            <div className="empty-slot" style={{ width: donW, height: Math.round(donW * 1.4) }} />
          )}
          <span className="don-deck-count">{p.donDeckCount}</span>
        </div>

        {/* Cost Area - 使用卡面 */}
        <div className={`cost-area ${!isOpp && donSelectMode ? 'don-selecting' : ''}`}
          onClick={(e) => {
            if (isOpp) return
            // 点击空白区域取消 DON 选择模式
            if (donSelectMode && e.target === e.currentTarget) {
              setDonSelectMode(false)
              setSelectedDonCount(0)
              setSelectedDonFromRested(0)
            }
          }}>
          {(p.donActive === 0 && p.donRested === 0) && <span className="cost-area-label">COST AREA</span>}
          {Array.from({ length: Math.min(p.donActive, 10) }).map((_, i) => {
            const isSelected = !isOpp && donSelectMode && i < (selectedDonCount - selectedDonFromRested)
            return (
              <DonCard key={`a${i}`} width={donW} active
                selectable={!isOpp && (isMyTurn && state.gamePhase === 'main')}
                selected={isSelected}
                onClick={!isOpp ? (e) => {
                  e?.stopPropagation()
                  handleDonClick('active', i)
                } : undefined}
                onTouchStart={!isOpp ? () => handleDonTouchStart('active', i) : undefined}
                onTouchEnd={!isOpp ? handleDonTouchEnd : undefined}
              />
            )
          })}
          {Array.from({ length: Math.min(p.donRested, 10) }).map((_, i) => {
            const isSelected = !isOpp && donSelectMode && i < selectedDonFromRested
            return (
              <DonCard key={`r${i}`} width={donW} active={false}
                selectable={!isOpp && (isMyTurn && state.gamePhase === 'main')}
                selected={isSelected}
                onClick={!isOpp ? (e) => {
                  e?.stopPropagation()
                  handleDonClick('rested', i)
                } : undefined}
                onTouchStart={!isOpp ? () => handleDonTouchStart('rested', i) : undefined}
                onTouchEnd={!isOpp ? handleDonTouchEnd : undefined}
              />
            )
          })}
        </div>

        {/* Trash */}
        <div
          className="trash-zone"
          onClick={() => {
            if (isOpp) {
              setShowTrashViewer('opp')
              return
            }
            if (targeting || discardSelectMode || koSelectMode || donSelectMode) return
            setZoneActionMenu('trash')
          }}
          style={{ cursor: isOpp ? 'pointer' : 'pointer' }}
        >
          <span className="zone-label">TRASH</span>
          <span className="trash-count">{p.trash?.length || 0}</span>
        </div>
      </div>
    )

    return { charRow, midRow, costRow }
  }

  const oppBoard = renderBoard(true)
  const plrBoard = renderBoard(false)

  const canPlay = (card: Card) => {
    if (!isMyTurn || state.gamePhase !== 'main') return false
    const donAvail = state.player?.donActive || 0
    return (card.cost ?? 99) <= donAvail
  }

  // ============ Preview position ============
  const previewStyle = useMemo(() => {
    if (!hoveredCard) return { display: 'none' as const }
    // 预览框显示卡牌大图+效果，宽度320px，高度自适应
    const pw = 320
    const cardH = Math.round(200 * 1.4)
    const effectH = (hoveredCard.effect || hoveredCard.trigger) ? 120 : 0
    const ph = cardH + effectH + 20

    if (pinnedPreviewId) {
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    }

    let x = hoverPos.x + 20
    let y = hoverPos.y - ph / 2
    if (previewOrigin === 'hand') y -= 80
    if (x + pw + 20 > sizes.vw) x = hoverPos.x - pw - 20
    if (y < 10) y = 10
    if (y + ph > sizes.vh - 10) y = sizes.vh - ph - 10
    return { left: x, top: y }
  }, [hoveredCard, hoverPos, sizes, previewOrigin, pinnedPreviewId])

  const isHandPreview = useMemo(() => {
    if (!hoveredCard) return false
    return (state.player?.hand || []).some(c => c.instanceId === hoveredCard.instanceId)
  }, [hoveredCard, state.player?.hand])

  const previewCard = useMemo(() => {
    if (showPowerAdjustModal) return null
    return hoveredCard
  }, [hoveredCard, showPowerAdjustModal])

  const isOppCharacterPreview = useMemo(() => {
    if (!hoveredCard) return false
    return (state.opponent?.characters || []).some(s => s.card.instanceId === hoveredCard.instanceId)
  }, [hoveredCard, state.opponent?.characters])

  const isMyCharacterPreview = useMemo(() => {
    if (!hoveredCard) return false
    return (state.player?.characters || []).some(s => s.card.instanceId === hoveredCard.instanceId)
  }, [hoveredCard, state.player?.characters])

  const isMyLeaderPreview = useMemo(() => {
    if (!hoveredCard || !state.player?.leader?.card) return false
    return state.player.leader.card.instanceId === hoveredCard.instanceId
  }, [hoveredCard, state.player?.leader])

  const myPreviewSlot = useMemo(() => {
    if (!hoveredCard) return null
    return (state.player?.characters || []).find(s => s.card.instanceId === hoveredCard.instanceId) || null
  }, [hoveredCard, state.player?.characters])

  const canAttackPreview = useMemo(() => {
    if (!hoveredCard) return false
    if (!canAttackNow || state.turnNumber <= 2) return false
    if (isMyLeaderPreview) return state.player?.leader?.state === 'ACTIVE'
    if (myPreviewSlot) return myPreviewSlot.state === 'ACTIVE'
    return false
  }, [hoveredCard, canAttackNow, state.turnNumber, isMyLeaderPreview, myPreviewSlot, state.player?.leader])

  const handlePreviewAttack = useCallback(() => {
    if (!canAttackPreview) return
    if (isMyLeaderPreview) {
      handleSelectAttacker('leader', true)
      return
    }
    if (myPreviewSlot) {
      handleSelectAttacker(myPreviewSlot.card.instanceId, false)
    }
  }, [canAttackPreview, isMyLeaderPreview, myPreviewSlot, handleSelectAttacker])

  const isHandPlayable = useMemo(() => {
    if (!hoveredCard || !isHandPreview) return false
    return canPlay(hoveredCard)
  }, [hoveredCard, isHandPreview, state.player, state.gamePhase, isMyTurn])

  const selectedCounterTotal = useMemo(() => {
    if (selectedCounterIds.size === 0 && manualCounterPower <= 0) return 0
    const hand = state.player?.hand || []
    const base = hand.reduce((sum, card) => {
      if (!selectedCounterIds.has(card.instanceId)) return sum
      return sum + (card.counter || 0)
    }, 0)
    return base + Math.max(0, manualCounterPower || 0)
  }, [selectedCounterIds, state.player?.hand, manualCounterPower])

  const counterPreviewPower = useMemo(() => {
    const base = state.pendingAttack?.targetPower ?? 0
    return base + selectedCounterTotal
  }, [state.pendingAttack?.targetPower, selectedCounterTotal])

  // ============ RENDER ============
  return (
    <div
      className="game-root"
      onMouseMove={handleMouseMove}
      onClick={(e) => {
        if (showPowerAdjustModal || showCounterPowerModal || showSearchModal || showTrashViewer || leaderEffectPrompt || zoneActionMenu) {
          return
        }
        if (Date.now() < suppressRootClickUntilRef.current || Date.now() - powerAdjustOpenedAt < 400) {
          return
        }
        const target = e.target as HTMLElement
        if (target.closest('.card-wrap') || target.closest('.radial-menu') || target.closest('button')) {
          return
        }
        if (pinnedPreviewId) {
          setPinnedPreviewId(null)
          setHoveredCard(null)
        }
      }}
    >
      <div className="game-scaler" style={{
        width: sizes.designW, height: sizes.designH,
        transform: `scale(${sizes.scale})`,
        transformOrigin: '50% 50%',
        position: 'absolute',
        left: '50%', top: '50%',
        marginLeft: -sizes.designW / 2, marginTop: -sizes.designH / 2,
        backgroundColor: '#0c0c10',
        boxShadow: '0 0 50px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column'
      }}>

      {/* ═══ PHASE BAR ═══ */}
      <div className="phase-bar">
        <div className="turn-badge">
          {isMyTurn ? '你的回合' : '对手回合'} · T{state.turnNumber}
        </div>
        <div className="phase-steps">
          {PHASE_LABELS.map(p => {
            const pidx = PHASE_ORDER.indexOf(p.key)
            const activePhase = state.gamePhase === 'battle' ? 'main' : state.gamePhase
            const activeIdx = PHASE_ORDER.indexOf(activePhase)
            const cls = p.key === activePhase ? 'active' : (pidx < activeIdx ? 'done' : '')
            return (
              <div key={p.key} className={`phase-step ${cls}`} title={p.label}>
                {p.num}
              </div>
            )
          })}
        </div>
        <span className="phase-hint">{phaseHint}</span>
      </div>

      {/* ═══ OPPONENT HAND ═══ */}
      <div
        className="opp-hand-strip"
        style={{ position: 'relative', ['--hand-gap' as any]: `${getHandGap(state.opponent?.handCount || 0, 32)}px` }}
      >
        {Array.from({ length: state.opponent?.handCount || 0 }).map((_, i) => (
          <div key={i} className="hand-card">
            <CardBack width={32} />
          </div>
        ))}
        <div className="opp-info-bar">
          <span className="pname">{state.opponent?.name || '对手'}</span>
          <span className="plife">❤{state.opponent?.lifeCount ?? '?'}</span>
          <span className="phand">手牌 {state.opponent?.handCount ?? 0}</span>
          <span className="pdeck">牌组{state.opponent?.deckCount ?? '?'}</span>
        </div>
      </div>

      {/* ═══ BOARD AREA ═══ */}
      <div className="board-area">
        <div className="opp-board">
          {oppBoard?.charRow}
          {oppBoard?.midRow}
          {oppBoard?.costRow}
        </div>

        <div className="board-divider" />

        <div className="plr-board">
          {plrBoard?.charRow}
          {plrBoard?.midRow}
          {plrBoard?.costRow}
        </div>
      </div>

      {/* ═══ PLAYER HAND AREA ═══ */}
      <div className="plr-hand-area">
        {/* Action bar */}
        <div className="action-bar">
          {isMyTurn && (state.gamePhase === 'main' || state.gamePhase === 'battle') && (
            <>
              <button className="btn btn-primary" onClick={() => socketService.endTurn()}>
                结束回合
              </button>
            </>
          )}
          {targeting && (
            <button className="btn btn-danger" onClick={cancelAction}>✕ 取消</button>
          )}
          {targeting && <span className="action-hint attack">← 选择攻击目标</span>}
          {discardSelectMode && (
            <button className="btn btn-danger" onClick={cancelAction}>✕ 取消</button>
          )}
          {discardSelectMode && <span className="action-hint">← 点击手牌弃1张</span>}
          {koSelectMode && (
            <button className="btn btn-danger" onClick={cancelAction}>✕ 取消</button>
          )}
          {koSelectMode && <span className="action-hint">← 点击对方角色KO</span>}
        </div>

        {/* Player info */}
        <div className="plr-info-bar">
          <span className="pname">{state.player?.name || '你'}</span>
          <div className="stats">
            <span className="plife">❤{state.player?.lifeCount ?? '?'}</span>
            <span className="phand">手牌 {state.player?.hand?.length ?? 0}</span>
            <span className="pdeck">牌组 {state.player?.deckCount ?? '?'}</span>
            <span className="pdon">DON!! {state.player?.donActive ?? 0}/{(state.player?.donActive ?? 0) + (state.player?.donRested ?? 0)}</span>
          </div>
        </div>

        {/* Hand cards */}
        <div
          className="plr-hand-cards"
          style={{ ['--hand-gap' as any]: `${getHandGap(state.player?.hand?.length || 0, sizes.handCardW)}px` }}
        >
          {(state.player?.hand || []).map(card => {
            const playable = canPlay(card)
            return (
              <div key={card.instanceId}
                className={`hand-card ${playable ? 'playable' : ''}`}
                onClick={(e) => {
                  if (discardSelectMode) {
                    socketService.trashFromHand(card.instanceId)
                    setDiscardSelectMode(false)
                    setHoveredCard(null)
                    setPinnedPreviewId(null)
                    setPreviewOrigin(null)
                    return
                  }
                  handleClickPreview(card, e, 'hand')
                }}
                onTouchEnd={(e) => {
                  const now = Date.now()
                  const last = lastTapRef.current
                  if (discardSelectMode) {
                    e.preventDefault()
                    e.stopPropagation()
                    socketService.trashFromHand(card.instanceId)
                    setDiscardSelectMode(false)
                    setHoveredCard(null)
                    setPinnedPreviewId(null)
                    setPreviewOrigin(null)
                    return
                  }
                  if (last.id === card.instanceId && now - last.time < 320) {
                    e.preventDefault()
                    e.stopPropagation()
                    lastTapRef.current = { id: null, time: 0 }
                    if (playable) handlePlayCard(card)
                    return
                  }
                  lastTapRef.current = { id: card.instanceId, time: now }
                  e.preventDefault()
                  e.stopPropagation()
                  handleClickPreview(card, undefined, 'hand')
                }}
                onDoubleClick={() => {
                  // 双击出牌
                  if (playable) handlePlayCard(card)
                }}
              >
                <CardComponent card={card} width={sizes.handCardW}
                  selectable={playable}
                  onHover={(c, e) => handleHover(c, e)}
                />
              </div>
            )
          })}
        </div>
      </div>
      </div>

      {zoneActionMenu && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setZoneActionMenu(null)
          }}
        >
          <div className="zone-action-modal" onClick={(e) => e.stopPropagation()}>
            <div className="zone-action-title">
              {zoneActionMenu === 'deck' && '牌组操作'}
              {zoneActionMenu === 'life' && '生命操作'}
              {zoneActionMenu === 'trash' && '墓地操作'}
            </div>
            <div className="zone-action-grid">
              {zoneActionMenu === 'deck' && (
                <>
                  <button
                    className="zone-action-btn"
                    onClick={() => {
                      socketService.drawCards(1)
                      setZoneActionMenu(null)
                    }}
                  >
                    抽1张
                  </button>
                  <button
                    className="zone-action-btn"
                    onClick={() => {
                      socketService.viewTopDeck(5)
                      setZoneActionMenu(null)
                    }}
                  >
                    查看牌顶5张
                  </button>
                </>
              )}
              {zoneActionMenu === 'life' && (
                <button
                  className="zone-action-btn"
                  onClick={() => {
                    socketService.lifeToHand(0)
                    setZoneActionMenu(null)
                  }}
                >
                  生命→手牌
                </button>
              )}
              {zoneActionMenu === 'trash' && (
                <button
                  className="zone-action-btn"
                  onClick={() => {
                    setShowTrashViewer('mine')
                    setZoneActionMenu(null)
                  }}
                >
                  查看墓地
                </button>
              )}
            </div>
            <button className="zone-action-close" onClick={() => setZoneActionMenu(null)}>关闭</button>
          </div>
        </div>
      )}

      {/* ═══ HOVER PREVIEW ═══ */}
      {previewCard && (
        <div className="hover-preview" style={previewStyle}>
          <div className="hp-card-image">
            <img
              src={previewCard.imageUrl || `/cards/${previewCard.cardNumber}.png`}
              alt={previewCard.nameCn || previewCard.name}
              onError={(e) => { (e.target as HTMLImageElement).src = `/cards/${previewCard.cardNumber}.jpg` }}
            />
          </div>
          {(previewCard.effect || previewCard.trigger) && (
            <div className="hp-effect-area">
              {previewCard.effect && (
                <div className="hp-effect-box">
                  <div className="hp-effect-text">{previewCard.effect}</div>
                </div>
              )}
              {previewCard.trigger && (
                <div className="hp-trigger-box">
                  <span className="hp-trigger-label">【触发】</span>
                  <span className="hp-trigger-text">{previewCard.trigger}</span>
                </div>
              )}
            </div>
          )}
          {((radialMenu && (radialMenu.type === 'leader' || radialMenu.type === 'character') &&
            radialMenu.targetCard?.instanceId === previewCard.instanceId) ||
            isMyCharacterPreview || isMyLeaderPreview) && (
            <div className="hp-actions compact">
              {radialMenu && (radialMenu.type === 'leader' || radialMenu.type === 'character') &&
                radialMenu.targetCard?.instanceId === previewCard.instanceId && (
                getRadialMenuOptions()
                  .filter((opt) => opt.id !== 'cancel' && !(opt.id === 'attack' && (isMyCharacterPreview || isMyLeaderPreview)))
                  .map((opt) => (
                    <button
                      key={opt.id}
                      className={`hp-action-btn ${opt.disabled ? 'disabled' : ''}`}
                      style={{ borderColor: opt.color || '#444', color: opt.color || '#ddd' }}
                      onClick={() => !opt.disabled && handleRadialMenuAction(opt.id)}
                      disabled={opt.disabled}
                    >
                      {opt.icon && <span className="btn-icon">{opt.icon}</span>}
                      <span className="btn-label">{opt.label}</span>
                    </button>
                  ))
              )}
              {(isMyCharacterPreview || isMyLeaderPreview) && (
                <>
                  <button
                    className={`hp-action-btn ${canAttackPreview ? '' : 'disabled'}`}
                    style={{ borderColor: '#EF5350', color: '#EF5350' }}
                    onClick={handlePreviewAttack}
                    onTouchEnd={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handlePreviewAttack()
                    }}
                    disabled={!canAttackPreview}
                  >攻击</button>
                  <button
                    className="hp-action-btn power-adjust-toggle"
                    onClick={openPowerAdjustModal}
                    onTouchEnd={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openPowerAdjustModal(e)
                    }}
                  >自定义</button>
                </>
              )}
            </div>
          )}
          {isHandPreview && (
            <div className="hp-actions">
              <button
                className={`hp-action-btn ${isHandPlayable ? '' : 'disabled'}`}
                style={{ borderColor: '#C9A962', color: '#C9A962' }}
                onClick={() => isHandPlayable && handlePlayCard(previewCard)}
                onTouchEnd={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (isHandPlayable) handlePlayCard(previewCard)
                }}
                disabled={!isHandPlayable}
              >
                <span className="btn-label">出牌</span>
              </button>
              <button
                className="hp-action-btn"
                style={{ borderColor: '#EF5350', color: '#EF5350' }}
                onClick={() => {
                  socketService.trashFromHand(previewCard.instanceId)
                  setHoveredCard(null)
                  setPinnedPreviewId(null)
                  setPreviewOrigin(null)
                }}
                onTouchEnd={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  socketService.trashFromHand(previewCard.instanceId)
                  setHoveredCard(null)
                  setPinnedPreviewId(null)
                  setPreviewOrigin(null)
                }}
              >
                <span className="btn-label">弃牌</span>
              </button>
            </div>
          )}
          {isOppCharacterPreview && (
            <div className="hp-actions">
              <button
                className="hp-action-btn"
                style={{ borderColor: '#EF5350', color: '#EF5350' }}
                onClick={() => {
                  socketService.koTarget(state.opponent?.id || '', previewCard.instanceId)
                  setHoveredCard(null)
                  setPinnedPreviewId(null)
                  setPreviewOrigin(null)
                }}
                onTouchEnd={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  socketService.koTarget(state.opponent?.id || '', previewCard.instanceId)
                  setHoveredCard(null)
                  setPinnedPreviewId(null)
                  setPreviewOrigin(null)
                }}
              >
                <span className="btn-icon">💥</span>
                <span className="btn-label">KO</span>
              </button>
            </div>
          )}
        </div>
      )}

      {showPowerAdjustModal && hoveredCard && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return
            if (Date.now() - powerAdjustOpenedAt < 400) return
            setShowPowerAdjustModal(false)
            setPowerAdjustAmount(0)
            setHoveredCard(null)
          }}
          onTouchEnd={(e) => {
            if (e.target !== e.currentTarget) return
            if (Date.now() - powerAdjustOpenedAt < 400) return
            e.preventDefault()
            setShowPowerAdjustModal(false)
            setPowerAdjustAmount(0)
            setHoveredCard(null)
          }}
        >
          <div className="power-adjust-modal" onClick={(e) => e.stopPropagation()}>
            <div className="power-adjust-title">自定义力量</div>
            <div className="power-adjust-target">{hoveredCard.nameCn || hoveredCard.name}</div>
            <div className="power-adjust-display">
              <span className="power-adjust-sign">
                {powerAdjustSign === 1 ? '+' : '-'}
              </span>
              <span className="power-adjust-value">{powerAdjustAmount}</span>
            </div>
            <div className="power-adjust-sign-toggle">
              <button
                className={`btn btn-mini ${powerAdjustSign === 1 ? 'active' : ''}`}
                onClick={() => setPowerAdjustSign(1)}
              >+</button>
              <button
                className={`btn btn-mini ${powerAdjustSign === -1 ? 'active' : ''}`}
                onClick={() => setPowerAdjustSign(-1)}
              >-</button>
            </div>
            <div className="power-adjust-pad">
              <button className="btn" onClick={() => setPowerAdjustAmount((prev) => prev + 1000)}>1000</button>
              <button className="btn" onClick={() => setPowerAdjustAmount((prev) => prev + 2000)}>2000</button>
              <button className="btn" onClick={() => setPowerAdjustAmount(0)}>清零</button>
              <button className="btn" onClick={() => setPowerAdjustAmount((prev) => Math.max(0, prev - 1000))}>回退</button>
            </div>
            <div className="power-adjust-actions">
              <button
                className="btn"
                onClick={() => {
                  if (Date.now() - powerAdjustOpenedAt < 200) return
                  setShowPowerAdjustModal(false)
                  setPowerAdjustAmount(0)
                  setHoveredCard(null)
                }}
              >取消</button>
              <button
                className="btn primary"
                disabled={powerAdjustAmount === 0}
                onClick={() => {
                  if (powerAdjustAmount === 0) return
                  socketService.powerBoost(hoveredCard.instanceId, powerAdjustSign * powerAdjustAmount)
                  setShowPowerAdjustModal(false)
                  setPowerAdjustAmount(0)
                  setHoveredCard(null)
                }}
              >确认</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DON SELECT MODE BAR ═══ */}
      {donSelectMode && (
        <div className="don-select-bar">
          <div className="don-select-info">
            <span className="don-select-count">已选择 {selectedDonCount} 张 DON!!</span>
            <span className="don-select-hint">点击领袖或角色卡贴DON，点击空白取消</span>
          </div>
          <button className="btn btn-secondary" onClick={cancelAction}>取消</button>
        </div>
      )}

      {/* ═══ SEARCH MODAL ═══ */}
      {showSearchModal && (
        <div className="modal-overlay" onClick={cancelSearch}>
          <div className="search-modal" onClick={e => {
            if (e.target === e.currentTarget) {
              setHoveredCard(null)
              setPinnedPreviewId(null)
              setPreviewOrigin(null)
            }
            e.stopPropagation()
          }}>
            <h2>🔍 牌顶检索</h2>
            <p className="search-desc">可不选或选择1张加入手牌，其余放回牌组底部</p>
            <div className="search-cards">
              {viewedCards.map(card => (
                <div key={card.instanceId}
                  className={`search-card ${selectedSearchIds.has(card.instanceId) ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedSearchIds(prev => {
                      if (prev.has(card.instanceId)) return new Set()
                      return new Set([card.instanceId])
                    })
                    handleClickPreview(card, undefined, 'other')
                  }}>
                  <CardComponent card={card} width={80} showPower onHover={(c, e) => handleHover(c, e)} />
                  <div className="search-card-name">{card.nameCn || card.name}</div>
                </div>
              ))}
            </div>
            <div className="search-actions">
              <button className="btn btn-primary" onClick={confirmSearch}>
                确认 ({selectedSearchIds.size === 0 ? '0' : '1'}张→手牌)
              </button>
              <button className="btn btn-secondary" onClick={cancelSearch}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TRASH VIEWER ═══ */}
      {showTrashViewer && (
        <div className="modal-overlay" onClick={() => setShowTrashViewer(null)}>
          <div className="trash-modal" onClick={e => e.stopPropagation()}>
            <h2>🗑️ {showTrashViewer === 'mine' ? '我的墓地' : '对手墓地'}</h2>
            <div className="search-cards">
              {((showTrashViewer === 'mine' ? state.player?.trash : state.opponent?.trash) || []).map(card => (
                <div key={card.instanceId}
                  className={`search-card ${selectedTrashCardId === card.instanceId ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedTrashCardId(card.instanceId)
                    handleClickPreview(card, undefined, 'other')
                  }}>
                  <CardComponent card={card} width={80} showPower onHover={(c, e) => handleHover(c, e)} />
                  <div className="search-card-name">{card.nameCn || card.name}</div>
                </div>
              ))}
              {((showTrashViewer === 'mine' ? state.player?.trash : state.opponent?.trash) || []).length === 0 && (
                <div style={{ color: '#666', padding: 20 }}>墓地为空</div>
              )}
            </div>
            <div className="search-actions">
              {showTrashViewer === 'mine' && selectedTrashCardId && (
                <div className="trash-footer-actions">
                  <button
                    className="btn btn-primary"
                    disabled={(state.player?.characters.length || 0) >= 5}
                    onClick={() => {
                      socketService.playFromTrash(selectedTrashCardId, 'active')
                      setShowTrashViewer(null)
                      setSelectedTrashCardId(null)
                    }}
                  >登场(竖置)</button>
                  <button
                    className="btn btn-primary"
                    disabled={(state.player?.characters.length || 0) >= 5}
                    onClick={() => {
                      socketService.playFromTrash(selectedTrashCardId, 'rested')
                      setShowTrashViewer(null)
                      setSelectedTrashCardId(null)
                    }}
                  >登场(横置)</button>
                </div>
              )}
              <button className="btn btn-secondary" onClick={() => setShowTrashViewer(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ LEADER EFFECT PROMPT (白胡子等) ═══ */}
      {leaderEffectPrompt && (
        <div className="modal-overlay">
          <div className="defender-overlay">
            <h2>⚡ 领袖效果触发</h2>
            <p>{leaderEffectPrompt.message}</p>
            <div className="def-actions">
              <button className="btn primary" onClick={() => handleLeaderEffectConfirm(true)}>
                确认执行
              </button>
              <button className="btn" onClick={() => handleLeaderEffectConfirm(false)}>
                跳过
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DEFENDER OVERLAY (Block/Counter) ═══ */}
      {isDefending && state.battleStep === 'block' && (
        <div className="defender-overlay">
          <h2>🛡 格挡阶段</h2>
          <p>
            对手攻击! 力量 {state.pendingAttack?.attackerPower} →
            {state.pendingAttack?.isTargetLeader ? ' 你的领袖' : ' 你的角色'}
            (力量 {state.pendingAttack?.targetPower})
          </p>
          <p>是否使用【阻挡者】角色格挡?</p>
          <div className="def-actions">
            <button className="btn" onClick={() => socketService.skipBlocker()}>不格挡</button>
            {(state.player?.characters || [])
              .filter(s => s.state === 'ACTIVE' && isBlocker(s.card))
              .map(s => (
                <button key={s.card.instanceId} className="btn primary"
                  onClick={() => socketService.declareBlocker(s.card.instanceId)}>
                  {s.card.nameCn || s.card.name} 格挡
                </button>
              ))}
          </div>
        </div>
      )}

      {isDefending && state.battleStep === 'counter' && (
        <div className={`defender-overlay ${counterCollapsed ? 'counter-collapsed' : ''}`}>
          <div className="defender-header">
            <h2>⚡ 反击阶段</h2>
            <button className="btn btn-mini" onClick={() => setCounterCollapsed(prev => !prev)}>
              {counterCollapsed ? '展开' : '收起'}
            </button>
          </div>
          <p>
            攻击力量 {state.pendingAttack?.attackerPower} vs
            防御力量 {state.pendingAttack?.targetPower}
          </p>
          {!counterCollapsed && (
            <>
              <p>选择反击卡后点击确认</p>
              {selectedCounterTotal > 0 && (
                <p className="counter-preview">
                  本次反击 +{selectedCounterTotal} → 防御力量 {counterPreviewPower}
                  {counterPreviewPower >= (state.pendingAttack?.attackerPower ?? 0) ? ' (已足够)' : ''}
                </p>
              )}
              <div className="counter-power-input">
                <div className="counter-power-row">
                  <span className="counter-power-label">手动叠加力量</span>
                  <span className="counter-power-value">+{manualCounterPower}</span>
                </div>
                <div className="counter-power-actions">
                  <button
                    className="btn btn-mini"
                    onClick={() => {
                      setCounterPowerDraft(manualCounterPower)
                      setShowCounterPowerModal(true)
                      setCounterAdjustOpenedAt(Date.now())
                    }}
                  >自定义</button>
                  <button className="btn btn-mini" onClick={() => setManualCounterPower(0)}>清零</button>
                </div>
              </div>
              <div className="def-actions">
                <button className="btn" onClick={() => socketService.skipCounter()}>不反击</button>
                <button
                  className="btn primary"
                  disabled={selectedCounterIds.size === 0 && manualCounterPower === 0}
                  onClick={() => {
                    if (selectedCounterIds.size === 0 && manualCounterPower === 0) return
                    socketService.playCounter(Array.from(selectedCounterIds), manualCounterPower)
                    socketService.skipCounter()
                    setSelectedCounterIds(new Set())
                    setManualCounterPower(0)
                  }}
                >
                  确认反击{selectedCounterTotal > 0 ? ` (+${selectedCounterTotal})` : ''}
                </button>
                {selectedCounterIds.size > 0 && (
                  <button className="btn" onClick={() => setSelectedCounterIds(new Set())}>清空选择</button>
                )}
              </div>
              <div className="counter-card-list">
                {(state.player?.hand || [])
                  .filter(c => (c.counter && c.counter > 0) || isCounterMarked(c))
                  .map(c => {
                    const selected = selectedCounterIds.has(c.instanceId)
                    return (
                      <button
                        key={c.instanceId}
                        className={`counter-card-btn ${selected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedCounterIds(prev => {
                            const next = new Set(prev)
                            if (next.has(c.instanceId)) next.delete(c.instanceId)
                            else next.add(c.instanceId)
                            return next
                          })
                        }}
                      >
                        {c.nameCn || c.name} {c.counter ? `(+${c.counter})` : '(反击)'}
                      </button>
                    )
                  })}
              </div>
            </>
          )}
        </div>
      )}

      {showCounterPowerModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (Date.now() - counterAdjustOpenedAt < 200) return
            setShowCounterPowerModal(false)
            setCounterPowerDraft(0)
          }}
        >
          <div className="counter-adjust-modal" onClick={(e) => e.stopPropagation()}>
            <div className="counter-adjust-title">自定义反击力量</div>
            <div className="counter-adjust-display">+{counterPowerDraft}</div>
            <div className="counter-adjust-pad">
              <button className="btn" onClick={() => setCounterPowerDraft((prev) => prev + 1000)}>1000</button>
              <button className="btn" onClick={() => setCounterPowerDraft((prev) => prev + 2000)}>2000</button>
              <button className="btn" onClick={() => setCounterPowerDraft(0)}>清零</button>
              <button className="btn" onClick={() => setCounterPowerDraft((prev) => Math.max(0, prev - 1000))}>回退</button>
            </div>
            <div className="counter-adjust-actions">
              <button
                className="btn"
                onClick={() => {
                  setShowCounterPowerModal(false)
                  setCounterPowerDraft(0)
                }}
              >取消</button>
              <button
                className="btn primary"
                disabled={counterPowerDraft === 0}
                onClick={() => {
                  if (counterPowerDraft === 0) return
                  setManualCounterPower(counterPowerDraft)
                  setShowCounterPowerModal(false)
                  setCounterPowerDraft(0)
                }}
              >确认</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BATTLE INFO ═══ */}
      {state.pendingAttack && !isDefending && (
        <div className="battle-overlay">
          <div className="vs-text">
            ⚔ {state.pendingAttack.attackerPower} vs {state.pendingAttack.targetPower}
          </div>
        </div>
      )}

      {/* ═══ DICE ROLL OVERLAY ═══ */}
      {diceResult && (
        <div className="modal-overlay">
          <div className="dice-modal">
            <h2>🎲 投骰子决定先手</h2>
            <div className="dice-results">
              <div className={`dice-player ${diceResult.iWon ? 'winner' : ''}`}>
                <span className="dice-name">{diceResult.myName}</span>
                <span className="dice-value">{diceResult.myRoll}</span>
              </div>
              <span className="dice-vs">VS</span>
              <div className={`dice-player ${!diceResult.iWon ? 'winner' : ''}`}>
                <span className="dice-name">{diceResult.oppName}</span>
                <span className="dice-value">{diceResult.oppRoll}</span>
              </div>
            </div>
            <p className="dice-result-text">
              {diceResult.iWon ? '🏆 你先手！' : '对手先手'}
            </p>
          </div>
        </div>
      )}

      {/* ═══ GAME END ═══ */}
      {state.phase === 'ended' && (
        <div className="game-end-overlay">
          <h1>{state.winner === state.player?.id ? '🎉 胜利!' : '💀 败北'}</h1>
          <button className="btn" onClick={() => navigate('/lobby')}>返回大厅</button>
        </div>
      )}

      {/* ═══ RADIAL MENU ═══ */}
      {radialMenu && radialMenu.type !== 'leader' && radialMenu.type !== 'character' && (
        <RadialMenu
          options={getRadialMenuOptions()}
          position={radialMenu.position}
          onSelect={handleRadialMenuAction}
          onClose={() => setRadialMenu(null)}
        />
      )}

      {/* ═══ ERROR TOAST ═══ */}
      {state.error && (
        <div className="error-toast" onClick={() => dispatch({ type: 'SET_ERROR', error: null })}>
          {state.error}
        </div>
      )}

    </div>
  )
}
