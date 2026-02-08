import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiService } from '../services/api'
import './DeckBuilder.css'

export default function DeckBuilder() {
  const navigate = useNavigate()
  const [deckName, setDeckName] = useState('')
  const [ocrFile, setOcrFile] = useState<File | null>(null)
  const [ocrResult, setOcrResult] = useState<string>('')

  const handleOcr = async () => {
    if (!ocrFile) return
    try {
      const result = await apiService.recognizeCard(ocrFile)
      setOcrResult(JSON.stringify(result, null, 2))
    } catch (err) {
      setOcrResult('识别失败: ' + (err as Error).message)
    }
  }

  return (
    <div className="deck-builder">
      <h1>卡组管理</h1>

      <div className="deck-section">
        <h2>创建卡组</h2>
        <input
          type="text"
          placeholder="卡组名称"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          className="deck-input"
        />
        <p className="deck-hint">卡组编辑功能开发中...</p>
      </div>

      <div className="deck-section">
        <h2>OCR 卡牌识别</h2>
        <p className="deck-hint">上传卡牌图片，自动识别卡牌信息</p>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setOcrFile(e.target.files?.[0] || null)}
          className="deck-file-input"
        />
        <button className="btn btn-primary" onClick={handleOcr} disabled={!ocrFile}>
          识别卡牌
        </button>
        {ocrResult && (
          <pre className="ocr-result">{ocrResult}</pre>
        )}
      </div>

      <button className="btn-back" onClick={() => navigate('/')}>
        ← 返回
      </button>
    </div>
  )
}
