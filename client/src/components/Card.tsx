/**
 * ONE PIECE CARD GAME - Card Component
 * Pure image-based card display — clean, no emoji overlay
 */

import { useState } from 'react'
import type { Card, CardSlot } from '../contexts/GameContext'
import './Card.css'

interface CardProps {
  card: Card
  slot?: CardSlot
  width?: number
  isRested?: boolean
  attachedDon?: number
  selectable?: boolean
  selected?: boolean
  targetable?: boolean
  faceDown?: boolean
  onClick?: (e?: React.MouseEvent) => void
  onHover?: (card: Card | null, e?: React.MouseEvent) => void
  onDonClick?: (e?: React.MouseEvent) => void
  showPower?: boolean
}

const CARD_RATIO = 7 / 5

export default function CardComponent({
  card,
  slot,
  width = 80,
  isRested,
  attachedDon,
  selectable = false,
  selected = false,
  targetable = false,
  faceDown = false,
  onClick,
  onHover,
  onDonClick,
  showPower = false,
}: CardProps) {
  const actualRested = slot?.state === 'RESTED' || isRested
  const actualDon = slot?.attachedDon ?? attachedDon ?? 0
  const actualPower = slot?.power ?? card.power
  const height = Math.round(width * CARD_RATIO)
  const [imgError, setImgError] = useState(false)
  
  // 优先使用imageUrl，如果没有则用本地路径
  const getImgSrc = () => {
    if (imgError) {
      return `/cards/${card.cardNumber}.jpg`
    }
    if (card.imageUrl) {
      return card.imageUrl
    }
    return `/cards/${card.cardNumber}.png`
  }
  const imgSrc = getImgSrc()

  if (card.hidden || faceDown) {
    return (
      <div className={`card-wrap ${selectable ? 'selectable' : ''}`}
        style={{ width, height }} onClick={onClick}>
        <img src="/cards/card-back.webp" alt="card back" className="card-img"
          style={{ width, height }} draggable={false} />
      </div>
    )
  }

  const cls = [
    'card-wrap',
    actualRested ? 'rested' : '',
    selectable ? 'selectable' : '',
    selected ? 'selected' : '',
    targetable ? 'targetable' : '',
  ].filter(Boolean).join(' ')

  const wrapW = actualRested ? height : width
  const wrapH = actualRested ? width : height
  const innerStyle = actualRested
    ? {
        width,
        height,
        position: 'absolute' as const,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%) rotate(90deg)',
        transformOrigin: 'center center',
      }
    : { width, height }

  return (
    <div className={cls}
      style={{ width: wrapW, height: wrapH }}
      onClick={onClick}
      onMouseEnter={(e) => onHover?.(card, e)}
      onMouseLeave={(e) => onHover?.(null, e)}>
      <div className="card-inner" style={innerStyle}>
        <img src={imgSrc} alt={card.nameCn || card.name}
          className="card-img"
          style={{ width, height }}
          draggable={false}
          onError={() => !imgError && setImgError(true)} />
        {showPower && actualPower != null && (
          <div className="card-power-badge">
            <span>{actualPower}</span>
            {actualDon > 0 && <span className="power-plus">+{actualDon * 1000}</span>}
          </div>
        )}
        {actualDon > 0 && <div className="card-don-count" onClick={(e) => {
          e.stopPropagation()
          onDonClick?.(e)
        }}>DON×{actualDon}</div>}
      </div>
    </div>
  )
}

/* Card Back */
export function CardBack({ width = 60, onClick, label }: {
  width?: number; onClick?: () => void; label?: string
}) {
  const height = Math.round(width * CARD_RATIO)
  return (
    <div className="card-wrap" style={{ width, height }} onClick={onClick}>
      <img src="/cards/card-back.webp" alt="card back" className="card-img"
        style={{ width, height }} draggable={false} />
      {label && <div className="cardback-label">{label}</div>}
    </div>
  )
}

/* DON!! Card */
export function DonCard({ width = 36, active = true, onClick, selectable = false, selected = false, faceDown = false, onTouchStart, onTouchEnd }: {
  width?: number; active?: boolean; onClick?: (e?: React.MouseEvent) => void; selectable?: boolean; selected?: boolean; faceDown?: boolean
  onTouchStart?: () => void; onTouchEnd?: () => void
}) {
  const height = Math.round(width * CARD_RATIO)
  // 横置时：外层容器宽=height, 高=width，内部图片旋转90度
  const wrapW = active ? width : height
  const wrapH = active ? height : width
  // faceDown=true用卡背(don-deck), faceDown=false用卡面(cost区)
  const imgSrc = faceDown ? '/cards/card-back-2.webp' : '/cards/don.webp'
  return (
    <div className={`card-wrap don-wrap ${active ? '' : 'don-rested'} ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}`}
      style={{ width: wrapW, height: wrapH }} 
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}>
      <img src={imgSrc} alt="DON!!"
        className="card-img"
        style={!active
          ? { 
              width, 
              height, 
              transform: 'rotate(90deg)', 
              transformOrigin: 'center center',
              position: 'absolute',
              top: '50%',
              left: '50%',
              marginTop: -height / 2,
              marginLeft: -width / 2,
            }
          : { width, height }}
        draggable={false} />
    </div>
  )
}
