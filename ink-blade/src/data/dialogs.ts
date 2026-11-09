export interface DialogLine {
  speaker: string;
  text: string;
  portrait?: 'merchant' | 'boss';
}

export interface NpcDialog {
  lines: DialogLine[];
  action: 'story' | 'merchant' | 'forge' | 'guard';
}

export function getNpcDialog(id: string, flags: Set<string>): NpcDialog {
  if (id === 'storyteller') {
    if (!flags.has('story')) {
      return {
        action: 'story',
        lines: [
          { speaker: '说书人·柳三弦', text: '客官这把刀……杀气太重。坐，听我讲段旧事。' },
          { speaker: '说书人·柳三弦', text: '三日前，断崖古寺的方向下了一场红雨。那夜之后，烬门便只剩你一人。' },
          { speaker: '说书人·柳三弦', text: '凶手自称「无面」。他要的不是命，是你师父护着的那盏灯。' },
          { speaker: '说书人·柳三弦', text: '去荒寺吧。佛钥在守钥僧手中，断崖的门只认那枚钥匙。' },
          { speaker: '说书人·柳三弦', text: '出镇往东，是枯木林。林中影狼被煞气养得凶，先清出条路来。' },
        ],
      };
    }
    if (!flags.has('key')) {
      return {
        action: 'story',
        lines: [
          { speaker: '说书人·柳三弦', text: '枯木林的狼嚎昨夜又密了些。它们闻得见你身上的恨。' },
          { speaker: '说书人·柳三弦', text: '斩够六头，剩下的自会退。狼这东西，最识得强弱。' },
        ],
      };
    }
    if (!flags.has('boss_dead')) {
      return {
        action: 'story',
        lines: [
          { speaker: '说书人·柳三弦', text: '佛钥到手了？崖上风大，别让刀冻住。' },
          { speaker: '说书人·柳三弦', text: '无面没有脸。记住这句话——见着他时，用得上。' },
        ],
      };
    }
    return {
      action: 'story',
      lines: [
        { speaker: '说书人·柳三弦', text: '红雨停了。你听，镇外的风都轻了。' },
        { speaker: '说书人·柳三弦', text: '可你回来后，一句话也没说。……罢了，酒还温着。' },
      ],
    };
  }

  if (id === 'merchant') {
    if (!flags.has('supplies')) {
      return {
        action: 'merchant',
        lines: [
          { speaker: '药铺掌柜·葛九', text: '哟，烬门的刀客。脸色比纸还白，坐下让我瞧瞧。' },
          { speaker: '药铺掌柜·葛九', text: '这三枚回春丹拿去，算老夫给故人上的一炷香。' },
          { speaker: '药铺掌柜·葛九', text: '要买要炼，只管开口。青灵草、血砂，林子和古寺里都有。' },
          { speaker: '药铺掌柜·葛九', text: '记住：丹能回春，回不了命。别把命全押在药上。' },
        ],
      };
    }
    if (!flags.has('key')) {
      return {
        action: 'merchant',
        lines: [{ speaker: '药铺掌柜·葛九', text: '又来了？血砂带够没有？炼丹讲究火候，也讲究舍得。' }],
      };
    }
    return {
      action: 'merchant',
      lines: [{ speaker: '药铺掌柜·葛九', text: '佛钥都拿到了，还来买药？……好，好。多带两枚回春丹吧。' }],
    };
  }

  if (id === 'blacksmith') {
    if (!flags.has('forge')) {
      return {
        action: 'forge',
        lines: [
          { speaker: '铁匠·陈铁山', text: '你师父的刀……我打的。刀还在，人没了。' },
          { speaker: '铁匠·陈铁山', text: '这几块兽骨拿去。配血砂能炼金刚散，挨打时比什么都实在。' },
          { speaker: '铁匠·陈铁山', text: '别急着送死。刀要养，人也要养。' },
        ],
      };
    }
    return {
      action: 'forge',
      lines: [
        { speaker: '铁匠·陈铁山', text: '刀口卷了？拿来。……算了，你师父的刀，我修不好，只能你自己养。' },
        { speaker: '铁匠·陈铁山', text: '兽骨配血砂，金刚散。记住了。' },
      ],
    };
  }

  return {
    action: 'guard',
    lines: [
      { speaker: '守门人·老秦', text: '东门外就是枯木林。这几日狼嚎整夜不停，镇里没人敢走。' },
      { speaker: '守门人·老秦', text: '真要过林，先斩够六头影狼。剩下的才不敢跟着你。' },
      { speaker: '守门人·老秦', text: '过了林是荒寺。寺里有灯，也有不干净的东西。' },
    ],
  };
}

export const BOSS_INTRO: DialogLine[] = [
  { speaker: '无面', portrait: 'boss', text: '你终于来了。' },
  { speaker: '无面', portrait: 'boss', text: '你师父临死前，也是这么看着我的。' },
  { speaker: '无面', portrait: 'boss', text: '想知道面具下面是谁？——赢我。' },
];

export const ENDING_LINES: string[] = [
  '面具碎了。',
  '底下是一张与你一模一样的脸。',
  '他笑了，像你小时候照镜子。',
  '红雨停了。断崖上只剩一把刀，和一盏未熄的灯。',
];
