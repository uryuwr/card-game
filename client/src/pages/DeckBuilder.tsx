import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiService, type Deck, type DeckCard } from '../services/api'
import { useCardPreview } from '../hooks/useCardPreview'
import CardPreview from '../components/CardPreview'
import './DeckBuilder.css'

// 卡牌详情接口（从API返回）
interface DeckCardDetail {
  card_number: string
  name: string
  name_cn: string
  card_type: string
  color: string
  cost: number | null
  power: number | null
  counter: number | null
  effect: string | null
  trigger: string | null
  trait: string | null
  image_url: string | null
  count: number
}

interface DeckDetail {
  id: string
  user_id: string
  name: string
  leader: DeckCardDetail | null
  cards: DeckCardDetail[]
  total_cards: number
}

// 卡牌库卡牌接口
interface LibraryCard {
  card_number: string
  name: string
  name_cn: string
  card_type: string
  color: string
  cost: number | null
  power: number | null
  counter: number | null
  effect: string | null
  trigger: string | null
  trait: string | null
  image_url: string | null
}

// 颜色选项
const COLORS = ['红', '绿', '蓝', '紫', '黑', '黄']
const COLOR_MAP: Record<string, string> = {
  '红': 'RED', '绿': 'GREEN', '蓝': 'BLUE',
  '紫': 'PURPLE', '黑': 'BLACK', '黄': 'YELLOW'
}

// 类型选项
const CARD_TYPES = ['角色', '事件', '舞台', '领袖']

// 费用选项
const COSTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export default function DeckBuilder() {
  const navigate = useNavigate()

  // 牌组列表状态
  const [decks, setDecks] = useState<Deck[]>([])
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null)
  const [deckDetail, setDeckDetail] = useState<DeckDetail | null>(null)
  const [loadingDeck, setLoadingDeck] = useState(false)

  // 卡牌库状态
  const [libraryCards, setLibraryCards] = useState<LibraryCard[]>([])
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [libraryPage, setLibraryPage] = useState(1)
  const [hasMoreCards, setHasMoreCards] = useState(true)

  // 筛选条件
  const [filterColor, setFilterColor] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')
  const [filterCost, setFilterCost] = useState<number | ''>('')
  const [filterSearch, setFilterSearch] = useState<string>('')

  // 卡牌预览（使用统一 Hook）
  const { previewCard, isTouchDevice, close: closePreview, getCardProps } = useCardPreview()

  // 牌组卡牌编辑状态（直接编辑，无需编辑模式）
  const [deckCards, setDeckCards] = useState<Map<string, number>>(new Map())
  const [deckLeader, setDeckLeader] = useState<LibraryCard | null>(null)
  const [localDeckName, setLocalDeckName] = useState('')
  const [saving, setSaving] = useState(false)

  // 牌组名称编辑状态
  const [isNameEditing, setIsNameEditing] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // 当牌组详情加载完成后，初始化本地状态
  useEffect(() => {
    if (deckDetail) {
      setLocalDeckName(deckDetail.name)
      setDeckLeader(deckDetail.leader)
      const cardsMap = new Map<string, number>()
      deckDetail.cards.forEach(card => {
        cardsMap.set(card.card_number, card.count)
      })
      setDeckCards(cardsMap)
    }
  }, [deckDetail])

  // 加载牌组列表
  useEffect(() => {
    loadDecks()
  }, [])

  const loadDecks = async () => {
    try {
      const data = await apiService.getDecks('system')
      setDecks(data)
    } catch (err) {
      console.error('加载牌组失败:', err)
    }
  }

  // 加载牌组详情
  const loadDeckDetail = async (deckId: string) => {
    setLoadingDeck(true)
    try {
      const data = await apiService.getDeck(deckId) as unknown as DeckDetail
      setDeckDetail(data)
    } catch (err) {
      console.error('加载牌组详情失败:', err)
    } finally {
      setLoadingDeck(false)
    }
  }

  // 选择牌组
  const handleSelectDeck = (deckId: string) => {
    setIsNameEditing(false)

    if (selectedDeckId === deckId) {
      setSelectedDeckId(null)
      setDeckDetail(null)
    } else {
      setSelectedDeckId(deckId)
      loadDeckDetail(deckId)
    }
  }

  // 自动保存牌组
  const saveDeck = useCallback(async (force = false, overrideCards?: Map<string, number>) => {
    if (!selectedDeckId || (!force && saving)) return

    // 验证
    if (!localDeckName.trim()) {
      console.warn('牌组名称不能为空')
      return
    }
    if (!deckLeader) {
      console.warn('请选择领袖卡')
      return
    }

    const currentCards = overrideCards ?? deckCards
    const cardsArray: DeckCard[] = []
    currentCards.forEach((count, cardNumber) => {
      if (count > 0) {
        cardsArray.push({ card_number: cardNumber, count })
      }
    })

    if (cardsArray.length === 0) {
      console.warn('卡组至少需要一张卡牌')
      return
    }

    if (!force) {
      setSaving(true)
    }

    try {
      await apiService.updateDeck(selectedDeckId, {
        name: localDeckName,
        leaderCard: deckLeader.card_number,
        cards: cardsArray,
      })
      // 保存成功后重新加载列表以同步
      await loadDecks()
    } catch (err) {
      console.error('保存失败:', err)
    } finally {
      if (!force) {
        setSaving(false)
      }
    }
  }, [selectedDeckId, localDeckName, deckLeader, deckCards, saving, loadDecks])

  // 增加到牌组
  const addCardToDeck = useCallback((cardNumber: string) => {
    const current = deckCards.get(cardNumber) || 0
    if (current < 4) {
      const newCards = new Map(deckCards)
      newCards.set(cardNumber, current + 1)
      setDeckCards(newCards)
      // 自动保存 - 直接传入新数据避免闭包陈旧状态
      saveDeck(true, newCards)
    }
  }, [deckCards, saveDeck])

  // 从牌组移除
  const removeCardFromDeck = useCallback((cardNumber: string) => {
    const current = deckCards.get(cardNumber) || 0
    const newCards = new Map(deckCards)
    if (current <= 1) {
      newCards.delete(cardNumber)
    } else {
      newCards.set(cardNumber, current - 1)
    }
    setDeckCards(newCards)
    // 自动保存 - 直接传入新数据避免闭包陈旧状态
    saveDeck(true, newCards)
  }, [deckCards, saveDeck])

  // 设置领袖卡
  const setDeckLeaderCard = useCallback((card: LibraryCard) => {
    setDeckLeader(card)
    // 自动保存
    // 延迟一下确保状态更新完成
    setTimeout(() => saveDeck(true), 0)
  }, [saveDeck])

  // 点击牌组名称开始编辑
  const handleNameClick = () => {
    setIsNameEditing(true)
    setTimeout(() => {
      nameInputRef.current?.select()
    }, 0)
  }

  // 牌组名称编辑完成
  const handleNameBlur = () => {
    setIsNameEditing(false)
    if (deckDetail && localDeckName !== deckDetail.name) {
      saveDeck(true)
    }
  }

  // 牌组名称按键处理
  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameBlur()
    } else if (e.key === 'Escape') {
      setLocalDeckName(deckDetail?.name || '')
      setIsNameEditing(false)
    }
  }

  // 加载卡牌库
  const loadLibraryCards = useCallback(async (page: number, append = false) => {
    setLoadingLibrary(true)
    try {
      const filters: Record<string, any> = {
        page: page,
        limit: 50,
      }
      if (filterColor) {
        filters.color = COLOR_MAP[filterColor] || filterColor
      }
      if (filterType) {
        filters.type = filterType
      }
      if (filterCost !== '') {
        filters.cost = filterCost
      }
      if (filterSearch) {
        filters.search = filterSearch
      }

      const data = await apiService.getCards(filters) as { cards: any[] }
      // API返回camelCase，需要转换为snake_case
      const newCards: LibraryCard[] = data.cards.map(c => ({
        card_number: c.cardNumber || c.card_number,
        name: c.name,
        name_cn: c.nameCn || c.name_cn,
        card_type: c.cardType || c.card_type,
        color: c.color,
        cost: c.cost,
        power: c.power,
        counter: c.counter,
        effect: c.effect,
        trigger: c.trigger,
        trait: c.trait,
        image_url: c.imageUrl || c.image_url,
      }))
      
      if (append) {
        setLibraryCards(prev => [...prev, ...newCards])
      } else {
        setLibraryCards(newCards)
      }
      setHasMoreCards(newCards.length === 50)
    } catch (err) {
      console.error('加载卡牌库失败:', err)
    } finally {
      setLoadingLibrary(false)
    }
  }, [filterColor, filterType, filterCost, filterSearch])

  // 初次加载和筛选变化时重新加载
  useEffect(() => {
    setLibraryPage(1)
    loadLibraryCards(1, false)
  }, [filterColor, filterType, filterCost, filterSearch, loadLibraryCards])

  // 加载更多
  const loadMore = () => {
    const nextPage = libraryPage + 1
    setLibraryPage(nextPage)
    loadLibraryCards(nextPage, true)
  }

  // 重置筛选
  const resetFilters = () => {
    setFilterColor('')
    setFilterType('')
    setFilterCost('')
    setFilterSearch('')
  }

  // 获取卡牌图片URL
  const getCardImageUrl = (card: { card_number: string; image_url?: string | null }) => {
    return card.image_url || `/cards/${card.card_number}.png`
  }

  // 颜色样式
  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      'RED': 'color-red', '红': 'color-red',
      'GREEN': 'color-green', '绿': 'color-green',
      'BLUE': 'color-blue', '蓝': 'color-blue',
      'PURPLE': 'color-purple', '紫': 'color-purple',
      'BLACK': 'color-black', '黑': 'color-black',
      'YELLOW': 'color-yellow', '黄': 'color-yellow',
    }
    return colorMap[color] || ''
  }

  return (
    <div className="deck-builder" onClick={() => {
      // PC端：点击空白处关闭预览
      if (previewCard && !isTouchDevice) {
        closePreview()
      }
    }}>
      <header className="deck-header">
        <button className="btn-back" onClick={() => navigate('/')}>
          ← 返回
        </button>
        <h1>卡组管理</h1>
        <button className="btn btn-primary btn-new-deck" disabled>
          + 新建卡组
        </button>
      </header>

      {/* 上方：牌组区域 */}
      <section className="deck-section deck-list-section">
        <h2>我的牌组</h2>
        {decks.length === 0 ? (
          <p className="empty-hint">暂无牌组</p>
        ) : (
          <div className="deck-list">
            {decks.map(deck => (
              <div
                key={deck.id}
                className={`deck-item ${selectedDeckId === deck.id ? 'selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSelectDeck(deck.id)
                }}
              >
                <div className="deck-item-name">{deck.name}</div>
                <div className="deck-item-count">{deck.total_cards} 张</div>
              </div>
            ))}
          </div>
        )}

        {/* 牌组详情预览 */}
        {selectedDeckId && (
          <div className="deck-preview">
            {loadingDeck ? (
              // 加载状态
              <div className="loading">加载中...</div>
            ) : deckDetail ? (
              // 牌组详情展示（可直接编辑）
              <>
                <div className="deck-preview-header">
                  {isNameEditing ? (
                    <input
                      ref={nameInputRef}
                      type="text"
                      className="deck-name-input"
                      value={localDeckName}
                      onChange={(e) => setLocalDeckName(e.target.value)}
                      onBlur={handleNameBlur}
                      onKeyDown={handleNameKeyDown}
                      autoFocus
                    />
                  ) : (
                    <h3 onClick={handleNameClick} className="deck-name-editable">
                      {localDeckName}
                    </h3>
                  )}
                  <span className="deck-total">共 {Array.from(deckCards.values()).reduce((a, b) => a + b, 0)} 张</span>
                </div>

                {/* 领袖卡 */}
                <div className="deck-leader">
                  <h4>领袖</h4>
                  {deckLeader ? (
                    <div className="leader-selected">
                      <div
                        className="card-thumb"
                        {...getCardProps(deckLeader)}
                        onClick={(e) => {
                          e.stopPropagation()
                          // 点击领袖卡跳转到卡牌库选择
                          setFilterType('领袖')
                        }}
                      >
                        <img
                          src={getCardImageUrl(deckLeader)}
                          alt={deckLeader.name_cn || deckLeader.name}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `/cards/${deckLeader!.card_number}.jpg`
                          }}
                        />
                        <span className={`card-color-dot ${getColorClass(deckLeader.color)}`} />
                      </div>
                      <div className="leader-info">
                        <div className="leader-name">{deckLeader.name_cn || deckLeader.name}</div>
                        <button className="btn-change-leader" onClick={(e) => {
                          e.stopPropagation()
                          setFilterType('领袖')
                        }}>
                          更换领袖
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn-select-leader" onClick={(e) => {
                      e.stopPropagation()
                      setFilterType('领袖')
                    }}>
                      选择领袖卡
                    </button>
                  )}
                </div>

                {/* 卡牌分组展示 - 使用本地编辑状态 */}
                <div className="deck-cards-groups">
                  {/* 按类型分组渲染 */}
                  {(() => {
                    const groups: Record<string, { card: DeckCardDetail | any; count: number }[]> = {
                      '角色': [],
                      '事件': [],
                      '舞台': [],
                    }
                    deckCards.forEach((count, cardNumber) => {
                      if (count <= 0) return
                      const card = libraryCards.find(c => c.card_number === cardNumber) ||
                        (deckDetail.cards.find(c => c.card_number === cardNumber) as any)
                      if (!card) return
                      const type = card.card_type || '其他'
                      if (!groups[type]) groups[type] = []
                      groups[type].push({ card, count })
                    })

                    return Object.entries(groups).map(([type, cards]) => (
                      cards.length > 0 && (
                        <div key={type} className="deck-group">
                          <h4>{type} ({cards.reduce((sum, c) => sum + c.count, 0)})</h4>
                          <div className="deck-cards-grid">
                            {cards.map(({ card, count }) => (
                              <div
                                key={card.card_number}
                                className="card-thumb-mini"
                                {...getCardProps(card)}
                              >
                                <img
                                  src={getCardImageUrl(card)}
                                  alt={card.name_cn || card.name}
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = `/cards/${card.card_number}.jpg`
                                  }}
                                />
                                <span className="card-count">×{count}</span>
                                <span className={`card-color-dot ${getColorClass(card.color)}`} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    ))
                  })()}
                </div>
              </>
            ) : (
              <div className="empty-hint">牌组详情加载失败</div>
            )}
          </div>
        )}
      </section>

      {/* 下方：卡牌库筛选区域 */}
      <section className="deck-section library-section">
        <h2>卡牌库</h2>
        
        {/* 筛选器 */}
        <div className="library-filters">
          <div className="filter-row">
            {/* 搜索框 */}
            <input
              type="text"
              placeholder="搜索卡名/编号..."
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              className="filter-search"
            />
            
            {/* 颜色筛选 */}
            <select 
              value={filterColor} 
              onChange={(e) => setFilterColor(e.target.value)}
              className="filter-select"
            >
              <option value="">全部颜色</option>
              {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* 类型筛选 */}
            <select 
              value={filterType} 
              onChange={(e) => setFilterType(e.target.value)}
              className="filter-select"
            >
              <option value="">全部类型</option>
              {CARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* 费用筛选 */}
            <select 
              value={filterCost} 
              onChange={(e) => setFilterCost(e.target.value === '' ? '' : Number(e.target.value))}
              className="filter-select"
            >
              <option value="">全部费用</option>
              {COSTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* 重置按钮 */}
            <button className="btn btn-reset" onClick={(e) => {
              e.stopPropagation()
              resetFilters()
            }}>
              重置
            </button>
          </div>
        </div>

        {/* 卡牌网格 */}
        <div className="library-cards">
          {loadingLibrary && libraryCards.length === 0 ? (
            <div className="loading">加载中...</div>
          ) : libraryCards.length === 0 ? (
            <div className="empty-hint">没有找到符合条件的卡牌</div>
          ) : (
            <>
              <div className="library-cards-grid">
                {libraryCards.map(card => {
                  const inDeckCount = deckCards.get(card.card_number) || 0
                  return (
                    <div
                      key={card.card_number}
                      className={`library-card ${getColorClass(card.color)} ${inDeckCount > 0 ? 'in-deck' : ''}`}
                      {...getCardProps(card)}
                    >
                      <img
                        src={getCardImageUrl(card)}
                        alt={card.name_cn || card.name}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `/cards/${card.card_number}.jpg`
                        }}
                      />
                      <div className="library-card-info">
                        <span className="card-number">{card.card_number}</span>
                        {card.cost !== null && <span className="card-cost">{card.cost}</span>}
                        {inDeckCount > 0 && (
                          <span className="in-deck-badge">×{inDeckCount}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {hasMoreCards && (
                <button
                  className="btn btn-load-more"
                  onClick={(e) => {
                    e.stopPropagation()
                    loadMore()
                  }}
                  disabled={loadingLibrary}
                >
                  {loadingLibrary ? '加载中...' : '加载更多'}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* 卡牌预览 */}
      {previewCard && (() => {
        const card = previewCard as any
        const isLeader = card.card_type === 'LEADER' || card.card_type === '领袖'
        const cardNumber = card.card_number
        const inDeckCount = deckCards.get(cardNumber) || 0
        const isInDeck = inDeckCount > 0

        return (
          <CardPreview
            card={previewCard}
            isTouchDevice={isTouchDevice}
            onClose={closePreview}
            getCardImageUrl={getCardImageUrl}
            getColorClass={getColorClass}
            inDeck={isInDeck}
            deckCount={inDeckCount}
            onAdd={() => {
              if (isLeader) {
                // 设置为领袖卡
                const libCard = libraryCards.find(c => c.card_number === cardNumber)
                if (libCard) {
                  setDeckLeaderCard(libCard)
                }
              } else {
                // 添加到牌组或增加数量
                addCardToDeck(cardNumber)
              }
              closePreview()
            }}
            onRemove={() => {
              // 减少数量
              removeCardFromDeck(cardNumber)
              closePreview()
            }}
          />
        )
      })()}
    </div>
  )
}
