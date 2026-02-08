import React, { useEffect, useRef } from 'react'
import './RadialMenu.css'

interface MenuOption {
  id: string
  label: string
  icon?: string
  color?: string
  disabled?: boolean
}

interface RadialMenuProps {
  options: MenuOption[]
  position: { x: number; y: number }
  onSelect: (optionId: string) => void
  onClose: () => void
}

const RadialMenu: React.FC<RadialMenuProps> = ({
  options,
  position,
  onSelect,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // ESC关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // 计算菜单位置，确保不超出视口
  const menuW = 130
  const menuH = options.length * 34 + 12
  let left = position.x + 10
  let top = position.y - menuH / 2
  
  // 边界检测
  if (left + menuW > window.innerWidth - 10) {
    left = position.x - menuW - 10
  }
  if (top < 10) top = 10
  if (top + menuH > window.innerHeight - 10) {
    top = window.innerHeight - menuH - 10
  }

  return (
    <div
      ref={menuRef}
      className="radial-menu"
      style={{ left, top }}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          className={`radial-menu-btn ${opt.disabled ? 'disabled' : ''}`}
          style={{ 
            color: opt.disabled ? '#555' : (opt.color || '#ddd'),
            borderColor: opt.disabled ? '#333' : (opt.color || '#444')
          }}
          onClick={() => !opt.disabled && onSelect(opt.id)}
          disabled={opt.disabled}
        >
          {opt.icon && <span className="btn-icon">{opt.icon}</span>}
          <span className="btn-label">{opt.label}</span>
        </button>
      ))}
    </div>
  )
}

export default RadialMenu
