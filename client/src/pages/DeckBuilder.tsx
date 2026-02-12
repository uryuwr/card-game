import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiService, type Deck } from '../services/api'
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

  // 卡牌预览
  const [previewCard, setPreviewCard] = useState<LibraryCard | DeckCardDetail | null>(null)

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
    if (selectedDeckId === deckId) {
      setSelectedDeckId(null)
      setDeckDetail(null)
    } else {
      setSelectedDeckId(deckId)
      loadDeckDetail(deckId)
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

  // 按类型分组牌组卡牌
  const groupedDeckCards = useMemo(() => {
    if (!deckDetail) return {}
    const groups: Record<string, DeckCardDetail[]> = {
      '角色': [],
      '事件': [],
      '舞台': [],
    }
    for (const card of deckDetail.cards) {
      const type = card.card_type || '其他'
      if (!groups[type]) groups[type] = []
      groups[type].push(card)
    }
    return groups
  }, [deckDetail])

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
    <div className="deck-builder">
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
                onClick={() => handleSelectDeck(deck.id)}
              >
                <div className="deck-item-name">{deck.name}</div>
                <div className="deck-item-count">{deck.total_cards} 张</div>
                <button 
                  className="btn-edit"
                  onClick={(e) => {
                    e.stopPropagation()
                    // TODO: 进入编辑模式
                    alert('编辑功能开发中...')
                  }}
                >
                  编辑
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 牌组详情预览 */}
        {selectedDeckId && (
          <div className="deck-preview">
            {loadingDeck ? (
              <div className="loading">加载中...</div>
            ) : deckDetail ? (
              <>
                <div className="deck-preview-header">
                  <h3>{deckDetail.name}</h3>
                  <span className="deck-total">共 {deckDetail.total_cards} 张</span>
                </div>
                
                {/* 领袖卡 */}
                {deckDetail.leader && (
                  <div className="deck-leader">
                    <h4>领袖</h4>
                    <div 
                      className="card-thumb"
                      onMouseEnter={() => setPreviewCard(deckDetail.leader)}
                      onMouseLeave={() => setPreviewCard(null)}
                    >
                      <img 
                        src={getCardImageUrl(deckDetail.leader)} 
                        alt={deckDetail.leader.name_cn || deckDetail.leader.name}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `/cards/${deckDetail.leader!.card_number}.jpg`
                        }}
                      />
                      <span className={`card-color-dot ${getColorClass(deckDetail.leader.color)}`} />
                    </div>
                    <div className="leader-name">{deckDetail.leader.name_cn || deckDetail.leader.name}</div>
                  </div>
                )}

                {/* 卡牌分组展示 */}
                <div className="deck-cards-groups">
                  {Object.entries(groupedDeckCards).map(([type, cards]) => (
                    cards.length > 0 && (
                      <div key={type} className="deck-group">
                        <h4>{type} ({cards.reduce((sum, c) => sum + c.count, 0)})</h4>
                        <div className="deck-cards-grid">
                          {cards.map(card => (
                            <div 
                              key={card.card_number}
                              className="card-thumb-mini"
                              onMouseEnter={() => setPreviewCard(card)}
                              onMouseLeave={() => setPreviewCard(null)}
                            >
                              <img 
                                src={getCardImageUrl(card)} 
                                alt={card.name_cn || card.name}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = `/cards/${card.card_number}.jpg`
                                }}
                              />
                              <span className="card-count">×{card.count}</span>
                              <span className={`card-color-dot ${getColorClass(card.color)}`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  ))}
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
            <button className="btn btn-reset" onClick={resetFilters}>
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
                {libraryCards.map(card => (
                  <div 
                    key={card.card_number}
                    className={`library-card ${getColorClass(card.color)}`}
                    onMouseEnter={() => setPreviewCard(card)}
                    onMouseLeave={() => setPreviewCard(null)}
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
                    </div>
                  </div>
                ))}
              </div>
              
              {hasMoreCards && (
                <button 
                  className="btn btn-load-more"
                  onClick={loadMore}
                  disabled={loadingLibrary}
                >
                  {loadingLibrary ? '加载中...' : '加载更多'}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* 卡牌详情预览悬浮框 */}
      {previewCard && (
        <div className="card-preview-popup">
          <img 
            src={getCardImageUrl(previewCard)} 
            alt={previewCard.name_cn || previewCard.name}
            onError={(e) => {
              (e.target as HTMLImageElement).src = `/cards/${previewCard.card_number}.jpg`
            }}
          />
          <div className="preview-info">
            <div className="preview-name">{previewCard.name_cn || previewCard.name}</div>
            <div className="preview-meta">
              <span className={`color-tag ${getColorClass(previewCard.color)}`}>
                {previewCard.color}
              </span>
              <span>{previewCard.card_type}</span>
              {previewCard.cost !== null && <span>费用: {previewCard.cost}</span>}
              {previewCard.power !== null && <span>力量: {previewCard.power}</span>}
            </div>
            {previewCard.effect && (
              <div className="preview-effect">{previewCard.effect}</div>
            )}
            {previewCard.trigger && (
              <div className="preview-trigger">【触发】{previewCard.trigger}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
