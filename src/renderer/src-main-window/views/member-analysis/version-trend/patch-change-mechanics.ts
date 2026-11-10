import type { PatchNotes } from '@shared/shards/member-analysis/patch-notes'

import { contextualPatchRules } from './patch-change-context-rules'

type Entry = PatchNotes['sections'][number]['entries'][number]
// Public Riot source semantics reviewed with the full surrounding context. Exact
// text, ability and category must match; omitted old values are never invented.
// Each patch resolves to league-of-legends-patch-26-XX-notes on the official site.
const mechanics = [
  ...contextualPatchRules,
  {
    ability: 'Q - Piercing Darkness',
    text: 'Cooldown Refund: On Hit ⇒ On Attack',
    change: 'nerf',
    patch: '16.13',
    category: 'champion'
  },
  {
    ability: 'W - Arise!',
    text: "On-Hit? More Like On-Destroy: Scorch, Liandry's Torment, Blackfire Torch, and Hextech Alternator now deal 100% of their damage on-hit instead of 50%",
    change: 'buff',
    patch: '16.14',
    category: 'champion'
  },
  {
    ability: 'W - Arise!',
    text: 'Double-tap: Conqueror will now apply 2 stacks on-hit instead of 1',
    change: 'buff',
    patch: '16.14',
    category: 'champion'
  },
  {
    ability: 'W - Arise!',
    text: 'Laser Focus: Press the Attack now applies to the primary target hit',
    change: 'buff',
    patch: '16.14',
    category: 'champion'
  },
  {
    ability: "R - Emperor's Divide",
    text: 'Be Gone, Peasant!: Now knocks back jungle monsters',
    change: 'buff',
    patch: '16.14',
    category: 'champion'
  },
  {
    ability: 'R - Endless Banquet',
    text: 'Passive On-Hit Application: Every other attack ⇒ Every attack',
    change: 'buff',
    patch: '16.15',
    category: 'champion'
  },
  {
    ability: 'R - Endless Banquet',
    text: 'Target Swapping: Passive removed when swapping targets ⇒ Passive no longer removed when swapping targets',
    change: 'buff',
    patch: '16.15',
    category: 'champion'
  },
  {
    ability: 'R - Endless Banquet',
    text: 'Passive Application Requirement: E and Q required Bel’Veth to have attacked the target first ⇒ E and Q no longer require Bel’Veth to have attacked the target first',
    change: 'buff',
    patch: '16.15',
    category: 'champion'
  },
  {
    ability: 'R - Endless Banquet',
    text: 'Out of Combat Move Speed: Removed',
    change: 'nerf',
    patch: '16.15',
    category: 'champion'
  },
  {
    category: 'champion',
    ability: 'Q - Alpha Strike',
    text: 'Cooldown Refund on Hit: -1 second, scaling down with Ability Haste ⇒ 1 second',
    change: 'buff',
    patch: '16.19',
    reason:
      '官方明确说移除Q返还机制因AH施加的惩罚。相同每次攻击返还1秒，现在不再因技能急速下降；AH=0不变，其余非负AH情形更好。已有定向正确，本轮额外核验。'
  },
  {
    ability: 'Q - Starlight’s Touch',
    text: 'Cast Behavior: Q casts when allies are untargetable will now successfully fire.',
    change: 'buff',
    patch: '16.21',
    category: 'champion'
  },
  {
    ability: 'E - Dazzle',
    text: 'Cast Behavior: E casts when allies are untargetable will now successfully fire.',
    change: 'buff',
    patch: '16.21',
    category: 'champion'
  },
  {
    ability: 'R - Cosmic Radiance',
    text: 'Cast Behavior: R casts when allies are untargetable will now successfully fire.',
    change: 'buff',
    patch: '16.21',
    category: 'champion'
  },
  {
    ability: 'R - Destiny',
    text: 'Reveal: Now reveals untargetable units.',
    change: 'buff',
    patch: '16.21',
    category: 'champion'
  },
  {
    category: 'champion',
    ability: 'Passive - Blaze',
    text: 'Detonation Damage: 8 - 12% (Levels 1 - 17) (+2% per 100 AP) ⇒ 6 - 12% (Levels 1 - 18, scaling above 18) (+2% per 100 AP)',
    change: 'adjusted',
    patch: '16.13',
    reason:
      '纠正已定向项：低等级被动基础伤害下降，但新范围明确scaling above18。26.1 Top Quest官方奖励把上路等级上限提高至20，不能假设SR全员封顶18来证明纯nerf。到19/20的新曲线可超过旧12%终值；至少输入域发生变化，必须保留混合/调整，或单独明确标注早期削弱而非整条削弱。'
  },
  {
    ability: 'Passive - Absolution',
    text: 'Crit Damage: -10% (180% / 27% with IE) ⇒ -15% (170% / 25.5% with IE)',
    change: 'nerf',
    patch: '16.13',
    category: 'champion'
  },
  {
    category: 'champion',
    ability: 'R - Command: Shockwave',
    text: 'Damage: 250/400/550 (+95% AP) ⇒ 225/350/475 (+110% AP)',
    change: 'adjusted',
    patch: '16.12',
    reason:
      '真实混合：基础伤害各级分别下降25/50/75，AP系数提高15个百分点。按当前AP不同可由弱转强；R三档交叉AP为约166.67/333.33/500。官方强调从早期压制向后期团战转移，不能把整条无条件判削弱或加强。'
  },
  {
    category: 'system',
    ability: null,
    text: 'Max Health Shield: 30% for 30 seconds ⇒ 35% for 10 seconds',
    change: 'adjusted',
    patch: '16.12',
    reason: '护盾比例30%→35%提高，但持续时间30秒→10秒缩短；收益窗口交叉，不合并成单向加强。'
  },
  {
    category: 'system',
    ability: 'Passive - Silver Stake',
    text: "Locke's attacks deal additional magic damage On-Hit, increased based on enemy missing Health.",
    change: 'unknown',
    patch: '16.13',
    reason:
      '新英雄被动机制介绍，没有旧状态/前后改动，不据伤害一词判加强；分类应是新英雄介绍而非系统。'
  },
  {
    category: 'system',
    ability: 'Q - Ritual Nails',
    text: 'Locke readies a set of Soul Nails to throw, dealing damage to and marking enemies hit. Locke can consume the marks to deal bonus damage with his attacks.',
    change: 'unknown',
    patch: '16.13',
    reason: '新英雄Q机制介绍，无对照旧状态；分类不是系统平衡。'
  },
  {
    category: 'system',
    ability: 'W - Soul Ignition',
    text: 'Locke ignites his soul, gaining Attack Speed and Move Speed, and dealing damage to himself. At the end of the duration, Locke will heal back a portion of the damage he takes during the effect.',
    change: 'unknown',
    patch: '16.13',
    reason: '新英雄W机制介绍同时含自伤和回血，无前后对照；不能猜方向。'
  },
  {
    category: 'system',
    ability: 'E - Ashen Pursuit',
    text: 'Locke teleports to a location before dashing to attack his next target, dealing damage to enemies passed through.',
    change: 'unknown',
    patch: '16.13',
    reason: '新英雄E机制介绍，无前后对照；分类不是系统平衡。'
  },
  {
    category: 'system',
    ability: 'R - Purgatory',
    text: 'Locke throws a binding artifact that deals damage and potentially executes enemies hit. Locke gains additional power for sealing away enemy champions.',
    change: 'unknown',
    patch: '16.13',
    reason: '新英雄R机制介绍，无前后对照；分类不是系统平衡。'
  },
  {
    category: 'system',
    ability: 'R - Purgatory',
    text: 'Locke Champion Spotlight here!',
    change: 'unknown',
    patch: '16.13',
    reason: '英雄聚光灯外链，不是平衡改动，应过滤而不是定向。'
  },
  {
    category: 'champion',
    ability: 'Q - Flamespitter',
    text: 'Damage: 60 / 85 / 110 / 135 / 160 (100% AP) ⇒ 50 / 75 / 100 / 125 / 150 (105% AP)',
    change: 'adjusted',
    patch: '16.13',
    reason:
      '真实混合：各级基础伤害降低10，AP系数100%→105%；AP<200削弱、AP=200相同、AP>200加强。上下文的early/base nerf不意味着所有情境纯削弱。'
  },
  {
    category: 'item',
    ability: null,
    text: 'Build Path: Blasting Wand (850g) + Bandleglass Mirror (900g) + 650g ⇒ Amp Tome (400g) + Bandleglass Mirror (900g) + Amp Tome (400g) + 700g',
    change: 'adjusted',
    patch: '16.13',
    reason:
      '配方总价均2400g；小件门槛由850g的大棒改成400g的增幅典籍更平滑，但合成费650g→700g，且物品属性另条调整。官方smoothing the path是构建体验利好，不足证明本条在所有购买时点单向加强。'
  },
  {
    category: 'item',
    ability: null,
    text: 'Build Path: Hextech Alternator + Fiendish Codex + Amplifying Tome + 300 ⇒ Hextech Alternator + Kindlegem + Ruby Crystal + 350',
    change: 'adjusted',
    patch: '16.14',
    reason:
      '配方组件从法强/急速向生命值转移且合成费改变；不是一个方向的总成本/强度变化。官方说明是调整immobile mages与AP bruisers间的属性激励。'
  },
  {
    category: 'champion',
    ability: 'Base Stats',
    text: 'Total Attack Animation: Adjusted to feel better at lower Attack Speeds',
    change: 'adjusted',
    patch: '16.15',
    reason:
      '原文只说低攻速手感更好，未给攻击取消/前后摇等实际机制或数值；不足以把纯动画说明等同硬强度增益。'
  },
  {
    category: 'champion',
    ability: 'Base Stats',
    text: 'Model Size: 100% ⇒ 95%',
    change: 'adjusted',
    patch: '16.15',
    reason:
      '原文明确是model size，不证明碰撞/受击半径缩小。保留显示/模型调整，不能擅自按hitbox判加强。'
  },
  {
    category: 'champion',
    ability: 'Passive - Death In Lavender',
    text: 'Attack Speed After Spell Cast: 20% minimum / 40% maximum for 2 attacks ⇒ 20% for 3 seconds',
    change: 'adjusted',
    patch: '16.15',
    reason:
      '原20%–40%且作用两次攻击改为固定20%持续3秒；攻速幅度与持续方式交换，依攻速/施法频率而异。'
  },
  {
    category: 'champion',
    ability: 'Passive - Death In Lavender',
    text: 'Attack Speed per Stack: 0.28% minimum / 1.1% maximum ⇒ 0.1% minimum / 2% maximum',
    change: 'adjusted',
    patch: '16.15',
    reason: '最低0.28%→0.1%下降，最高1.1%→2%上升，成长前后期交叉。'
  },
  {
    category: 'champion',
    ability: 'Q - Void Surge',
    text: 'Speed: 800 / 850 / 900 / 950 / 1000 ⇒ 850',
    change: 'adjusted',
    patch: '16.15',
    reason: 'Q速度800–1000改850：低等级提高、高等级降低。'
  },
  {
    category: 'champion',
    ability: 'Q - Void Surge',
    text: 'Monster Damage Modifier: 55 / 65 / 75 / 85 / 95 ⇒ 70',
    change: 'adjusted',
    patch: '16.15',
    reason: 'Q野怪修正55/65/75/85/95改70：低等级提高、高等级降低。'
  },
  {
    category: 'champion',
    ability: 'W - Above And Below',
    text: 'Damage: 70 / 110 / 150 / 190 / 230 (+100% Bonus Attack Damage) (+125% Ability Power) ⇒ 80 / 140 / 200 / 260 / 320 (+150% Ability Power)',
    change: 'adjusted',
    patch: '16.15',
    reason: 'W基础/AP提高，但移除100%额外AD加成；不同出装/数值存在交叉。'
  },
  {
    category: 'champion',
    ability: 'W - Above And Below',
    text: 'Slow Duration: 1.25 / 1.5 / 1.75 / 2 / 2.25 seconds at 50% slow ⇒ 2 seconds at 30% slow',
    change: 'adjusted',
    patch: '16.15',
    reason: 'W慢速强度50%降30%，部分等级时长提高另部分降低；不能仅按时长或慢速数值单向判断。'
  },
  {
    category: 'champion',
    ability: 'W - Above And Below',
    text: 'Knockup Duration: 0.75 seconds ⇒ 0.6 / 0.7 / 0.8 / 0.9 / 1 second',
    change: 'adjusted',
    patch: '16.15',
    reason: '0.75秒改0.6/0.7/0.8/0.9/1秒：前两级削弱、后三等级加强。'
  },
  {
    category: 'champion',
    ability: 'E - Royal Maelstrom',
    text: 'Damage per Strike: 6 / 7 / 8 / 9 / 10 (+8% Attack Damage) (+8% On-Hit effects), increased up to 300% based on missing Health ⇒ 10 / 12 / 14 / 16 / 18 (+12% Attack Damage) (+12% On-Hit effects), increased up to 100% based on missing Health',
    change: 'adjusted',
    patch: '16.15',
    reason: '基础、AD及on-hit系数提高，但目标已损生命增幅300%降100%；不同目标血线和出装交叉。'
  },
  {
    category: 'champion',
    ability: 'E - Royal Maelstrom',
    text: 'Damage Reduction: 35 / 40 / 45 / 50 / 55% ⇒ 20 / 30 / 40 / 50 / 60%',
    change: 'adjusted',
    patch: '16.15',
    reason: '35/40/45/50/55%→20/30/40/50/60%：早级削弱、满级加强。'
  },
  {
    category: 'champion',
    ability: 'E - Royal Maelstrom',
    text: 'Lifesteal Scaling: 100% ⇒ Removed',
    change: 'nerf',
    patch: '16.15',
    reason:
      '取消E对既有吸血的100%继承系数，失去该额外治疗收益；另一独立Lifesteal条目提高不能抹掉本项削弱。'
  },
  {
    category: 'champion',
    ability: 'E - Royal Maelstrom',
    text: 'Cooldown: 20 / 19 / 18 / 17 / 16 ⇒ 24 / 21 / 18 / 15 / 12',
    change: 'adjusted',
    patch: '16.15',
    reason: '20/19/18/17/16→24/21/18/15/12：前级变长、后级变短。'
  },
  {
    category: 'champion',
    ability: 'R - Endless Banquet',
    text: 'Explosion Damage: 150 / 200 / 250 (+100% Ability Power) (+25% missing Health) ⇒ 150 / 200 / 250 (+150% Ability Power) (+20% missing Health)',
    change: 'adjusted',
    patch: '16.15',
    reason: 'AP系数100%→150%提高，但已损生命系数25%→20%降低，随出装/目标血量交叉。'
  },
  {
    category: 'champion',
    ability: 'R - Endless Banquet',
    text: 'Basic Attack Range Bonus: 75 ⇒ 25 / 75 / 125',
    change: 'adjusted',
    patch: '16.15',
    reason: '75改25/75/125：R1削弱、R2不变、R3加强。'
  },
  {
    category: 'champion',
    ability: 'R - Endless Banquet',
    text: 'Total Attack Speed: 10 / 15 / 20% ⇒ 5 / 15 / 25%',
    change: 'adjusted',
    patch: '16.15',
    reason: '10/15/20%改5/15/25%：R1削弱、R2不变、R3加强。'
  },
  {
    category: 'champion',
    ability: 'R - Endless Banquet',
    text: 'Size: 10% ⇒ 10 / 15 / 20%',
    change: 'adjusted',
    patch: '16.15',
    reason: '体型10%改10/15/20%；没有说明碰撞或受击范围及实际增益，不能把更大视觉体型直接标加强。'
  },
  {
    category: 'champion',
    ability: 'R - Endless Banquet',
    text: 'Unempowered Buff Duration: 60 ⇒ 45 / 90 / infinite at 0 / 40 / 80 stacks',
    change: 'adjusted',
    patch: '16.15',
    reason: '60秒改0/40/80层对应45/90/无限：低层变短、高层变长。'
  },
  {
    category: 'champion',
    ability: 'R - Endless Banquet',
    text: 'Empowered Buff Duration: 180 ⇒ 45 / 90 / infinite at 0 / 40 / 80 stacks',
    change: 'adjusted',
    patch: '16.15',
    reason: '180秒改0/40/80层对应45/90/无限：低中层变短、80层以上变长。'
  },
  {
    category: 'champion',
    ability: 'R - Realm of Death',
    text: 'Bugfix: Fixed a bug where ulting a target with health above their post-reduction max HP would lead to increased damage (up to double).',
    change: 'nerf',
    patch: '16.15',
    reason:
      '修复超出被偷属性后最大生命的目标导致额外伤害（最高翻倍）的bug，即取消非预期额外伤害。官方段落将E两项加强作为含R bugfix后的补偿，不可一律因Bugfix中性化。'
  },
  {
    category: 'champion',
    ability: 'R - The Call of the Pack',
    text: 'Damage: 150 / 225 / 300 (+120% Attack Damage) ⇒ 125 / 200 / 275 (+100% Bonus Attack Damage)',
    change: 'nerf',
    patch: '16.15',
    reason:
      '总AD=基础AD+额外AD且二者非负。基础伤害下降、原总AD系数下降并改成仅额外AD，故任意非负基础/额外AD下伤害都下降；不是无法比较的基底改动。'
  },
  {
    category: 'champion',
    ability: 'R - The Call of the Pack',
    text: 'Damage per Packmate: 15 / 22.5 / 30 (+12% Attack Damage) ⇒ 12.5 / 20 / 27.5 (+10% Bonus Attack Damage)',
    change: 'nerf',
    patch: '16.15',
    reason:
      '总AD=基础AD+额外AD且二者非负。基础伤害下降、原总AD系数下降并改成仅额外AD，故任意非负基础/额外AD下伤害都下降；不是无法比较的基底改动。'
  },
  {
    category: 'champion',
    ability: 'R - Endless Banquet',
    text: 'True Form Total Attack Speed: 5 / 15 / 25% ⇒ 6 / 13 / 20%',
    change: 'adjusted',
    patch: '16.16',
    reason:
      'R等级1由5%提高至6%，而等级2/3由15%/25%下降至13%/20%；确为不同等级方向交叉，不能以官方整体削弱意图覆盖这一行。'
  },
  {
    category: 'champion',
    ability: 'R - Endless Banquet',
    text: 'NEW True Form Remora Indicator: Resource bar now turns purple when True Form can spawn Remora',
    change: 'adjusted',
    patch: '16.16',
    reason:
      '新增紫色资源条提示当前真身可生成虚空鱼；这是信息显示/QoL，不改变真身、鱼的生成条件、数量或数值。中性/调整比无条件声称游戏强度加强更准确。'
  },
  {
    category: 'champion',
    ability: 'Passive - Adaptive Defenses',
    text: 'Shield: 20% Maximum Health ⇒ 10 / 15 / 20 / 25% Maximum Health (levels 1 / 7 / 13 / 19)',
    change: 'adjusted',
    patch: '16.16',
    reason:
      '低等级20%护盾降至10%/15%，13级相同20%，19级提高至25%。SR上路任务可以到20级，因此高等级加强是真实可达，不能按18级封顶把整行标削弱。'
  },
  {
    category: 'champion',
    ability: 'Passive - Adaptive Defenses',
    text: 'Cooldown: 18 / 14 / 10 / 6s (levels 1 / 7 / 13 / 19) ⇒ 14 / 11 / 8s (levels 1 / 7 / 13)',
    change: 'adjusted',
    patch: '16.16',
    reason:
      '1/7/13级冷却18/14/10秒降为14/11/8秒，但19级旧值6秒、新值保持8秒，最高等级方向反转。段落整体强调更频繁换血，不足以消除明确的19级冷却削弱。'
  },
  {
    category: 'champion',
    ability: 'Q - Siphoning Strike',
    text: 'Stacks: 3, increased to 12 on champions / large minions / monsters ⇒ 4, increased to 10 on champions / large minions / monsters',
    change: 'adjusted',
    patch: '16.16',
    reason: '普通击杀叠层3→4加强，英雄/大型小兵/野怪12→10削弱；不同目标收益交叉，属于调整。'
  },
  {
    category: 'champion',
    ability: 'Q - Hammer Shock',
    text: 'Slow Amount: 20 / 25 / 30 / 35 / 40% ⇒ 20 / 23 / 26 / 29 / 32% (+8% per 1000 bonus Health)',
    change: 'adjusted',
    patch: '16.16',
    reason:
      '基础慢速多数技能等级下降，但新增每1000额外生命+8%的慢速加成。低额外生命更弱，高额外生命可反超；符合从AD战士向坦克转移的官方说明，不是统一削弱。'
  },
  {
    category: 'item',
    ability: null,
    text: "Recipe: Tunneler (1150g) + Caulfield's (1050g) + Ruby Crystal (400g) + 500g ⇒ Tunneler (1150g) + Caulfield's (1050g) + 900g",
    change: 'adjusted',
    patch: '16.16',
    reason:
      '总价两侧均3100金币；移除400金币红水晶，将合成费500→900，改变中间构件属性与占槽/购买路径。成装治疗削弱和生命值加强另列，不以整件装备被削弱为理由把本行纯配方重组强判方向。'
  },
  {
    category: 'champion',
    ability: 'Base Stats',
    text: 'Health: 550 + 103/Level ⇒ 580 + 98/Level',
    change: 'adjusted',
    patch: '16.17',
    reason:
      '基础生命550→580提高，成长103→98下降，1级更耐打而后期更低；前后存在SR可达等级内的交叉。不能只按官方约束上单的整体意图标本行为削弱。'
  },
  {
    category: 'champion',
    ability: 'Base Stats',
    text: 'Health Regeneration: 3.5 + .55/Level ⇒ 4 + .5/Level',
    change: 'adjusted',
    patch: '16.17',
    reason: '基础回复3.5→4提高，成长0.55→0.5下降；前后在SR可达等级内交叉，保留调整。'
  },
  {
    category: 'champion',
    ability: 'Base Stats',
    text: 'Attack Speed Ratio: .658 + 3.3%/Level ⇒ .67 + 2.8%/Level',
    change: 'adjusted',
    patch: '16.17',
    reason:
      '基础攻速收益0.658→0.67提高，而每级成长3.3%→2.8%降低；无论按原文简写的加法还是实际攻速增长解释，早晚均有方向交叉，不是统一削弱。'
  },
  {
    category: 'champion',
    ability: 'E - Twin Fang',
    text: 'Total Ability Power Ratio: 65% ⇒ 65%',
    change: 'unchanged',
    patch: '16.18',
    reason: '两端同为65%，同一E总AP系数完全未变；只是拆分基础/强化E系数后的总和说明，不是强度调整。'
  },
  {
    category: 'champion',
    ability: "Passive - Sovereign's Domination",
    text: "Heal: 2% (+…. ) ⇒ 2% (+ 2.5% per 100 bonus AD) (+ 2% per 100 AP) (+ 5% per 100% bonus attack speed) (+ 2% per 500 bonus HP) of the target's maximum health",
    change: 'buff',
    patch: '16.18',
    reason:
      '旧公式被原文省略为(+….)，不能补造旧数值。但本次明确增加额外生命值的治疗加成(+2% per 500 bonus HP)，并且英雄上下文明确要增强整体/战士流派；这是语义加强，不能因数字不完整而归真实调整。用户亦明确指出此方向。'
  },
  {
    category: 'champion',
    ability: 'Q - The Darkin Glaive',
    text: 'NEW Cooldown Behavior: If Q is active, it is now placed on Cooldown immediately upon being put in Resurrection',
    change: 'buff',
    patch: '16.18',
    reason:
      '复活开始即使Q开始转冷却，避免复活完成时Q仍在冷却。官方上下文特意说明表面看似削弱但实际总是更有利，所以这是机制加强，不能因没有箭头而跳过。'
  },
  {
    category: 'champion',
    ability: 'W - Ultrashock Laser',
    text: 'Critical Strike: 150% (+15% IE)',
    change: 'unknown',
    patch: '16.18',
    reason:
      '原文只有150%(+15% IE)，没有旧值、箭头或NEW标识。整个英雄段落是削弱但不能将整段方向机械套到这条可能只是说明的系数行。该行需要标未判定/说明，不能当作已确认的真实调整，也不能补造旧暴击倍率。'
  },
  {
    category: 'champion',
    ability: 'Base Stats',
    text: 'Attack Damage: 63 + 3.5/Level ⇒ 61 + 3.9/Level',
    change: 'adjusted',
    patch: '16.19',
    reason:
      '基础攻击力-2、每级成长+0.4，早期降低、较后等级提高；无论按level或level-1公式均会在SR有效等级内交叉。官方着重说early clear nerf也不改变晚期上升，真实混合应保留调整。'
  },
  {
    category: 'champion',
    ability: 'Base Stats',
    text: 'Health per 5: 4 + .5/Level ⇒ 5.5 +.4/Level',
    change: 'adjusted',
    patch: '16.20',
    reason:
      '新旧差为+1.5基础、-0.1每级成长；前期更高，等级成长充分后更低。上路任务可至20级，不能只看基础或只看成长；属于真实时段取舍。'
  },
  {
    category: 'champion',
    ability: 'E - Tempest',
    text: 'Bugfix: No longer reveals invisible enemies if they stealth after being hit by Tempest.',
    change: 'nerf',
    patch: '16.21',
    reason:
      '原本命中Tempest后敌人再隐身仍会被揭示；现在不再揭示，侦测能力单向下降。Bugfix这个来源标签不等于没有强弱影响。'
  },
  {
    category: 'champion',
    ability: 'Q - Ritual Nails',
    text: 'Unused Charge Refund: 20 - 35% mana and cooldown refund ⇒ 10 - 40% mana and cooldown refund',
    change: 'adjusted',
    patch: '16.21',
    reason: '低端20%降至10%，高端35%升至40%；同一refund既有降低也有提高。'
  },
  {
    category: 'champion',
    ability: 'W - Soul Ignition',
    text: 'Current Health Store: 150 - 450 (both level based) ⇒ 100 - 500 (+60% AP)',
    change: 'adjusted',
    patch: '16.21',
    reason: '早期150降至100，后期450升至500且添加AP加成；不同等级/AP输入下方向不同。'
  },
  {
    category: 'champion',
    ability: 'Q - Overload',
    text: 'Flux Bonus Damage: 15% / 40% / 65% / 90% increased damage ⇒ 10% / 40% / 70% / 100% increased damage',
    change: 'adjusted',
    patch: '16.21',
    reason: '第一档15%降至10%，第三档65%升至70%，第四档90%升至100%；保留早晚取舍。'
  },
  {
    category: 'champion',
    ability: 'R - Unstoppable Onslaught',
    text: 'Bugfix: Tooltip now displays the correct minimum and maximum bonus AD ratios (40-120%). It displayed an incorrect Bonus AD Scaling (60%-120%). It was never actually changed in patch 25.16 beyond the tooltip.',
    change: 'unchanged',
    patch: '16.21',
    reason:
      '官方明确真实比率一直为40–120%，25.16也只有tooltip错误；现在只纠正文字，没有能力数值变化。'
  },
  {
    category: 'champion',
    ability: 'E - Unraveled Earth',
    text: 'Monster Damage: Deals 225% damage to monsters.',
    change: 'unchanged',
    patch: '16.21',
    reason:
      '225%野怪倍率已在26.2由190%提高至225%，随后26.5/26.9改动仅为Q；本条没有另一次倍率变化证据，是对本次E伤害加成适用于野怪的说明。'
  },
  {
    category: 'champion',
    ability: 'E - Dazzle',
    text: 'Tooltip: Updated to include “Dazzle will not cast from Vanished allies”.',
    change: 'unchanged',
    patch: '16.21',
    reason:
      '公告明确保留既有Vanished队友不施放Dazzle例外；本条只是把现存例外写入tooltip，不是新增限制。'
  },
  {
    category: 'champion',
    ability: 'Q - Piercing Arrow',
    text: 'Damage Calculation: Max Damage scaling, 53.33 - 240 (+80% bonus AD) to 80 - 360 (+120% bonus AD) ⇒ Min Damage scaling, 50 - 230 (+80% bonus AD) to 85 - 391 (+136% bonus AD)',
    change: 'adjusted',
    patch: '16.21',
    reason:
      '最小Q基础53.33–240降至50–230，而最大Q基础80–360升至85–391，最大AD比率120%升至136%；不蓄力与满蓄力方向相反。'
  },
  {
    category: 'champion',
    ability: 'W - Blighted Quiver',
    text: 'On-Hit Damage: 4 / 13 / 22 / 31 / 40 (+15% bonus AD) (+25% AP) ⇒ 4 / 10 / 16 / 22 / 28 (+20% bonus AD) (+30% AP)',
    change: 'adjusted',
    patch: '16.21',
    reason: '较高档基础伤害下降，但额外AD/AP比率提高；低输入损失、高输入可能补回，真实混合。'
  },
  {
    category: 'champion',
    ability: 'W - Blighted Quiver',
    text: 'Per Stack Damage: 3 - 5% (+1.3% per 100 AP) Target Maximum Health ⇒ 2.5 - 4.5% (+1.4% per 100 AP) Target Maximum Health',
    change: 'adjusted',
    patch: '16.21',
    reason:
      '基础最大生命值伤害降低0.5个百分点，但每100AP系数提高0.1个百分点；AP超过约500后可反转，不能当纯削弱。'
  },
  {
    category: 'champion',
    ability: 'W - Blighted Quiver',
    text: 'Active Missing Health Damage: 6 - 14%, increased by up to 50% based on Q Channel ⇒ 6 - 10%, increased by up to 70% based on Q Channel',
    change: 'adjusted',
    patch: '16.21',
    reason:
      '低等级基础6%不变，满蓄力从9%提高至10.2%；高等级基础14%降至10%，满蓄力从21%降至17%；有明确跨等级反转。'
  },
  {
    category: 'item',
    ability: null,
    text: 'Sabotage Duration Context: This is how long you have to use the bonus damage against objectives.',
    change: 'unchanged',
    patch: '16.21',
    reason:
      '只解释使用强化目标伤害的有效期；90秒到无限的实际加强已在上一独立条目表达，本句本身不是额外改动。'
  },
  {
    category: 'item',
    ability: null,
    text: 'Base Bonus Attack Damage: 12 ⇒ 15 Melee / 10 Ranged',
    change: 'adjusted',
    patch: '16.21',
    reason: '基础12变为近战15/远程10；近战加强、远程削弱。'
  },
  {
    category: 'system',
    ability: 'Blue Buff',
    text: 'Ability Haste: 10 ⇒ 10 / 15 / 20 (levels 1 / 6 / 11)',
    change: 'buff',
    patch: '16.14',
    reason: '蓝buff技能急速原来各等级10，改为1/6/11级10/15/20；不变或提高，明确加强。'
  },
  {
    category: 'system',
    ability: null,
    text: 'Registration Begins: July 13 @ 11:00AM (Local Time)',
    change: 'adjusted',
    patch: '16.14',
    reason: '报名开放日程，不是平衡数值，应从平衡条目过滤。'
  },
  {
    category: 'system',
    ability: null,
    text: 'Tournament Dates: July 18 and 19 (~ 4 - 7 PM Local Time, varies by region)',
    change: 'adjusted',
    patch: '16.14',
    reason: '比赛日期日程，不是平衡数值，应从平衡条目过滤。'
  },
  {
    category: 'system',
    ability: null,
    text: 'We’re refocusing Aegis entirely around victory: it will no longer reduce LP losses in the case of defeat, and wins will award double LP without requiring a minimum mastery score.',
    change: 'adjusted',
    patch: '16.15',
    reason:
      '自动补位保护制度重构：败局减LP损失取消，胜局双LP不再要求熟练度等级；奖励与损失条件同时变化，真实混合。'
  },
  {
    category: 'system',
    ability: null,
    text: 'Master players will now be able to duo, but only with players close to them in rank.',
    change: 'adjusted',
    patch: '16.15',
    reason:
      '大师双排资格/匹配制度公告；不是英雄/战斗数值的统一强度变化，不把资格放宽直接包装成对整个系统的加强。'
  },
  {
    category: 'system',
    ability: null,
    text: 'GM, Challenger, and players with GM or Challenger MMR will not be allowed to duo.',
    change: 'adjusted',
    patch: '16.15',
    reason: '宗师/王者及相应MMR禁双排制度说明，没有该句的明确旧状态；不能仅凭not allowed猜削弱。'
  },
  {
    category: 'system',
    ability: null,
    text: 'For more details on the exact restrictions, see here.',
    change: 'adjusted',
    patch: '16.15',
    reason: '制度说明外链，不是改动，应从平衡条目过滤。'
  },
  {
    category: 'system',
    ability: null,
    text: 'Adaptive Force at 5 / 10 stat breakpoints: 10 / 25 ⇒ 8 / 20',
    change: 'nerf',
    patch: '16.15',
    reason: '万金油5/10属性门槛不变，适应之力奖励10/25→8/20，全部降低，明确削弱。'
  },
  {
    category: 'system',
    ability: null,
    text: 'Healing: 10-130 ( +[10% bonus AD Melee || 6% bonus AD Ranged]) ( +[5% AP Melee || 3% AP Ranged]) ⇒ 15-160 ( +[10% bonus AD Melee || 6% bonus AD Ranged]) ( +[5% AP Melee || 3% AP Ranged])',
    change: 'buff',
    patch: '16.16',
    reason: '迅捷步法基础治疗10–130→15–160提高，近/远程AD/AP系数完全不变，明确加强。'
  },
  {
    category: 'system',
    ability: null,
    text: 'Attack Speed: 120% Melee || 60% Ranged ⇒ 90% Melee || 60% Ranged',
    change: 'nerf',
    patch: '16.16',
    reason: '丛刃近战攻速120%→90%降低，远程60%不变，明确削弱。'
  },
  {
    category: 'system',
    ability: null,
    text: 'Bonus True Damage: 4-20 (+8% bonus AD) (+6% AP) ⇒ 2-20 (+12% bonus AD) (+10% AP)',
    change: 'adjusted',
    patch: '16.16',
    reason: '丛刃额外真伤前期基础4→2降低，AD/AP系数8/6→12/10提高，构筑/时期交叉。'
  },
  {
    category: 'system',
    ability: 'ADC MAGIC RESISTANCE',
    text: "Affected Champions: Akshan, Aphelios, Ashe, Caitlyn, Corki, Draven, Ezreal, Graves, Jhin, Jinx, Kai'Sa, Kalista, Kindred, Kog'Maw, Lucian, Miss Fortune, Quinn, Samira, Senna, Sivir, Smolder, Twitch, Varus, Vayne, Xayah, Yunara, Zeri",
    change: 'adjusted',
    patch: '16.16',
    reason: '受影响英雄名单，范围说明而非改动，不定向。'
  },
  {
    category: 'system',
    ability: 'ADC MAGIC RESISTANCE',
    text: 'Magic Resistance: 30 + 1.3/level ⇒ 33 + 1.1/level',
    change: 'adjusted',
    patch: '16.16',
    reason: '通用ADC魔抗基础+3、成长-0.2；SR18级成长累计17次时净差3−3.4=−0.4，早晚交叉。'
  },
  {
    category: 'system',
    ability: 'ADC MAGIC RESISTANCE',
    text: 'Tristana Magic Resistance: 28 + 1.3/level ⇒ 33 + 1.1/level',
    change: 'buff',
    patch: '16.16',
    reason:
      '小炮魔抗基础+5、成长-0.2；SR1–18级成长累计最多17次，净差至少5−3.4=+1.6；全等级提高，应加强而非机械判混合。'
  },
  {
    category: 'system',
    ability: 'JUNGLE PETS',
    text: 'Damage Per Attack: 20 - 150 (based on level) (+10% bonus Attack Damage) (+12% Ability Power) (+20% bonus Armor) (+20% bonus Magic Resistance) (+3% bonus Health) ⇒ 20 - 150 (based on level) (+10% bonus Attack Damage) (+16% Ability Power) (+25% bonus Armor) (+25% bonus Magic Resistance) (+4% bonus Health)',
    change: 'buff',
    patch: '16.16',
    reason: '野宠每次伤害基础/AD系数不变，AP/额外护甲/额外魔抗/额外生命系数全部提高，没有下降项。'
  },
  {
    category: 'system',
    ability: 'SUPPORT ROLE QUEST',
    text: 'Stack Consumption On Champion / Turret Damage: 22 Melee || 20 Ranged and 24 Melee || 22 Ranged ⇒ 18 and 21',
    change: 'nerf',
    patch: '16.16',
    reason:
      '官方上下文说移除英雄战斗相对补刀的额外任务进度；近/远程两档进度22/20、24/22降到18、21。Stack Consumption在此是任务进度，不是消耗越低越好。'
  },
  {
    category: 'system',
    ability: 'SUPPORT ROLE QUEST',
    text: 'Stack Consumption On Creep Score: 15 and 20 ⇒ 18 and 21',
    change: 'buff',
    patch: '16.16',
    reason: '辅助任务补刀推进值15/20→18/21全部提高；相同门槛更快完成任务，为补刀行为加强。'
  },
  {
    category: 'system',
    ability: 'SUPPORT ROLE QUEST',
    text: 'Minion Creep Score Experience / Gold Penalty: -25% outside of bot lane until level 3 ⇒ -33% outside of bot lane until level 5',
    change: 'nerf',
    patch: '16.16',
    reason:
      '离开下路的小兵经验/金币处罚25%→33%加重，终止等级3→5延长；两个维度均削弱游走辅助的资源收益。'
  },
  {
    category: 'system',
    ability: 'Teleport Cooldown',
    text: "Top Role Quest's Free Teleport Cooldown: 420 seconds ⇒ 390 seconds",
    change: 'buff',
    patch: '16.19',
    reason:
      'Role-quest Teleport cooldown decreases from 420 to 390 seconds: the spell can be used 30 seconds earlier. The immediately preceding official paragraph explicitly says buffing the cooldown.'
  },
  {
    category: 'system',
    ability: 'Teleport Cooldown',
    text: "Top Role Quest's Upgraded Unleashed Teleport Cooldown: 330 - 240 seconds ⇒ 300 - 210 seconds",
    change: 'buff',
    patch: '16.19',
    reason:
      'Both corresponding endpoints of the same level-scaled cooldown decrease by 30 seconds (330–240 to 300–210). The descending endpoints describe a cooldown curve, not subtraction. Official context explicitly calls this a buff.'
  },
  {
    category: 'system',
    ability: 'Teleport Cooldown',
    text: 'Non-Top Unleashed Teleport Cooldown: 330 - 240 seconds ⇒ Unchanged',
    change: 'unchanged',
    patch: '16.19',
    reason:
      'The source explicitly says Unchanged. This is not a buff, nerf, or actual adjustment; adjusted is only the current three-state contract fallback. A future semantic/UI state should be unchanged or omit this row from an adjustment summary.'
  },
  {
    category: 'system',
    ability: null,
    text: "Death's Dance",
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Haunting Guise',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: "Liandry's Torment",
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Riftmaker',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Kraken Slayer',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Terminus',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: "Guinsoo's Rageblade",
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Fiendhunter Bolts',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Echoes of Helia',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: "Dead Man's Plate",
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Spear of Shojin',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: "Overlord's Bloodmail",
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Hullbreaker',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: "Jak'sho the Protean",
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  },
  {
    category: 'system',
    ability: null,
    text: 'Force of Nature',
    change: 'adjusted',
    patch: '16.20',
    reason:
      'Item name in the source list whose scoreboard icon counter is now hidden. The preceding official paragraph describes scoreboard display cleanup, not any numerical gameplay effect or an item buff/nerf.'
  }
] as const

export function reviewedPatchMechanic(entry: Entry, category: string) {
  return (
    mechanics.find(
      (rule) =>
        rule.category === category && rule.text === entry.text && rule.ability === entry.ability
    )?.change ?? null
  )
}
