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
   * ON_PLAY: 将最多2张休息状态的DON!!卡贴附到己方1张领袖或角色上
   * 注意：消耗的DON会变成休息状态，然后贴附给目标
   */
  'ST01-011': {
    triggerType: 'ON_PLAY',
    conditions: [
      { type: 'CHECK_RESTED_DON', minAmount: 1 },  // 至少需要1个休息DON
    ],
    actions: [
      {
        type: 'PENDING_ATTACH_DON',
        donCount: 2,  // 最多贴2个DON到同一个目标
        donState: 'rested',
        targetScope: 'player',
        targetTypes: ['leader', 'character'],
        maxSelect: 1,  // 只能选1个目标
        message: '选择己方1张领袖或角色，贴附最多2张休息DON',
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

  /**
   * ST01-014 毛皮强化 (Event)
   * COUNTER: +3000
   * TRIGGER: 我方最多1张领袖或角色+1000
   */
  'ST01-014': [
    {
      triggerType: 'COUNTER',
      cost: 0,
      conditions: [],
      actions: [
        {
          type: 'PENDING_SELECT_TARGET',
          targetScope: 'player',
          targetTypes: ['leader', 'character'],
          maxSelect: 1,
          message: '选择己方1张领袖或角色，力量+3000',
          onSelect: [
            {
              type: 'MODIFY_POWER',
              target: 'SELECTED',
              amount: 3000,
            },
          ],
        },
      ],
    },
    {
      triggerType: 'TRIGGER',
      conditions: [],
      actions: [
        {
          type: 'PENDING_SELECT_TARGET',
          targetScope: 'player',
          targetTypes: ['leader', 'character'],
          maxSelect: 1,
          message: '选择己方1张领袖或角色，本回合力量+1000',
          onSelect: [
            {
              type: 'MODIFY_POWER',
              target: 'SELECTED',
              amount: 1000,
              expiry: 'END_OF_TURN',
            },
          ],
        },
        {
          type: 'LOG',
          message: '毛皮强化: 触发效果发动，力量+1000!',
        },
      ],
    },
  ],

  /**
   * ST01-016 恶魔风脚 (Event)
   * MAIN: 选择己方1张草帽一伙特征的领袖或角色，本回合无视阻挡者
   * TRIGGER: KO对方费用<=3且有阻挡者的角色
   */
  'ST01-016': [
    {
      triggerType: 'ACTIVATE_MAIN',
      cost: 1,
      conditions: [],
      actions: [
        {
          type: 'PENDING_SELECT_TARGET',
          targetScope: 'player',
          targetTypes: ['leader', 'character'],
          maxSelect: 1,
          filter: { trait: '草帽一伙' },
          message: '选择己方1张草帽一伙领袖或角色，本回合攻击时对手不能发动阻挡者',
          onSelect: [
            {
              type: 'ADD_FIELD_STATE',
              target: 'SELECTED',
              state: 'cannotBeBlocked',
              value: true,
              expiry: 'END_OF_TURN',
            },
            {
              type: 'LOG',
              message: '恶魔风脚: 目标本回合攻击时对手不能发动阻挡者!',
            },
          ],
        },
      ],
    },
    {
      triggerType: 'TRIGGER',
      conditions: [],
      actions: [
        {
          type: 'PENDING_KO_TARGET',
          targetScope: 'opponent',
          targetTypes: ['character'],
          filter: { maxCost: 3, hasKeyword: 'Blocker' },
          maxSelect: 1,
          optional: true,
          message: 'KO对方最多1张费用<=3且有【阻挡者】的角色',
        },
        {
          type: 'LOG',
          message: '恶魔风脚: 触发效果发动!',
        },
      ],
    },
  ],

  /**
   * OP01-013 山智 (Sanji)
   * ACTIVATE_MAIN: [1回合1次] 将己方1张生命加入手牌，本回合+2000，贴2张休息DON
   */
  'OP01-013': {
    triggerType: 'ACTIVATE_MAIN',
    cost: 0,
    conditions: [
      { type: 'CHECK_ONCE_PER_TURN', key: 'OP01-013' },
    ],
    actions: [
      {
        type: 'LIFE_TO_HAND',
      },
      {
        type: 'MODIFY_POWER',
        target: 'SELF',
        amount: 2000,
        expiry: 'END_OF_TURN',
      },
      {
        type: 'ATTACH_DON',
        target: 'SELF',
        count: 2,
        donState: 'rested',
      },
      {
        type: 'SET_ONCE_PER_TURN',
        key: 'OP01-013',
      },
      {
        type: 'LOG',
        message: '山智: 生命牌加入手牌，获得+2000和2DON!',
      },
    ],
  },

  /**
   * OP01-015 托尼托尼·乔巴 (Chopper)
   * ON_ATTACK: [Don!! x1] 弃1手牌，从废弃区回收1张Cost<=4的草帽一伙角色(排除乔巴)
   */
  'OP01-015': {
    triggerType: 'ON_ATTACK',
    conditions: [
      { type: 'CHECK_DON', amount: 1 },
    ],
    actions: [
      {
        type: 'PENDING_DISCARD',
        count: 1,
        message: '丢弃1张手牌以发动效果',
        onDiscard: [
          {
            type: 'PENDING_RECOVER_FROM_TRASH',
            maxSelect: 1,
            filter: {
              cardType: 'CHARACTER',
              maxCost: 4,
              trait: '草帽一伙',
              excludeCardNumber: 'OP01-015',
            },
            message: '从废弃区选择1张费用<=4的草帽一伙角色加入手牌',
          },
        ],
      },
    ],
  },

  /**
   * OP01-026 橡皮橡皮火拳枪 (Event)
   * COUNTER: +4000，然后KO对手1张力量<=4000的角色
   * TRIGGER: 对方最多1张领袖或角色-10000
   */
  'OP01-026': [
    {
      triggerType: 'COUNTER',
      cost: 2,
      conditions: [],
      actions: [
        {
          type: 'PENDING_SELECT_TARGET',
          targetScope: 'player',
          targetTypes: ['leader', 'character'],
          maxSelect: 1,
          message: '选择己方1张领袖或角色，力量+4000',
          onSelect: [
            {
              type: 'MODIFY_POWER',
              target: 'SELECTED',
              amount: 4000,
            },
            {
              type: 'PENDING_KO_TARGET',
              targetScope: 'opponent',
              targetTypes: ['character'],
              filter: { maxPower: 4000 },
              maxSelect: 1,
              optional: true,
              message: 'KO对手1张力量<=4000的角色',
            },
          ],
        },
      ],
    },
    {
      triggerType: 'TRIGGER',
      conditions: [],
      actions: [
        {
          type: 'PENDING_SELECT_TARGET',
          targetScope: 'opponent',
          targetTypes: ['leader', 'character'],
          maxSelect: 1,
          message: '选择对方1张领袖或角色，本回合力量-10000',
          onSelect: [
            {
              type: 'MODIFY_POWER',
              target: 'SELECTED',
              amount: -10000,
              expiry: 'END_OF_TURN',
            },
          ],
        },
        {
          type: 'LOG',
          message: '橡皮橡皮火拳枪: 触发效果发动，对方力量-10000!',
        },
      ],
    },
  ],

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
          expiry: 'NEXT_TURN_START',
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
    {
      triggerType: 'ON_ATTACK',
      conditions: [
        { type: 'CHECK_DON', amount: 2 },
      ],
      actions: [
        {
          type: 'PENDING_KO_TARGET',
          targetScope: 'opponent',
          targetTypes: ['character'],
          filter: { maxPower: 3000 },
          maxSelect: 1,
          optional: true,
          message: 'KO对手1张力量<=3000的角色',
        },
      ],
    },
  ],

  /**
   * OP02-008 乔兹 (Jozu)
   * CONSTANT: [Don!! x1] 生命<=2 且领袖是白胡子海盗团，获得[速攻]
   */
  'OP02-008': {
    triggerType: 'CONSTANT',
    conditions: [],
    dynamicKeywords: [
      {
        keyword: 'Rush',
        conditions: [
          { type: 'CHECK_DON', amount: 1 },
          { type: 'CHECK_LIFE', operator: '<=', amount: 2 },
          { type: 'CHECK_LEADER_TRAIT', trait: '白胡子海盗团' },
        ],
      },
    ],
  },

  /**
   * OP02-013 波特夹斯·D·艾斯 (Portgas D. Ace)
   * ON_PLAY: 对手最多2张角色力量-3000，若领袖是白胡子海盗团则获得[速攻]
   */
  'OP02-013': {
    triggerType: 'ON_PLAY',
    conditions: [],
    actions: [
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'opponent',
        targetTypes: ['character'],
        maxSelect: 2,
        optional: true,
        message: '选择对手最多2张角色，力量-3000',
        onSelect: [
          {
            type: 'MODIFY_POWER',
            target: 'ALL_SELECTED',
            amount: -3000,
          },
        ],
      },
      {
        type: 'CONDITIONAL_ACTION',
        condition: { type: 'CHECK_LEADER_TRAIT', trait: '白胡子海盗团' },
        actions: [
          {
            type: 'GRANT_KEYWORD',
            target: 'SELF',
            keyword: 'Rush',
            expiry: 'END_OF_TURN',
          },
          {
            type: 'LOG',
            message: '艾斯: 领袖是白胡子海盗团，获得【速攻】!',
          },
        ],
      },
    ],
  },

  /**
   * OP02-015 卷乃 (Curly)
   * ACTIVATE_MAIN: 将此角色转为休息状态，选择己方1张费用1的红色角色+3000
   */
  'OP02-015': {
    triggerType: 'ACTIVATE_MAIN',
    cost: 0,
    conditions: [
      { type: 'SELF_ACTIVE' },
    ],
    actions: [
      {
        type: 'REST_SELF',
      },
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'player',
        targetTypes: ['character'],
        filter: { cost: 1, color: 'RED' },
        maxSelect: 1,
        message: '选择己方1张费用1的红色角色，力量+3000',
        onSelect: [
          {
            type: 'MODIFY_POWER',
            target: 'SELECTED',
            amount: 3000,
          },
        ],
      },
    ],
  },

  /**
   * OP03-013 马尔高 (Marco)
   * ON_PLAY [我方回合]: KO对手1张力量<=3000的角色
   * ON_KO: 弃1张事件，从废弃区复活自己(休息状态)
   */
  'OP03-013': [
    {
      triggerType: 'ON_PLAY',
      conditions: [
        { type: 'IS_MY_TURN' },
      ],
      actions: [
        {
          type: 'PENDING_KO_TARGET',
          targetScope: 'opponent',
          targetTypes: ['character'],
          filter: { maxPower: 3000 },
          maxSelect: 1,
          optional: true,
          message: 'KO对手1张力量<=3000的角色',
        },
      ],
    },
    {
      triggerType: 'ON_KO',
      conditions: [],
      actions: [
        {
          type: 'PENDING_DISCARD_EVENT',
          count: 1,
          optional: true,
          message: '丢弃1张事件卡，从废弃区复活马尔高',
          onDiscard: [
            {
              type: 'REVIVE_SELF',
              state: 'RESTED',
            },
          ],
        },
      ],
    },
  ],

  /**
   * OP03-015 莉姆 (Rym)
   * ON_KO [对方回合]: 对手1张领袖或角色力量-2000
   */
  'OP03-015': {
    triggerType: 'ON_KO',
    conditions: [
      { type: 'IS_OPPONENT_TURN' },
    ],
    actions: [
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'opponent',
        targetTypes: ['leader', 'character'],
        maxSelect: 1,
        message: '选择对手1张领袖或角色，力量-2000',
        onSelect: [
          {
            type: 'MODIFY_POWER',
            target: 'SELECTED',
            amount: -2000,
            expiry: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  // ===================================================
  // 🟢 动物/乔巴 (Animal / Chopper)
  // ===================================================

  /**
   * EB01-003 基德&基拉 (Kid & Killer)
   * CONSTANT: [速攻] (原生关键词)
   * ON_ATTACK: 对手生命<=2时，本回合+2000
   */
  'EB01-003': {
    triggerType: 'ON_ATTACK',
    conditions: [
      { type: 'CHECK_OPPONENT_LIFE', operator: '<=', amount: 2 },
    ],
    actions: [
      {
        type: 'MODIFY_POWER',
        target: 'SELF',
        amount: 2000,
      },
      {
        type: 'LOG',
        message: '基德&基拉: 对手生命<=2，力量+2000!',
      },
    ],
  },

  /**
   * EB01-006 托尼托尼·乔巴 (Chopper)
   * CONSTANT: [阻挡者] (原生关键词)
   * ON_ATTACK: [Don!! x2] 对手1张角色力量-3000
   */
  'EB01-006': {
    triggerType: 'ON_ATTACK',
    conditions: [
      { type: 'CHECK_DON', amount: 2 },
    ],
    actions: [
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'opponent',
        targetTypes: ['character'],
        maxSelect: 1,
        message: '选择对手1张角色，力量-3000',
        onSelect: [
          {
            type: 'MODIFY_POWER',
            target: 'SELECTED',
            amount: -3000,
          },
        ],
      },
    ],
  },

  /**
   * P-006 蒙奇·D·路飞 (Monkey D. Luffy)
   * CONSTANT: [Don!! x2] [我方回合] +2000
   */
  'P-006': {
    triggerType: 'CONSTANT',
    conditions: [],
    dynamicPower: {
      amount: 2000,
      conditions: [
        { type: 'CHECK_DON', amount: 2 },
        { type: 'IS_MY_TURN' },
      ],
    },
  },

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
   * TRIGGER: 我方最多1张领袖或角色+1000
   * 费用: 1 DON
   */
  'OP01-029': [
    {
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
    {
      triggerType: 'TRIGGER',
      conditions: [],
      actions: [
        {
          type: 'PENDING_SELECT_TARGET',
          targetScope: 'player',
          targetTypes: ['leader', 'character'],
          maxSelect: 1,
          message: '选择己方1张领袖或角色，本回合力量+1000',
          onSelect: [
            {
              type: 'MODIFY_POWER',
              target: 'SELECTED',
              amount: 1000,
              expiry: 'END_OF_TURN',
            },
          ],
        },
        {
          type: 'LOG',
          message: '离子光波: 触发效果发动，力量+1000!',
        },
      ],
    },
  ],

  // ===================================================
  // 🟢 动物/乔巴 (Animal / Chopper) - 续
  // ===================================================

  /**
   * OP04-010 托尼托尼·乔巴 (Chopper)
   * ON_PLAY: 将手牌中最多1张力量<=3000且有《动物》特征的角色登场
   */
  'OP04-010': {
    triggerType: 'ON_PLAY',
    conditions: [],
    actions: [
      {
        type: 'PENDING_PLAY_FROM_HAND',
        maxSelect: 1,
        optional: true,
        filter: {
          cardType: 'CHARACTER',
          maxPower: 3000,
          trait: '动物',
        },
        message: '选择手牌中1张力量<=3000的《动物》角色登场',
      },
    ],
  },

  /**
   * OP04-016 反礼仪踢技套餐 (Event)
   * COUNTER: 丢弃1张手牌，己方1张领袖或角色+3000
   * TRIGGER: 对方最多1张领袖或角色-3000
   */
  'OP04-016': [
    {
      triggerType: 'COUNTER',
      cost: 1,
      conditions: [],
      actions: [
        {
          type: 'PENDING_DISCARD',
          count: 1,
          optional: true,
          message: '丢弃1张手牌以发动效果',
          onDiscard: [
            {
              type: 'PENDING_SELECT_TARGET',
              targetScope: 'player',
              targetTypes: ['leader', 'character'],
              maxSelect: 1,
              message: '选择己方1张领袖或角色，力量+3000',
              onSelect: [
                {
                  type: 'MODIFY_POWER',
                  target: 'SELECTED',
                  amount: 3000,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      triggerType: 'TRIGGER',
      conditions: [],
      actions: [
        {
          type: 'PENDING_SELECT_TARGET',
          targetScope: 'opponent',
          targetTypes: ['leader', 'character'],
          maxSelect: 1,
          message: '选择对方1张领袖或角色，本回合力量-3000',
          onSelect: [
            {
              type: 'MODIFY_POWER',
              target: 'SELECTED',
              amount: -3000,
              expiry: 'END_OF_TURN',
            },
          ],
        },
        {
          type: 'LOG',
          message: '反礼仪踢技套餐: 触发效果发动，对方力量-3000!',
        },
      ],
    },
  ],

  /**
   * OP08-007 托尼托尼·乔巴 (Chopper)
   * ON_PLAY/ON_ATTACK [我方回合]: 看顶5张，登场1张力量<=4000的《动物》(休息状态)
   */
  'OP08-007': [
    {
      triggerType: 'ON_PLAY',
      conditions: [
        { type: 'IS_MY_TURN' },
      ],
      actions: [
        {
          type: 'PENDING_SEARCH_PLAY',
          viewCount: 5,
          maxSelect: 1,
          optional: true,
          filter: {
            cardType: 'CHARACTER',
            maxPower: 4000,
            trait: '动物',
          },
          playState: 'RESTED',
          message: '从顶部5张中选择1张力量<=4000的《动物》角色以休息状态登场',
        },
      ],
    },
    {
      triggerType: 'ON_ATTACK',
      conditions: [
        { type: 'IS_MY_TURN' },
      ],
      actions: [
        {
          type: 'PENDING_SEARCH_PLAY',
          viewCount: 5,
          maxSelect: 1,
          optional: true,
          filter: {
            cardType: 'CHARACTER',
            maxPower: 4000,
            trait: '动物',
          },
          playState: 'RESTED',
          message: '从顶部5张中选择1张力量<=4000的《动物》角色以休息状态登场',
        },
      ],
    },
  ],

  /**
   * OP08-010 郊游熊 (Outing Bear)
   * ACTIVATE_MAIN: [Don!!x1] [1回合1次] 其他《动物》角色+1000
   */
  'OP08-010': {
    triggerType: 'ACTIVATE_MAIN',
    cost: 0,
    conditions: [
      { type: 'CHECK_DON', amount: 1 },
      { type: 'CHECK_ONCE_PER_TURN', key: 'OP08-010' },
    ],
    actions: [
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'player',
        targetTypes: ['character'],
        filter: {
          trait: '动物',
          excludeInstanceId: 'SELF',  // 排除自己
        },
        maxSelect: 1,
        message: '选择己方1张其他《动物》角色，力量+1000',
        onSelect: [
          {
            type: 'MODIFY_POWER',
            target: 'SELECTED',
            amount: 1000,
          },
        ],
      },
      {
        type: 'SET_ONCE_PER_TURN',
        key: 'OP08-010',
      },
    ],
  },

  /**
   * OP08-013 罗布松 (Robson)
   * CONSTANT: [Don!! x2] 获得[速攻]
   */
  'OP08-013': {
    triggerType: 'CONSTANT',
    conditions: [],
    dynamicKeywords: [
      {
        keyword: 'Rush',
        conditions: [
          { type: 'CHECK_DON', amount: 2 },
        ],
      },
    ],
  },

  /**
   * OP08-015 Dr.古蕾娃 (Dr. Kureha)
   * ON_PLAY: 看顶4张，选择1张非"Dr.古蕾娃"的《铁桶王国》或"托尼托尼·乔巴"加入手牌
   */
  'OP08-015': {
    triggerType: 'ON_PLAY',
    conditions: [],
    actions: [
      {
        type: 'PENDING_SEARCH',
        count: 4,
        maxSelect: 1,
        optional: true,
        filter: {
          or: [
            { trait: '铁桶王国' },
            { nameCn: '托尼托尼·乔巴' },
          ],
          excludeCardNumber: 'OP08-015',
        },
        message: '从顶部4张中选择1张《铁桶王国》卡牌或"托尼托尼·乔巴"',
      },
    ],
  },

  /**
   * EB01-009 少啰唆！！！跟我走吧！！！ (Event)
   * COUNTER: 看顶5张，登场1张费用<=3的《动物》(休息状态)
   */
  'EB01-009': {
    triggerType: 'COUNTER',
    cost: 1,
    conditions: [],
    actions: [
      {
        type: 'PENDING_SEARCH_PLAY',
        viewCount: 5,
        maxSelect: 1,
        optional: true,
        filter: {
          cardType: 'CHARACTER',
          maxCost: 3,
          trait: '动物',
        },
        playState: 'RESTED',
        message: '从顶部5张中选择1张费用<=3的《动物》角色以休息状态登场',
      },
    ],
  },

  /**
   * ST21-003 山智 (Sanji)
   * ON_PLAY: 选择己方1张力量>=6000的《草帽一伙》角色，本回合攻击时对手不能发动阻挡者
   */
  'ST21-003': {
    triggerType: 'ON_PLAY',
    conditions: [],
    actions: [
      {
        type: 'PENDING_SELECT_TARGET',
        targetScope: 'player',
        targetTypes: ['character'],
        filter: {
          minPower: 6000,
          trait: '草帽一伙',
        },
        maxSelect: 1,
        optional: true,
        message: '选择己方1张力量>=6000的《草帽一伙》角色，本回合攻击时对手无法阻挡',
        onSelect: [
          {
            type: 'ADD_FIELD_STATE',
            target: 'SELECTED',
            state: 'cannotBeBlocked',
            value: true,
            expiry: 'END_OF_TURN',
          },
          {
            type: 'LOG',
            message: '山智: 目标本回合攻击时对手不能发动阻挡者!',
          },
        ],
      },
    ],
  },
}
