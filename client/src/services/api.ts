/**
 * ONE PIECE CARD GAME - API Service
 * Handles communication with the REST API server
 */

// 动态获取主机地址，支持局域网访问
const getApiServerUrl = () => {
  if (import.meta.env.VITE_API_SERVER_URL) {
    return import.meta.env.VITE_API_SERVER_URL
  }
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `http://${host}:8000`
}
const API_SERVER_URL = getApiServerUrl()

// Types
export interface Card {
  id: string
  cardNumber: string
  name: string
  nameCn?: string
  type: 'LEADER' | 'CHARACTER' | 'EVENT' | 'STAGE'
  color: string
  cost: number | null
  power: number | null
  counter: number | null
  life?: number | null
  attribute: string | null
  effect: string | null
  effectCn?: string | null
  trigger: string | null
  cardSet: string
  rarity: string
  imageUrl?: string
  keywords: string[]
}

export interface DeckCard {
  card_number: string
  count: number
}

export interface Deck {
  id: string
  user_id: string
  name: string
  leader_card_number: string
  cards: DeckCard[]
  total_cards: number
}

export interface User {
  id: string
  username: string
}

class ApiService {
  private baseUrl: string
  private token: string | null = null

  constructor() {
    this.baseUrl = API_SERVER_URL
    this.token = localStorage.getItem('authToken')
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      headers,
      ...options,
    })
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(error.message || 'API request failed')
    }
    
    return res.json()
  }

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('authToken', token)
    } else {
      localStorage.removeItem('authToken')
    }
  }

  // =====================
  // AUTH
  // =====================

  async login(username: string, password: string) {
    const result = await this.request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    this.setToken(result.token)
    return result
  }

  async register(username: string, password: string) {
    const result = await this.request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    this.setToken(result.token)
    return result
  }

  async logout() {
    this.setToken(null)
  }

  // =====================
  // CARDS
  // =====================

  /** Get all cards with optional filters */
  async getCards(filters?: {
    type?: string
    color?: string
    cost?: number
    cardSet?: string
    search?: string
    limit?: number
    offset?: number
    page?: number
  }): Promise<{ cards: Card[]; total: number }> {
    const params = new URLSearchParams()
    if (filters) {
      // Map frontend param names to API param names
      const paramMap: Record<string, string> = {
        type: 'card_type',
        cardSet: 'set_code',
        search: 'q',
        limit: 'page_size',
      }
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          const apiKey = paramMap[key] || key
          params.append(apiKey, String(value))
        }
      })
    }
    const queryString = params.toString()
    return this.request<{ cards: Card[]; total: number }>(
      `/api/cards${queryString ? `?${queryString}` : ''}`
    )
  }

  /** Get a single card by ID or card number */
  async getCard(idOrNumber: string): Promise<Card> {
    return this.request<Card>(`/api/cards/${idOrNumber}`)
  }

  /** Get leaders only */
  async getLeaders(): Promise<Card[]> {
    // 数据库使用中文类型
    const result = await this.getCards({ type: '领袖' } as any)
    return result.cards
  }

  // =====================
  // DECKS
  // =====================

  /** Get all user's decks */
  async getDecks(userId: string = 'system'): Promise<Deck[]> {
    return this.request<Deck[]>(`/api/decks?user_id=${encodeURIComponent(userId)}`)
  }

  /** Get a single deck */
  async getDeck(deckId: string): Promise<Deck> {
    return this.request<Deck>(`/api/decks/${deckId}`)
  }

  /** Create a new deck */
  async createDeck(deck: { name: string; leaderCard: string; cards: string[] }): Promise<Deck> {
    return this.request<Deck>('/api/decks', {
      method: 'POST',
      body: JSON.stringify(deck),
    })
  }

  /** Update an existing deck */
  async updateDeck(deckId: string, deck: { name?: string; leaderCard?: string; cards?: string[] }): Promise<Deck> {
    return this.request<Deck>(`/api/decks/${deckId}`, {
      method: 'PUT',
      body: JSON.stringify(deck),
    })
  }

  /** Delete a deck */
  async deleteDeck(deckId: string): Promise<void> {
    await this.request<void>(`/api/decks/${deckId}`, {
      method: 'DELETE',
    })
  }

  /** Validate a deck (50 cards, leader, etc.) */
  async validateDeck(deckId: string): Promise<{ valid: boolean; errors: string[] }> {
    return this.request<{ valid: boolean; errors: string[] }>(`/api/decks/${deckId}/validate`)
  }

  // =====================
  // OCR
  // =====================

  /** Recognize a card from an image */
  async recognizeCard(imageFile: File): Promise<{ cardNumber: string; confidence: number; card?: Card }> {
    const formData = new FormData()
    formData.append('image', imageFile)
    
    const res = await fetch(`${this.baseUrl}/api/ocr/recognize`, {
      method: 'POST',
      body: formData,
      headers: this.token ? { 'Authorization': `Bearer ${this.token}` } : {},
    })
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(error.message || 'OCR recognition failed')
    }
    
    return res.json()
  }
}

export const apiService = new ApiService()
