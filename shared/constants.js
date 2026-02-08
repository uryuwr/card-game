/**
 * ONE PIECE CARD GAME - Shared Constants
 * Used by both game-server and client
 */

export const GAME_CONFIG = {
  DECK_SIZE: 50,
  DON_DECK_SIZE: 10,
  INITIAL_HAND_SIZE: 5,
  MAX_CHARACTERS: 5,
  DON_PER_TURN: 2,
  DON_FIRST_TURN: 1,
  POWER_PER_DON: 1000,
}

export const CARD_TYPES = {
  LEADER: 'LEADER',
  CHARACTER: 'CHARACTER',
  EVENT: 'EVENT',
  STAGE: 'STAGE',
  DON: 'DON',
}

export const CARD_COLORS = {
  RED: 'RED',
  GREEN: 'GREEN',
  BLUE: 'BLUE',
  PURPLE: 'PURPLE',
  BLACK: 'BLACK',
  YELLOW: 'YELLOW',
}

export const CARD_STATES = {
  ACTIVE: 'active',
  RESTED: 'rested',
}

export const GAME_PHASES = {
  REFRESH: 'refresh',
  DRAW: 'draw',
  DON: 'don',
  MAIN: 'main',
  BATTLE: 'battle',
  END: 'end',
}

export const BATTLE_STEPS = {
  NONE: 'none',
  DECLARE: 'declare',
  BLOCK: 'block',
  COUNTER: 'counter',
  DAMAGE: 'damage',
}

export const KEYWORDS = {
  RUSH: 'Rush',
  BLOCKER: 'Blocker',
  DOUBLE_ATTACK: 'Double Attack',
  BANISH: 'Banish',
  ON_PLAY: 'On Play',
  WHEN_ATTACKING: 'When Attacking',
  COUNTER: 'Counter',
  ACTIVATE_MAIN: 'Activate: Main',
}

export const SOCKET_EVENTS = {
  // Room
  ROOM_CREATE: 'room:create',
  ROOM_CREATED: 'room:created',
  ROOM_JOIN: 'room:join',
  ROOM_JOINED: 'room:joined',
  ROOM_LIST: 'room:list',
  ROOM_UPDATE: 'room:update',
  PLAYER_JOINED: 'player:joined',
  SET_READY: 'room:ready',
  SELECT_LEADER: 'room:select-leader',
  ROOM_LEAVE: 'room:leave',
  
  // Matchmaking
  MATCHMAKING_JOIN: 'matchmaking:join',
  MATCHMAKING_LEAVE: 'matchmaking:leave',
  MATCHMAKING_LEFT: 'matchmaking:left',
  MATCHMAKING_WAITING: 'matchmaking:waiting',
  MATCHMAKING_FOUND: 'matchmaking:found',

  // Game Flow
  GAME_START: 'game:start',
  GAME_UPDATE: 'game:update',
  GAME_END: 'game:end',
  GAME_PHASE_CHANGE: 'game:phase-change',
  PLAYER_LEFT: 'player:left',
  
  // Notifications
  EVENT_PLAYED: 'event:played',
  ATTACK_DECLARED: 'attack:declared',

  // Player Actions
  PLAY_CHARACTER: 'game:play-character',
  PLAY_EVENT: 'game:play-event',
  PLAY_STAGE: 'game:play-stage',
  ATTACH_DON: 'game:attach-don',
  DECLARE_ATTACK: 'game:declare-attack',
  DECLARE_BLOCKER: 'game:declare-blocker',
  PLAY_COUNTER: 'game:play-counter',
  SKIP_COUNTER: 'game:skip-counter',
  SKIP_BLOCKER: 'game:skip-blocker',
  END_MAIN_PHASE: 'game:end-main-phase',
  END_BATTLE_PHASE: 'game:end-battle-phase',
  END_TURN: 'game:end-turn',

  // Utility Actions (semi-automatic board)
  DRAW_CARDS: 'game:draw-cards',
  KO_TARGET: 'game:ko-target',
  BOUNCE_TO_HAND: 'game:bounce-hand',
  BOUNCE_TO_BOTTOM: 'game:bounce-bottom',
  RECOVER_FROM_TRASH: 'game:recover-trash',
  PLAY_FROM_TRASH: 'game:play-from-trash',
  MODIFY_POWER: 'game:modify-power',
  TRASH_FROM_HAND: 'game:trash-from-hand',
  REST_TARGET: 'game:rest-target',
  ACTIVATE_TARGET: 'game:activate-target',
  MOVE_DON: 'game:move-don',
  VIEW_TOP_DECK: 'game:view-top-deck',
  RESOLVE_SEARCH: 'game:resolve-search',
  LIFE_TO_HAND: 'game:life-to-hand',
  SEARCH_DECK: 'game:search-deck',
  PICK_FROM_DECK: 'game:pick-from-deck',
  TRASH_TO_LIFE: 'game:trash-to-life',
  SET_EFFECT_RESTRICTION: 'game:set-effect-restriction',

  // System
  ERROR: 'error',
}
