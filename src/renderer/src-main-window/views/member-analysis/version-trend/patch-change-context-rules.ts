// Source-context rules plus explicitly requested neutral display policies.
// Exact text/category/ability matching preserves unreported numerical baselines.
export const contextualPatchRules = [
  {
    patch: '16.18',
    category: 'champion',
    ability: 'W - Ultrashock Laser',
    text: 'Critical Strike: 150% (+15% IE)',
    change: 'adjusted',
    reason:
      'User-requested neutral display for an announcement without the complete old multiplier. Before/after remain null; no numerical baseline is invented.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where images from the Classic Mode Homepage loaded when logging into a non-Classic Mode tab.',
    change: 'adjusted',
    reason:
      'Cross-mode client resource leak explicitly affects a non-Classic tab; not a Classic-only gameplay change. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.13',
    category: 'champion',
    ability: 'Passive - Silver Stake',
    text: "Locke's attacks deal additional magic damage On-Hit, increased based on enemy missing Health.",
    change: 'introduced',
    reason:
      'New champion launch ability description, not a modification of an existing baseline; no before values are fabricated.'
  },
  {
    patch: '16.13',
    category: 'champion',
    ability: 'Q - Ritual Nails',
    text: 'Locke readies a set of Soul Nails to throw, dealing damage to and marking enemies hit. Locke can consume the marks to deal bonus damage with his attacks.',
    change: 'introduced',
    reason:
      'New champion launch ability description, not a modification of an existing baseline; no before values are fabricated.'
  },
  {
    patch: '16.13',
    category: 'champion',
    ability: 'W - Soul Ignition',
    text: 'Locke ignites his soul, gaining Attack Speed and Move Speed, and dealing damage to himself. At the end of the duration, Locke will heal back a portion of the damage he takes during the effect.',
    change: 'introduced',
    reason:
      'New champion launch ability description, not a modification of an existing baseline; no before values are fabricated.'
  },
  {
    patch: '16.13',
    category: 'champion',
    ability: 'E - Ashen Pursuit',
    text: 'Locke teleports to a location before dashing to attack his next target, dealing damage to enemies passed through.',
    change: 'introduced',
    reason:
      'New champion launch ability description, not a modification of an existing baseline; no before values are fabricated.'
  },
  {
    patch: '16.13',
    category: 'champion',
    ability: 'R - Purgatory',
    text: 'Locke throws a binding artifact that deals damage and potentially executes enemies hit. Locke gains additional power for sealing away enemy champions.',
    change: 'introduced',
    reason:
      'New champion launch ability description, not a modification of an existing baseline; no before values are fabricated.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: "We are happy to open up Normal Draft availability for ME, OC and SG from windowed time to 24/7, as we've seen meaningful queue time improvement across regions since late 2025.",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: 'We are introducing Honor and active penalty information to your social panel so you can easily track your standing, view your progress towards redemption, and see how your behavior impacts your games. The panel will display current Honor, restrictions, and actions you must take to restore standing, serving as a constant reminder of the positive community we are building together.',
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: "Fixed a bug where the Helping Hand buff from certain starting items wasn't removed when sold or undone.",
    change: 'adjusted',
    reason:
      'Removes an unintended retained starting-item buff after selling or undoing; weaker for the beneficiary of the exploit. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where dying before smite upgraded at 45 seconds would keep Smite at one charge.',
    change: 'adjusted',
    reason:
      'Restores normal Smite charges instead of remaining at one after an early death. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Rift Herald would deal magic damage to turrets instead of true damage if the champion driving it had more AP than AD.',
    change: 'adjusted',
    reason:
      'For the AP Herald driver, restores true turret damage instead of mitigated magic damage. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: "Fixed a bug where abilities that don't CC but swapped to CC spells (Elise E, Leblanc R, etc.) gained Ability Haste from Imperial Mandate's Control passive.",
    change: 'adjusted',
    reason:
      'Removes unintended Control ability haste from the non-CC form of switching spells. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Practice Tool keybinds would fail to save when using WASD Inputs in the Options Menu.',
    change: 'adjusted',
    reason:
      'Practice Tool keybind persistence is functional control UI, not combat tuning. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Elise's human form death animation was played when she died in Spider form.",
    change: 'adjusted',
    reason:
      'Only corrects human/spider death animation; no combat values change. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.12',
    category: 'system',
    ability: null,
    text: 'Fixed several cases where Neeko would not play the proper homeguard run animation when disguised as Wukong with various skins.',
    change: 'adjusted',
    reason:
      'Only corrects disguised homeguard running animation. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.13',
    category: 'system',
    ability: null,
    text: "We're going to be enabling Last Hit Indicators for Normal Draft games. This feature has been live in Swiftplay & Co-op vs. AI for a while, and we've seen it result in new players being more successful at last-hitting than before. These players are now graduating into Normals and are interested in continuing to use them. We think it's better to focus on skill expression in other parts of the game—rather than understanding exactly when you can last-hit a minion—and are also pretty confident that these don't degrade skill expression in lane. You still need to be mindful of positioning, harassing your opponent, considering where both junglers are, understanding power spikes, and more. We've seen that experienced players are disabling it, as they find it more distracting than helpful, but we believe it should be available for those who want it. Let us know what you think! We've seen a lot of conversation around Last Hit Indicators coming to Ranked, and we've decided to enable them in non-Ranked SR queues only for continued testing. We want to get more data and feedback to decide if we should make them an option for Ranked before making that call. So we'll keep them enabled, but off by default, for Swiftplay, Co-op vs AI, and Normal Draft, to collect data and iterate. We'll keep you updated about performance and progress in Dev Updates before making any future calls.",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.13',
    category: 'system',
    ability: null,
    text: "Player DMs have long been a gap in our reporting coverage, which has allowed bad actors to use direct messages as a place for chat toxicity with impunity. We are closing that loophole in this patch by adding a report menu directly into your chat interface. You can report and/or block a player at the same time by selecting the report button on the chat header, right-clicking the chat dialogue to summon the context menu, or from the block menu. Blocking a player means that DMs can no longer be exchanged. However, message history will persist during the same session after blocking or being blocked, so that players can no longer abuse the block function as a way to avoid being reported. Once reported, we'll be able to view both sides of the conversation and take action where appropriate. All reported direct message data is handled securely and used strictly for moderation purposes. While we hope you don't have to use this feature often, this tool ensures accountability extends to all player communications in League.",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.13',
    category: 'system',
    ability: null,
    text: "Ranked 5s are back! Time to call the squad (or find some friends if you're like us.) On June 26, Ranked 5s will be live at 8 pm! Tournament Draft, double the stakes, no restrictions on who can play with each other, and unique rewards. To learn more about Ranked 5s, check out the dev blog.",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.13',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Baron Nashor's max stacks of Void Corruption was higher than intended.",
    change: 'adjusted',
    reason:
      'Neutral-objective debuff correction; source omits actual stack values and affected interactions, so do not imply a single champion buff. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.13',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Serpent's Fang's Shield Reaver damage applied Omnivamp.",
    change: 'adjusted',
    reason:
      'Removes unintended omnivamp healing from Shield Reaver damage. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.13',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Diana's R VFX may not play properly around different areas of the map.",
    change: 'adjusted',
    reason:
      'Only corrects Diana ultimate VFX playback. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: "Ranked Season 2 will end local server time at midnight 23:59 on July 28, which is the last day of patch 26.14. Several hours later, we'll roll over into patch 26.15, which marks the start of Season 3 at 12:00pm noon, July 29, local server time. Similar to previous mid-year season transitions, Ranked Solo and Flex queues will be disabled during the down time. Shard transfer services will also be disabled to make sure rewards are properly calculated. We don't expect any disruptions to your LP / Ranked progression, but the Victorious Ranked mission for 15 ranked games won will be refreshed when the new season starts.",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: "Riot is rolling out optional Parent Permissions to give parents more visibility and control over their child's social interactions in game. Parents can access parental controls by connecting a parent's email address via account control page, where they can limit text and voice chat, block friend requests, and view the social panel friends list. These controls are meant to provide parents with the tools to protect their child's safety. Read more about parental permissions and account setup here.",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: 'Trimmed redundant buffs that repeat information already clearly communicated elsewhere in the UI or gameplay state (e.g. role quest progress and other obvious state changes).',
    change: 'adjusted',
    reason: 'Buff-bar information presentation changes; no combat effect values change.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: 'Moved most item buffs with durations into the inventory on the item itself.',
    change: 'adjusted',
    reason: 'Moves duration information to inventory items; functional UI presentation.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: "Reduced buff bar clutter from lower-impact system, map and item effects that don't meaningfully change player decision-making.",
    change: 'adjusted',
    reason: 'Changes which lower-impact buffs the bar displays; functional UI presentation.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: 'Removed display of very short-duration debuffs and effects (˜0.25s), including things like minor slows from Honeyfruit pickups.',
    change: 'adjusted',
    reason: 'Changes short debuff visibility on the UI, not actual duration/effect.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Caitlyn's Headshot may fail to fire while in brush.",
    change: 'adjusted',
    reason:
      'Caitlyn Headshot now fires in brush instead of failing. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Guinsoo's Rageblade's first Phantom Hit would apply one attack earlier than expected.",
    change: 'adjusted',
    reason:
      'Removes one-attack-earlier Phantom Hit, delaying the unintended initial proc. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: 'Remake votes will now begin automatically when they are eligible rather than requiring a player to type /remake in chat. Chat context now explains which player triggered the remake vote and why.',
    change: 'adjusted',
    reason: 'Automatic eligible remake voting and explanation is match flow/UI behavior.'
  },
  {
    patch: '16.14',
    category: 'system',
    ability: null,
    text: 'Deafen and self-mute functionality can now only be toggled once every 60 seconds to prevent spam and disruptive one-way communication.',
    change: 'adjusted',
    reason: 'Communication-toggle rate limit, not champion/item power.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug which prevented Neeko to disguise as Voidborn Rift Scuttler.',
    change: 'adjusted',
    reason:
      'Restores Neeko ability to disguise as the Voidborn Rift Scuttler. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Pix was always visible as one from Base skin if Neeko disguised as Lulu.',
    change: 'adjusted',
    reason:
      'Only corrects the visual skin used by Pix in the disguise. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: "Fixed a bug that prevented Neeko from being able to disguise herself as Nidalee's Cougar form and Elise's Spider form.",
    change: 'adjusted',
    reason:
      'Restores additional shapeshifted champion forms as valid Neeko disguises. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: "Fixed a bug that prevented Neeko to disguise herself as DJ Sona's Concussive and Ethereal Forms.",
    change: 'adjusted',
    reason:
      'Restores additional DJ Sona forms as valid Neeko disguises; functional disguise availability, not a damage-stat change. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: "Fixed a bug where if Neeko was disguised as DJ Sona's Kinetic form the hair was missing.",
    change: 'adjusted',
    reason:
      'Only restores missing hair geometry on a cosmetic disguise. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug that caused horns to be visible inside the head when Neeko was disguised by Smolder.',
    change: 'adjusted',
    reason:
      'Only corrects horn geometry on the Smolder disguise. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Diana’s E may fail to dash over terrain.',
    change: 'adjusted',
    reason:
      'Diana E can again traverse terrain rather than failing. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Cassiopeia’s R VFX didn't match the ability’s hitbox.",
    change: 'adjusted',
    reason:
      'Only aligns displayed ultimate VFX with its unchanged hitbox. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Mid lane Tier 3 role quest boots could not be refunded with the undo button.',
    change: 'adjusted',
    reason:
      'Restores item undo transaction functionality; no item stats or combat tuning stated. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Nilah’s attacks immediately after Q or E may not trigger Hail of Blades.',
    change: 'adjusted',
    reason:
      'Restores Hail of Blades triggering on Nilah attacks immediately following Q/E. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Deathfire Touch’s burn duration could be overwritten when landing a spell with a shorter duration.',
    change: 'adjusted',
    reason:
      'Prevents a shorter new burn from overwriting an existing longer Deathfire Touch burn. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where the Death Recap window may not appear when a player dies.',
    change: 'adjusted',
    reason:
      'Restores functional death recap UI visibility. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Locke’s R artifact could not be retrieved on an enemy that was invulnerable when hit by Locke’s R.',
    change: 'adjusted',
    reason:
      'Restores retrieval of Locke R artifact from the specified invulnerable target case. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Zeke’s convergence active effect would not damage monsters.',
    change: 'adjusted',
    reason:
      'Restores Zeke active damage against monsters. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.15',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Locke’s R was not recolored when the artifact was reflected by Mel W.',
    change: 'adjusted',
    reason:
      'Only corrects the reflected artifact recolor. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'QoL CHANGES',
    text: 'Reduced the volume of base Locke (Q) missile cast sound effects to better sit in the overall game mix.',
    change: 'unchanged',
    reason: 'Audio-mix volume change, with no gameplay radius or mechanic change stated.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: "Fixed a bug where Viego with the Bot lane Role Quest would be able to steal his possessed target's boots.",
    change: 'adjusted',
    reason:
      'Removes Viego ability to keep/steal possessed targets boots with the bot quest. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: 'Fixed a bug where upgrading from Hexdrinker to Maw of Malmortius did not reset the cooldown of the item.',
    change: 'adjusted',
    reason:
      'Restores cooldown reset when upgrading Hexdrinker into Maw, making the defensive proc available. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: 'Fixed a bug where killing a ward would display debug text for spectators.',
    change: 'adjusted',
    reason:
      'Removes spectator debug text only. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: 'Fixed a bug where Locke picking up his (R) artifact would refund based on its current cooldown instead of the total cooldown.',
    change: 'adjusted',
    reason:
      'Refund is now based on full rather than already-reduced current R cooldown, increasing the refund. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: 'Fixed a bug where in certain circumstances Taunt and Berserk effects could be ignored using WASD controls.',
    change: 'adjusted',
    reason:
      'System-wide CC consistency fix removes a WASD escape advantage; buffs taunt/berserk users and nerfs affected targets rather than one universal beneficiary. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: "Fixed a bug where Support players' Control wards would be consumed when trying to place them while dead.",
    change: 'adjusted',
    reason:
      'Prevents the support player from losing a purchased Control Ward while placement is impossible due to death. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: "Fixed a bug where Ambessa's omnivamp would apply on turrets when driving Rift Herald into them.",
    change: 'adjusted',
    reason:
      'Removes unintended Ambessa omnivamp on Herald turret impact. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: 'Fixed a bug where Mordekaiser (R) improperly gains Ability Haste.',
    change: 'adjusted',
    reason:
      'Removes unintended Mordekaiser R ability haste gain. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: "Fixed a bug where Bel'Veth's resource bar would incorrectly update if she hit 80 stacks while already in True Form.",
    change: 'adjusted',
    reason:
      'Corrects True Form resource-bar update; no actual Remora threshold or power change is stated. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: 'Fixed a bug where Locke (R) execution would be considered a spell cast.',
    change: 'adjusted',
    reason:
      'Changing whether execution counts as a cast can alter multiple proc/cast interactions; source gives no affected interaction or net direction. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.16',
    category: 'system',
    ability: 'BUGFIXES',
    text: 'Fixed a bug where Viktor (R) lightning VFX would stretch across the screen in certain situations.',
    change: 'adjusted',
    reason:
      'Corrects stretched ultimate lightning VFX only. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.17',
    category: 'system',
    ability: null,
    text: 'The minimum and recommended specs for macOS have been updated. Please refer to the Minimum and Recommended System Requirements Player Support article for full details.',
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.17',
    category: 'system',
    ability: null,
    text: 'NEW Added controller preset for spectator camera movement, giving users smoother control of camera views when ReplayAPI is enabled. Instructions for getting started with the ReplayAPI can be accessed here.',
    change: 'adjusted',
    reason: '新增回放摄像机控制器预设属于操作功能，不是英雄战力。'
  },
  {
    patch: '16.17',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Jayce's EQ damage was not properly displayed as enhanced damage.",
    change: 'adjusted',
    reason:
      '增强伤害显示文本修复，未声明真实伤害改变。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.17',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Diana's E dash speed was slower than intended in certain cases.",
    change: 'adjusted',
    reason:
      'Diana E在特定情形下冲刺过慢，修复提升其接近目标的能力。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.17',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Akali's Shuriken (E) could travel across the map, allowing her to hit and dash to targets at unintended distances.",
    change: 'adjusted',
    reason:
      '移除Akali E横跨地图命中和位移的超出预期距离能力。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.17',
    category: 'system',
    ability: null,
    text: 'Fixed a bug with Swiftmarch’s tooltip where it stated it provided more Slow Resist than it did.',
    change: 'adjusted',
    reason:
      'Swiftmarch减速抗性提示修正，实际数值未改变。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.17',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Vladimir P would not properly convert AP from runes.',
    change: 'adjusted',
    reason:
      'Vladimir被动恢复对符文来源AP的正常转换，增加本应获得的资源。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.17',
    category: 'system',
    ability: null,
    text: 'Fixed a bug in Blind Pick (Custom Games) where junglers would be locked out of their starting items in very rare cases.',
    change: 'adjusted',
    reason:
      '修复自定义盲选打野不能购买起始装备，恢复可用功能；非普通排位专属。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.18',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Baron Nashor's max stacks of Void Corruption was higher than intended.",
    change: 'adjusted',
    reason:
      'Neutral-objective debuff correction; source omits actual stack values and affected interactions, so do not imply a single champion buff. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.18',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Serpent's Fang's Shield Reaver damage applied Omnivamp.",
    change: 'adjusted',
    reason:
      'Serpent Fang额外Shield Reaver伤害不再触发Omnivamp，减少持有者非预期回复。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.18',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Diana's R VFX may not play properly around different areas of the map.",
    change: 'adjusted',
    reason:
      'Diana R地图区域VFX呈现修复，未声明真实伤害或范围改变。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.18',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Viego possessing Kled could result in an infinite looping sound effect.',
    change: 'adjusted',
    reason:
      'Viego附身Kled的循环音效修复，未改战斗数值。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: "First up, we wanted to share an update on the rollout of Team Voice, which is our planned expansion to the existing pre-made party voice chat allowing you to chat with everyone on your team. While we originally announced this as coming to North America and Oceania in Patch 26.20, after extensive testing, we've made the call to postpone this a bit to make sure we're hitting the quality bar you deserve for the experience. We don't have a target patch just yet, but we're prioritizing ironing out the kinks as efficiently as we can, since we know this is a long awaited feature we need to get right.",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Renata's R would not amp damage caused by Berserk targets.",
    change: 'adjusted',
    reason:
      'Renata R恢复对Berserk目标造成伤害的放大。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: "Updated the Practice Tool Stack Item cheat to include: Dark Seal, Mejai's, Heartsteel, Gluttonous Greaves, and Force of Nature.",
    change: 'adjusted',
    reason: '训练工具叠层物品作弊功能扩展，不是对局战力调整。'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Taliyah's W terrain was smaller than the hitbox.",
    change: 'adjusted',
    reason:
      'Taliyah W terrain小于hitbox，未明确改视觉地形还是实际判定；不能仅据该句判方向。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Yone's R warning VFX was not visible in very specific circumstances.",
    change: 'adjusted',
    reason:
      'Restores warning information; source specifies visibility rather than a damage change, affecting counterplay. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Yunara's auto resets would not extend Hail of Blades appropriately.",
    change: 'adjusted',
    reason:
      'Yunara普攻重置恢复正确延长Hail of Blades。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Renekton would not gain 20 fury from his ult when it was cast immediately after W.',
    change: 'adjusted',
    reason:
      'Renekton在W后立即施放R恢复获得20怒气。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Nunu & Willump could unlock his camera during W.',
    change: 'adjusted',
    reason:
      'Nunu W镜头锁定行为修复属于操作行为，不直接归为战力加强/削弱。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where clones would not receive Homeguards after running back to the fountain',
    change: 'adjusted',
    reason:
      '克隆体回泉恢复Homeguard移速；改善其返回战场能力。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Target Champions Only could be toggled on unexpectedly',
    change: 'adjusted',
    reason:
      '仅以英雄为目标开关意外切换的控制状态修复。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Camille's W would count as two hits when triggering bone plating.",
    change: 'adjusted',
    reason:
      'Camille W不再作为两次命中消耗/触发Bone Plating；移除对符文的非预期双计数优势。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Camille's Passive would sometimes not proc Shield Bash.",
    change: 'adjusted',
    reason:
      'Camille被动恢复正常触发Shield Bash。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.19',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Aatrox Q sweetspots use crit text instead of enhanced damage text.',
    change: 'adjusted',
    reason:
      'Aatrox Q甜点增强伤害显示由暴击文字更正，真实伤害未变。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Our recent systemic buff-bar clarity work moved a lot of numbers from buffs onto items. These numbers began terrorizing your scoreboards (thanks, Death's Dance). The scoreboard should show strategically relevant information, not noisy in-the-moment combat state, and we're hiding most item numbers on the scoreboard to reflect this principle. Strategically relevant item numbers, like Tear of the Goddess items and Mejai's Soulstealer, remain on the scoreboard icons.",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "The following items' icon counters are now hidden on the scoreboard:",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "In case you missed it, we've extended the queue windows for Ranked 5s from the previous 4pm-2am to 4pm-4am server time. We noticed",
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Orianna's (R) VFX and actual hitbox become misplaced if she casts (R) before the ball reaches a fast-moving ally like Nocturne.",
    change: 'adjusted',
    reason:
      'Orianna R实际hitbox和VFX错位修复，但原文没给出判定从何处到何处，不能证明单向强弱。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where a Sylas-stolen Depth Charge (R) from Nautilus could fizzle after Sylas lost vision of the target.',
    change: 'adjusted',
    reason:
      'Sylas偷取Nautilus R后丢视野不再导致技能无效。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Xin Zhao's Three Talon Strike (Q) went completely on cooldown if the first attack was dodged by spells like Shen's Shadow Dash (E) or Jax's Counterstrike (E).",
    change: 'adjusted',
    reason:
      'Xin Zhao Q首击被闪避不再立刻整段进入冷却。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Shyvana's Dragon's Descent (R) ability fails to cancel enemy teleports.",
    change: 'adjusted',
    reason:
      'Shyvana R恢复打断敌方传送。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Kayle's Reckoning (Q) applies the on-hit Spellblade effect from Sheen, Lich Bane, Trinity Force, and Iceborne Gauntlet.",
    change: 'adjusted',
    reason:
      'Kayle Q不再非预期触发Sheen系Spellblade附伤。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where large melee champions could auto large enemy champions and not be in immolate radius.',
    change: 'adjusted',
    reason:
      '大型近战英雄近身普攻距离内恢复Immolate覆盖，提升持有者对大型目标有效伤害。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Rune page tabs overflow and clip the editor when owning more than 20 pages.',
    change: 'adjusted',
    reason:
      '超过20页符文时编辑页标签溢出修复是功能UI。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Sivir's Spell Shield (E) does not block Leona's Zenith Blade (E).",
    change: 'adjusted',
    reason:
      'Sivir E恢复格挡Leona E。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where the tab buttons in the champion overview window are misaligned and unusable.',
    change: 'adjusted',
    reason:
      '英雄概览标签按钮错位不可用修复为功能UI。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Malphite's Flash summoner spell is disabled after using Unstoppable Force (R).",
    change: 'adjusted',
    reason:
      'Malphite R后Flash不再被禁用，恢复召唤师技能可用性。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where rapidly pressing Recall gains Guinsoo's Rageblade stacks.",
    change: 'adjusted',
    reason:
      '快速按回城不再获得Guinsoo Rageblade叠层，移除免费战斗增益。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Runaan's Hurricane Volley (P) triggers Minions' Call for Help.",
    change: 'adjusted',
    reason:
      'Runaan Hurricane Volley不再引发小兵求援，减少持有者由该附带效果招致的小兵仇恨。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Sivir's Spell Shield does not block damage from Miss Fortune's Q.",
    change: 'adjusted',
    reason:
      'Sivir E恢复格挡Miss Fortune Q伤害。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.20',
    category: 'system',
    ability: null,
    text: "Fixed a bug where Sona's (E) ability description incorrectly states that its effect applies only to champions.",
    change: 'adjusted',
    reason:
      'Sona E描述不再错误声称仅作用英雄，文本修正未声明实际作用对象改变。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.21',
    category: 'champion',
    ability: null,
    text: "This patch we did work to adjust Varus' top and bottom power skew, which involved shifting the balance between his Q and W for laning. While the resulting changes have seemed promising, we unfortunately added a major bug to his Q during this work, causing it to no longer deal reduced damage to subsequent targets. We are fixing that bug, and compensating with a buff.",
    change: 'adjusted',
    reason:
      'Fix restores Q damage falloff on subsequent targets; the two numeric compensations remain separate buffs. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'Starting during Patch 26.21, replay downloads will be limited to 10 per hour. You will still be able to download your own replays, as well as replays from your friends and other players. This change is necessary to prevent large-scale abuse of downloaded replays by bad actors using vibecoded apps to scrape thousands upon thousands of replays. We opted for a time-based limit to still allow creators to make content, while preventing mass exploitative downloads. We’ll continue to monitor how many replays are downloaded to ensure players have access to this important feature while preventing clear misuse.',
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'We’ve shipped an improvement to how our patch launcher works. This improvement uses a software library that requires SSE 4.2, which results in us increasing our AMD minspec by one version. Please reference our article on minimum and recommended system requirements for more information: https://support.riotgames.com/en-us/league-of-legends/performance/minimum-and-recommended-system-requirements-league-of-legends',
    change: 'adjusted',
    reason:
      'Standalone system/availability/display announcement; no champion numerical buff or nerf is asserted.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'Fixed an issue where Zaahen (Q) would fail to complete if he does into Revive mid attack.',
    change: 'adjusted',
    reason:
      'Zaahen Q在进入复活时不再无法完成，恢复技能完成能力。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Summoner Teleport’s channel VFX was visible for enemies when cast in brush.',
    change: 'adjusted',
    reason:
      'Removes unintended enemy visibility of Teleport channel in brush, improving concealment for the caster, not merely a tooltip correction. Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Titanic Hydra’s cooldown timer would not be displayed after use.',
    change: 'adjusted',
    reason:
      'Titanic Hydra冷却计时器显示恢复，实际冷却未声明改变。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Zoe can get a 1000 damage smite from a minion drop earlier than expected.',
    change: 'adjusted',
    reason:
      'Zoe不再过早从小兵掉落取得1000伤害Smite。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Hail of Blades does not trigger on auto resets if the first attack was cancelled.',
    change: 'adjusted',
    reason:
      '首击取消后普攻重置恢复触发Hail of Blades。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'Fixed a bug where Nidalee’s (Q) spear damage could go through spell shields at max range.',
    change: 'adjusted',
    reason:
      'Nidalee Q最远距离不再穿透法术护盾造成伤害。 Display policy: bugfixes are shown as neutral adjustments, not strength ratings.'
  },
  {
    patch: '16.21',
    category: 'system',
    ability: null,
    text: 'Updated SFX to use the base skin’s ult SFX for Briar, Kled, and Sion when playing against them to improve clarity.',
    change: 'unchanged',
    reason: 'Briar/Kled/Sion对手侧大招音效统一为基础皮肤以提高清晰度，数值未变。'
  }
] as const
