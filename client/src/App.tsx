import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { GameProvider } from './contexts/GameContext'
import Home from './pages/Home'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import DeckBuilder from './pages/DeckBuilder'
import './App.css'

function App() {
  return (
    <GameProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/game/:roomId" element={<Game />} />
          <Route path="/deck" element={<DeckBuilder />} />
        </Routes>
      </BrowserRouter>
    </GameProvider>
  )
}

export default App
