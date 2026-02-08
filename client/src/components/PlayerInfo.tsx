import type { Player } from '../contexts/GameContext'
import './PlayerInfo.css'

interface PlayerInfoProps {
  player: Player
  isOpponent?: boolean
}

export default function PlayerInfo({ player, isOpponent = false }: PlayerInfoProps) {
  return (
    <div className={`player-info ${isOpponent ? 'opponent' : ''}`}>
      <div className="player-avatar">
        {isOpponent ? '👤' : '🧙'}
      </div>
      <div className="player-details">
        <span className="player-name">{player.name}</span>
        <div className="player-stats-bar">
          <span className="stat-health">❤ {player.lifeCount}</span>
          <span className="stat-mana">💎 {player.donActive}/{player.donActive + player.donRested}</span>
          <span className="stat-deck">🃏 {player.deckCount}</span>
        </div>
      </div>
    </div>
  )
}
