/**
 * ONE PIECE CARD GAME - Card Pool Loader
 * Loads cards from API server and provides deck building utilities
 */

import { CARD_TYPES, GAME_CONFIG } from '../../shared/constants.js'

// In-memory card pool cache
let cardPoolCache = []
let lastFetchTime = 0
const CACHE_TTL = 60000 // 1 minute cache

// Map Chinese card types to English constants
const CARD_TYPE_MAP = {
  '领袖': CARD_TYPES.LEADER,
  '角色': CARD_TYPES.CHARACTER,
  '事件': CARD_TYPES.EVENT,
  '舞台': CARD_TYPES.STAGE,
}

/**
 * Normalize card from API format
 */
function normalizeCard(card) {
  return {
    ...card,
    cardType: CARD_TYPE_MAP[card.cardType] || card.cardType,
  }
}

/**
 * Fetch cards from API server
 */
async function fetchCardsFromAPI() {
  const now = Date.now()
  if (cardPoolCache.length > 0 && now - lastFetchTime < CACHE_TTL) {
    return cardPoolCache
  }

  try {
    const API_URL = process.env.API_URL || 'http://127.0.0.1:8000'
    const response = await fetch(`${API_URL}/api/cards/?limit=1000`)
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    // Normalize card types from Chinese to English constants
    cardPoolCache = (data.cards || []).map(normalizeCard)
    lastFetchTime = now
    console.log(`Loaded ${cardPoolCache.length} cards from API`)
    return cardPoolCache
  } catch (error) {
    console.error('Failed to fetch cards from API:', error)
    // Return cache or fallback to mock data
    if (cardPoolCache.length > 0) {
      return cardPoolCache
    }
    return getMockCardPool()
  }
}

/**
 * Get card pool (sync version - returns cached data)
 */
export function getCardPool() {
  if (cardPoolCache.length === 0) {
    // Return mock data for immediate availability
    return getMockCardPool()
  }
  return cardPoolCache
}

/**
 * Get card pool async (fetches from API)
 */
export async function getCardPoolAsync() {
  return fetchCardsFromAPI()
}

/**
 * Fetch a deck from API by deck ID
 * Returns { leader: cardData, deck: [cardData...] }
 */
export async function fetchDeckFromAPI(deckId) {
  try {
    const API_URL = process.env.API_URL || 'http://127.0.0.1:8000'
    const response = await fetch(`${API_URL}/api/decks/${deckId}`)
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    console.log(`[DECK] Fetched deck "${data.name}" with ${data.total_cards} cards`)
    
    // Build deck array with proper counts
    const deckCards = []
    for (const cardEntry of data.cards || []) {
      // Convert API card format to game format
      const cardData = {
        id: cardEntry.card_number,
        cardNumber: cardEntry.card_number,
        name: cardEntry.name,
        nameCn: cardEntry.name_cn,
        cardType: CARD_TYPE_MAP[cardEntry.card_type] || cardEntry.card_type,
        color: cardEntry.color,
        cost: cardEntry.cost,
        power: cardEntry.power,
        counter: cardEntry.counter,
        effect: cardEntry.effect,
        trigger: cardEntry.trigger,
        imageUrl: cardEntry.image_url,
      }
      // Add multiple copies based on count
      for (let i = 0; i < cardEntry.count; i++) {
        deckCards.push({ ...cardData })
      }
    }
    
    // Build leader data
    const leaderData = data.leader ? {
      id: data.leader.card_number,
      cardNumber: data.leader.card_number,
      name: data.leader.name,
      nameCn: data.leader.name_cn,
      cardType: CARD_TYPES.LEADER,
      color: data.leader.color,
      power: data.leader.power,
      life: data.leader.life,
      effect: data.leader.effect,
      trigger: data.leader.trigger,
      imageUrl: data.leader.image_url,
    } : null
    
    return {
      deckId: data.id,
      name: data.name,
      leader: leaderData,
      deck: deckCards,
      totalCards: data.total_cards,
    }
  } catch (error) {
    console.error(`[DECK] Failed to fetch deck ${deckId}:`, error)
    return null
  }
}

/**
 * Find a card by card number
 */
export function findCard(cardNumber) {
  return cardPoolCache.find(c => c.cardNumber === cardNumber)
}

/**
 * Get cards by set code
 */
export function getCardsBySet(setCode) {
  return cardPoolCache.filter(c => c.setCode === setCode)
}

/**
 * Get all Leader cards
 */
export function getLeaders() {
  return cardPoolCache.filter(c => c.cardType === CARD_TYPES.LEADER)
}

/**
 * Build a deck from card pool
 * Returns { deck: [], life: [] }
 * @param {Array} cardPool - All available cards
 * @param {string} leaderColor - Leader's color (e.g., 'RED', '红')
 * @param {number} lifeCount - Leader's life value
 */
export function buildDeckFromCards(cardPool, leaderColor, lifeCount = 5) {
  // Filter cards by leader's color (deck can only contain cards matching leader's color)
  // Support both English (RED) and Chinese (红) color names
  const colorMatch = (cardColor) => {
    if (!cardColor || !leaderColor) return true // If no color info, allow
    const normalizedCardColor = cardColor.toLowerCase()
    const normalizedLeaderColor = leaderColor.toLowerCase()
    // Check if any color matches (support multi-color cards like "红/黄")
    return normalizedCardColor.includes(normalizedLeaderColor) || 
           normalizedLeaderColor.includes(normalizedCardColor) ||
           (normalizedLeaderColor.includes('red') && normalizedCardColor.includes('红')) ||
           (normalizedLeaderColor.includes('红') && normalizedCardColor.includes('red'))
  }
  
  const availableCards = cardPool.filter(c => 
    c.cardType !== CARD_TYPES.LEADER && colorMatch(c.color)
  )
  
  console.log(`[DECK] Building deck with ${availableCards.length} available cards (color: ${leaderColor})`)
  
  if (availableCards.length === 0) {
    console.warn(`No cards found for color ${leaderColor}, using all non-leader cards`)
    return buildDefaultDeck(cardPool, lifeCount)
  }

  // Build a 50-card deck (4 copies max per card, per official rules)
  const deck = []
  const shuffled = [...availableCards].sort(() => Math.random() - 0.5)
  
  while (deck.length < GAME_CONFIG.DECK_SIZE) {
    for (const card of shuffled) {
      if (deck.length >= GAME_CONFIG.DECK_SIZE) break
      
      // Count current copies
      const count = deck.filter(c => c.cardNumber === card.cardNumber).length
      if (count < 4) {
        deck.push({ ...card })
      }
    }
    
    // Safety check
    if (deck.length === 0) break
  }

  // Shuffle the final deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }

  // Take life cards (face down, from end of deck)
  const life = deck.splice(0, lifeCount)

  return { deck, life }
}

/**
 * Build default deck when no set specified
 */
function buildDefaultDeck(cardPool, lifeCount) {
  const nonLeaders = cardPool.filter(c => c.cardType !== CARD_TYPES.LEADER)
  
  if (nonLeaders.length === 0) {
    return { deck: [], life: [] }
  }

  const deck = []
  while (deck.length < GAME_CONFIG.DECK_SIZE && nonLeaders.length > 0) {
    const card = nonLeaders[Math.floor(Math.random() * nonLeaders.length)]
    const count = deck.filter(c => c.cardNumber === card.cardNumber).length
    if (count < 4) {
      deck.push({ ...card })
    }
  }

  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }

  const life = deck.splice(0, lifeCount)
  return { deck, life }
}

/**
 * Mock card pool for development/fallback
 * Minimal ST01 + ST02 cards
 */
function getMockCardPool() {
  return [
    // ST01 - Straw Hat Crew
    {
      cardNumber: 'ST01-001',
      name: 'Monkey.D.Luffy',
      nameCn: '蒙奇·D·路飞',
      cardType: CARD_TYPES.LEADER,
      color: 'RED',
      cost: null,
      power: 5000,
      counter: null,
      life: 5,
      attribute: 'Strike',
      effect: '[Activate: Main] [Turn 1] Put 1 DON!! card from your DON!! deck on this leader.',
      trigger: null,
      trait: 'Supernovas/Straw Hat Crew',
      rarity: 'L',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-002',
      name: 'Usopp',
      nameCn: '乌索普',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 2,
      power: 2000,
      counter: 1000,
      life: null,
      attribute: 'Ranged',
      effect: null,
      trigger: null,
      trait: 'Straw Hat Crew',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-003',
      name: 'Karoo',
      nameCn: '跑得快',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 1,
      power: 3000,
      counter: 1000,
      life: null,
      attribute: 'Strike',
      effect: null,
      trigger: null,
      trait: 'Alabasta/Animal',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-004',
      name: 'Sanji',
      nameCn: '山治',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 2,
      power: 4000,
      counter: 1000,
      life: null,
      attribute: 'Strike',
      effect: null,
      trigger: null,
      trait: 'Straw Hat Crew',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-005',
      name: 'Tony Tony.Chopper',
      nameCn: '托尼托尼·乔巴',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 1,
      power: 1000,
      counter: 1000,
      life: null,
      attribute: 'Strike',
      effect: '[Blocker]',
      trigger: null,
      trait: 'Straw Hat Crew/Animal',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-006',
      name: 'Nami',
      nameCn: '娜美',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 1,
      power: 2000,
      counter: 1000,
      life: null,
      attribute: 'Special',
      effect: null,
      trigger: null,
      trait: 'Straw Hat Crew',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-007',
      name: 'Nico Robin',
      nameCn: '妮可·罗宾',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 3,
      power: 5000,
      counter: 1000,
      life: null,
      attribute: 'Wisdom',
      effect: null,
      trigger: null,
      trait: 'Straw Hat Crew',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-008',
      name: 'Franky',
      nameCn: '弗兰奇',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 4,
      power: 6000,
      counter: 1000,
      life: null,
      attribute: 'Strike',
      effect: null,
      trigger: null,
      trait: 'Straw Hat Crew',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-009',
      name: 'Brook',
      nameCn: '布鲁克',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 4,
      power: 5000,
      counter: 1000,
      life: null,
      attribute: 'Slash',
      effect: '[Rush]',
      trigger: null,
      trait: 'Straw Hat Crew',
      rarity: 'R',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-012',
      name: 'Roronoa Zoro',
      nameCn: '罗罗诺亚·索隆',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 3,
      power: 5000,
      counter: 2000,
      life: null,
      attribute: 'Slash',
      effect: '[DON!! x1] This character gains +1000 power.',
      trigger: null,
      trait: 'Supernovas/Straw Hat Crew',
      rarity: 'SR',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-013',
      name: 'Monkey.D.Luffy',
      nameCn: '蒙奇·D·路飞',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 5,
      power: 6000,
      counter: null,
      life: null,
      attribute: 'Strike',
      effect: '[Rush] [DON!! x2] When this character attacks, deal 1 damage to your opponent.',
      trigger: null,
      trait: 'Supernovas/Straw Hat Crew',
      rarity: 'SR',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-015',
      name: "Gum-Gum Jet Pistol",
      nameCn: '橡胶火箭炮',
      cardType: CARD_TYPES.EVENT,
      color: 'RED',
      cost: 4,
      power: null,
      counter: null,
      life: null,
      attribute: null,
      effect: '[Main] K.O. up to 1 of your opponent\'s Characters with 6000 power or less.',
      trigger: '[Trigger] K.O. up to 1 of your opponent\'s Characters with 4000 power or less.',
      trait: 'Straw Hat Crew',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-016',
      name: 'Guard Point',
      nameCn: '防御强化',
      cardType: CARD_TYPES.EVENT,
      color: 'RED',
      cost: 1,
      power: null,
      counter: null,
      life: null,
      attribute: null,
      effect: '[Counter] Up to 1 of your Leader or Characters gains +2000 power during this battle.',
      trigger: null,
      trait: 'Straw Hat Crew/Animal',
      rarity: 'C',
      setCode: 'ST01',
    },
    {
      cardNumber: 'ST01-017',
      name: 'Thousand Sunny',
      nameCn: '万里阳光号',
      cardType: CARD_TYPES.STAGE,
      color: 'RED',
      cost: 2,
      power: null,
      counter: null,
      life: null,
      attribute: null,
      effect: '[Activate: Main] You may rest this Stage: Add up to 1 DON!! card from your DON!! deck and set it as active.',
      trigger: null,
      trait: 'Straw Hat Crew',
      rarity: 'C',
      setCode: 'ST01',
    },

    // ST02 - Red Hair Pirates
    {
      cardNumber: 'ST02-001',
      name: 'Shanks',
      nameCn: '香克斯',
      cardType: CARD_TYPES.LEADER,
      color: 'RED',
      cost: null,
      power: 5000,
      counter: null,
      life: 5,
      attribute: 'Slash',
      effect: '[Activate: Main] [Turn 1] Give up to 1 of your Characters +1000 power during this turn.',
      trigger: null,
      trait: 'FILM/Red Hair Pirates',
      rarity: 'L',
      setCode: 'ST02',
    },
    {
      cardNumber: 'ST02-002',
      name: 'Lucky Roux',
      nameCn: '拉基·鲁',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 3,
      power: 4000,
      counter: 1000,
      life: null,
      attribute: 'Strike',
      effect: '[On Play] Draw 1 card.',
      trigger: null,
      trait: 'FILM/Red Hair Pirates',
      rarity: 'C',
      setCode: 'ST02',
    },
    {
      cardNumber: 'ST02-003',
      name: 'Yasopp',
      nameCn: '耶稣布',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 2,
      power: 4000,
      counter: 1000,
      life: null,
      attribute: 'Ranged',
      effect: null,
      trigger: null,
      trait: 'FILM/Red Hair Pirates',
      rarity: 'C',
      setCode: 'ST02',
    },
    {
      cardNumber: 'ST02-004',
      name: 'Ben Beckman',
      nameCn: '本·贝克曼',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 5,
      power: 6000,
      counter: 1000,
      life: null,
      attribute: 'Wisdom',
      effect: '[Blocker] [On Block] Draw 1 card.',
      trigger: null,
      trait: 'FILM/Red Hair Pirates',
      rarity: 'R',
      setCode: 'ST02',
    },
    {
      cardNumber: 'ST02-009',
      name: 'Shanks',
      nameCn: '香克斯',
      cardType: CARD_TYPES.CHARACTER,
      color: 'RED',
      cost: 7,
      power: 8000,
      counter: null,
      life: null,
      attribute: 'Slash',
      effect: '[Rush] This character cannot be K.O.\'d by opponent\'s effects.',
      trigger: null,
      trait: 'FILM/Red Hair Pirates',
      rarity: 'SR',
      setCode: 'ST02',
    },
    {
      cardNumber: 'ST02-013',
      name: "Great Elf Merry",
      nameCn: '伟大精灵梅丽号',
      cardType: CARD_TYPES.EVENT,
      color: 'RED',
      cost: 1,
      power: null,
      counter: null,
      life: null,
      attribute: null,
      effect: '[Main] Look at 5 cards from the top of your deck; reveal up to 1 [Red Hair Pirates] type card other than [Great Elf Merry] and add it to your hand. Then, place the rest at the bottom of your deck in any order.',
      trigger: null,
      trait: 'Red Hair Pirates',
      rarity: 'C',
      setCode: 'ST02',
    },
  ]
}

// Initialize by fetching cards
fetchCardsFromAPI().catch(err => {
  console.log('Initial card fetch failed, using mock data:', err.message)
})

export { getMockCardPool }
