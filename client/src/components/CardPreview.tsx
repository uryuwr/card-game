import type { PreviewableCard } from '../hooks/useCardPreview'
import './CardPreview.css'

interface CardPreviewProps {
  card: PreviewableCard
  isTouchDevice: boolean
  onClose: () => void
  getCardImageUrl: (card: { card_number: string; image_url?: string | null }) => string
  getColorClass: (color: string) => string
  // 牌组操作回调
  inDeck?: boolean  // 当前预览的卡牌是否在牌组中
  deckCount?: number  // 卡牌在牌组中的数量
  onAdd?: () => void  // + 按钮点击（添加卡牌/增加数量）
  onRemove?: () => void  // - 按钮点击（减少数量）
}

/**
 * 卡牌预览组件
 * - PC端：右侧悬浮面板
 * - 移动端：底部半屏抽屉 + 半透明遮罩
 * - 预览界面底部有 + - 按钮用于操作卡组
 */
export default function CardPreview({
  card,
  isTouchDevice,
  onClose,
  getCardImageUrl,
  getColorClass,
  inDeck = false,
  deckCount = 0,
  onAdd,
  onRemove,
}: CardPreviewProps) {
  const isLeader = card.card_type === 'LEADER' || card.card_type === '领袖'
  const canAdd = !isLeader && onAdd  // 非领袖卡且有添加回调
  const canRemove = inDeck && onRemove && deckCount > 0  // 在牌组中且有移除回调

  // 移动端按钮渲染
  const renderMobileButtons = () => (
    <div className="drawer-actions">
      {canAdd && (
        <button
          className="drawer-action-btn add-btn"
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
        >
          + 添加到牌组
        </button>
      )}
      {canRemove && (
        <button
          className="drawer-action-btn remove-btn"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          - 从牌组移除
        </button>
      )}
      {!canAdd && !canRemove && isLeader && (
        <div className="drawer-hint">点击领袖卡可更换</div>
      )}
    </div>
  )

  // PC端按钮渲染
  const renderPCButtons = () => (
    <div className="popup-actions">
      {canAdd && (
        <button
          className="popup-action-btn add-btn"
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
          title={inDeck ? '增加数量' : '添加到牌组'}
        >
          +
        </button>
      )}
      {canRemove && (
        <button
          className="popup-action-btn remove-btn"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          title="减少数量"
        >
          −
        </button>
      )}
    </div>
  )

  if (isTouchDevice) {
    // ===== 移动端：底部抽屉 =====
    return (
      <div className="card-preview-overlay" onClick={onClose}>
        <div
          className="card-preview-drawer"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 顶部拖拽指示条 + 关闭 */}
          <div className="drawer-header">
            <div className="drawer-handle" />
            <button className="drawer-close-btn" onClick={onClose}>✕</button>
          </div>

          <div className="drawer-body">
            <div className="drawer-image">
              <img
                src={getCardImageUrl(card)}
                alt={card.name_cn || card.name}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `/cards/${card.card_number}.jpg`
                }}
              />
            </div>
            <div className="drawer-info">
              <div className="preview-name">{card.name_cn || card.name}</div>
              <div className="preview-meta">
                <span className={`color-tag ${getColorClass(card.color)}`}>
                  {card.color}
                </span>
                <span>{card.card_type}</span>
                {card.cost !== null && <span>费用: {card.cost}</span>}
                {card.power !== null && <span>力量: {card.power}</span>}
              </div>
              {card.effect && (
                <div className="preview-effect">{card.effect}</div>
              )}
              {card.trigger && (
                <div className="preview-trigger">【触发】{card.trigger}</div>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          {renderMobileButtons()}
        </div>
      </div>
    )
  }

  // ===== PC端：右侧悬浮面板 =====
  return (
    <div
      className="card-preview-popup"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 操作按钮 - 水平中轴线 */}
      {renderPCButtons()}

      <img
        src={getCardImageUrl(card)}
        alt={card.name_cn || card.name}
        onError={(e) => {
          (e.target as HTMLImageElement).src = `/cards/${card.card_number}.jpg`
        }}
      />
      <div className="preview-info">
        <div className="preview-name">{card.name_cn || card.name}</div>
        <div className="preview-meta">
          <span className={`color-tag ${getColorClass(card.color)}`}>
            {card.color}
          </span>
          <span>{card.card_type}</span>
          {card.cost !== null && <span>费用: {card.cost}</span>}
          {card.power !== null && <span>力量: {card.power}</span>}
        </div>
        {card.effect && (
          <div className="preview-effect">{card.effect}</div>
        )}
        {card.trigger && (
          <div className="preview-trigger">【触发】{card.trigger}</div>
        )}
      </div>
    </div>
  )
}
