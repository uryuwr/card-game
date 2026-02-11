/**
 * CardScripts - 卡牌脚本注册表
 * 以 cardNumber 为 key，定义每张卡的触发器和动作
 * 
 * 脚本格式:
 * {
 *   triggerType: 'ON_PLAY' | 'ON_ATTACK' | 'TURN_END' | ...,
 *   conditions: [{ type: 'CHECK_DON', amount: 2 }, ...],
 *   actions: [{ type: 'MODIFY_POWER', target: 'SELF', amount: 2000 }, ...]
 * }
 * 
 * 一张卡可以有多个触发器（数组形式）
 */

export const CARD_SCRIPTS = {

  // ===================================================
  // 🔴 草帽一伙 (Straw Hat Crew)
  // ===================================================

  /**
   * ST01-011 布鲁克 (Brook)
   * ON_PLAY: 赋予己方2张休息Don
   * 实际效果: 将2张休息状态的DON!!卡牌贴到角色上
   * 简化实现: 给自己贴2 DON (从休息池)
   */
  'ST01-011': {
    triggerType: 'ON_PLAY',
    conditions: [],
    actions: [
      {
        type: 'PENDING_ATTACH_DON',
        count: 2,
        donState: 'rested',
      },
    ],
  },

  /**
   * ST01-012 蒙奇·D·路飞 (Monkey D. Luffy)
   * ON_ATTACK: [Don!! x2] 本次战斗对手不能发动[阻挡者]
   */
  'ST01-012': {
    triggerType: 'ON_ATTACK',
    conditions: [
      { type: 'CHECK_DON', amount: 2 },
    ],
    actions: [
      {
        type: 'ADD_ATTACK_STATE',
        state: 'ignoreBlocker',
        value: true,
      },
      {
        type: 'LOG',
        message: '路飞: 对手不能发动阻挡者!',
      },
    ],
  },

  // ===================================================
  // ⚪ 白胡子海盗团 (Whitebeard Pirates)
  // ===================================================

  /**
   * OP02-001 爱德华·纽哥特 (Edward Newgate) - Leader
   * TURN_END: 生命区最上方1张卡加入手牌
   */
  'OP02-001': {
    triggerType: 'TURN_END',
    conditions: [
      { type: 'CHECK_RESTRICTION', restriction: 'cannotLifeToHand' },
    ],
    actions: [
      {
        type: 'LIFE_TO_HAND',
      },
      {
        type: 'LOG',
        message: '白胡子: 生命区顶牌加入手牌',
      },
    ],
  },

  /**
   * OP02-004 爱德华·纽哥特 (Edward Newgate) - Character
   * ON_PLAY: 领袖+2000，本回合禁止通过效果将生命牌加入手牌
   * ON_ATTACK: [Don!! x2] KO <=3000 (需要UI选择目标，暂时只做限制效果)
   */
  'OP02-004': [
    {
      triggerType: 'ON_PLAY',
      conditions: [],
      actions: [
        {
          type: 'MODIFY_POWER',
          target: 'LEADER',
          amount: 2000,
        },
        {
          type: 'SET_RESTRICTION',
          restriction: 'cannotLifeToHand',
          value: true,
        },
        {
          type: 'LOG',
          message: '爱德华·纽哥特: 领袖+2000，本回合无法通过效果将生命牌加入手牌',
        },
      ],
    },
    // ON_ATTACK 效果需要 UI 交互选择目标，Phase 2 实现
    // {
    //   triggerType: 'ON_ATTACK',
    //   conditions: [{ type: 'CHECK_DON', amount: 2 }],
    //   actions: [{ type: 'KO_CHARACTER', target: 'CHOOSE', filter: { maxPower: 3000 }, targetPlayer: 'opponent' }],
    // },
  ],

  /**
   * OP01-016 奈美 (Nami)
   * ON_PLAY: 看牌组顶5张，检索1张非奈美的[草帽一伙]特征卡加入手牌
   */
  'OP01-016': {
    triggerType: 'ON_PLAY',
    conditions: [],
    actions: [
      {
        type: 'PENDING_SEARCH',
        count: 5,                    // 看顶部5张
        maxSelect: 1,                // 最多选1张
        filter: {
          trait: '草帽一伙',         // 必须有草帽一伙特征
          excludeCardNumber: 'OP01-016',  // 排除奈美自己
        },
        message: '选择1张非"奈美"的拥有《草帽一伙》特征的卡牌加入手牌',
      },
    ],
  },

  /**
   * OP03-003 伊佐 (Izo)
   * ON_PLAY: 看牌组顶5张，检索1张非伊佐的[白胡子海盗团]特征卡加入手牌
   */
  'OP03-003': {
    triggerType: 'ON_PLAY',
    conditions: [],
    actions: [
      {
        type: 'PENDING_SEARCH',
        count: 5,                    // 看顶部5张
        maxSelect: 1,                // 最多选1张
        filter: {
          trait: '白胡子海盗团',     // 必须有白胡子海盗团特征
          excludeCardNumber: 'OP03-003',  // 排除伊佐自己
        },
        message: '选择1张非"伊佐"的拥有《白胡子海盗团》特征的卡牌加入手牌',
      },
    ],
  },

  /**
   * OP01-029 离子光波 (Diable Jambe / Ion Cannon)
   * COUNTER: 选择己方1张领袖或角色，本回合力量+2000，若生命<=2则再+2000
   * 费用: 1 DON
   */
  'OP01-029': {
    triggerType: 'COUNTER',
    cost: 1,
    conditions: [],
    actions: [
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'player',           // 只能选己方
        targetTypes: ['leader', 'character'],  // 领袖或角色
        maxSelect: 1,
        message: '选择己方1张领袖或角色，本回合力量+2000',
        onSelect: [
          // 基础效果: +2000
          {
            type: 'MODIFY_POWER',
            target: 'SELECTED',
            amount: 2000,
          },
          // 条件效果: 若生命<=2再+2000
          {
            type: 'CONDITIONAL_ACTION',
            condition: { type: 'CHECK_LIFE', operator: '<=', amount: 2 },
            actions: [
              {
                type: 'MODIFY_POWER',
                target: 'SELECTED',
                amount: 2000,
              },
              {
                type: 'LOG',
                message: '生命<=2，额外+2000!',
              },
            ],
          },
        ],
      },
    ],
  },
}
