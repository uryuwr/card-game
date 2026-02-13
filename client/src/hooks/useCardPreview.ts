import { useState, useCallback, useEffect } from 'react'

// 统一的卡牌数据类型（预览所需的最小字段集）
export interface PreviewableCard {
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

export interface CardPreviewActions {
  /** 当前预览的卡牌 */
  previewCard: PreviewableCard | null
  /** 是否为触摸设备 */
  isTouchDevice: boolean
  /** 关闭预览 */
  close: () => void
  /** 生成绑定到卡牌元素上的事件 props（自动区分PC/移动端） */
  getCardProps: (card: PreviewableCard) => {
    onPointerEnter?: () => void
    onPointerLeave?: () => void
    onClick: (e: React.MouseEvent) => void
  }
}

/**
 * 卡牌预览 Hook
 * - PC端：hover 显示预览，点击 pin 住，再点击空白处关闭
 * - 移动端：点击显示底部抽屉预览，点遮罩或关闭按钮关闭
 */
export function useCardPreview(): CardPreviewActions {
  const [previewCard, setPreviewCard] = useState<PreviewableCard | null>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  // 检测是否为触屏设备
  useEffect(() => {
    const check = () => {
      setIsTouchDevice(
        'ontouchstart' in window || navigator.maxTouchPoints > 0
      )
    }
    check()
    // 监听触摸事件以动态切换（比如连接外部鼠标）
    window.addEventListener('touchstart', () => setIsTouchDevice(true), { once: true })
  }, [])

  const close = useCallback(() => {
    setPreviewCard(null)
    setIsPinned(false)
  }, [])

  const getCardProps = useCallback((card: PreviewableCard) => {
    if (isTouchDevice) {
      // 移动端：只用点击打开预览
      return {
        onClick: (e: React.MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          setPreviewCard(card)
          setIsPinned(true)
        },
      }
    }

    // PC端：hover 预览 + 点击 pin
    return {
      onPointerEnter: () => {
        if (!isPinned) setPreviewCard(card)
      },
      onPointerLeave: () => {
        if (!isPinned) setPreviewCard(null)
      },
      onClick: (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setPreviewCard(card)
        setIsPinned(true)
      },
    }
  }, [isTouchDevice, isPinned])

  return { previewCard, isTouchDevice, close, getCardProps }
}
