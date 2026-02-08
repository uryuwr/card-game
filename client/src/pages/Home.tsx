/**
 * ONE PIECE CARD GAME - Home Page
 */

import { useNavigate } from 'react-router-dom'
import './Home.css'

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="home">
      <div className="home-bg" />
      <div className="home-content">
        <h1 className="home-title">🏴‍☠️ ONE PIECE</h1>
        <h2 className="home-subtitle">CARD GAME</h2>
        <p className="home-tagline">在线对战版</p>
        <div className="home-buttons">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/lobby')}>
            ⚔️ 开始对战
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/deck')}>
            🎴 卡组管理
          </button>
        </div>
        <div className="home-features">
          <div className="feature">
            <span className="feature-icon">🃏</span>
            <span>DON!! 能源系统</span>
          </div>
          <div className="feature">
            <span className="feature-icon">⚡</span>
            <span>Power 战力对决</span>
          </div>
          <div className="feature">
            <span className="feature-icon">🛡️</span>
            <span>Blocker & Counter</span>
          </div>
        </div>
      </div>
    </div>
  )
}

