import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import type { SelectOption } from 'naive-ui'
import { type VNodeChild, h } from 'vue'

const roleNames: Record<string, string> = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

/** Presentation metadata only. The original option label/value remain the
 * source for native selection, filtering and callers' summaries. */
export type RoleSelectOption = SelectOption & {
  role?: string
  roles?: readonly string[]
  memberLabel?: string
}

function roleSelectLabel(option: SelectOption, selected: boolean): VNodeChild {
  const metadata = option as RoleSelectOption
  const roles = metadata.roles ?? [metadata.role ?? option.value]
  // Do not turn ALL, unknown keys or an unproved composite into a real lane.
  if (
    !roles.length ||
    roles.some((role) => typeof role !== 'string' || !Object.hasOwn(roleNames, role))
  )
    return typeof option.label === 'string' ? option.label : ''
  const chunks: VNodeChild[] = []
  for (const role of roles as string[]) {
    chunks.push(
      h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 } },
        [
          h(PositionIcon, {
            position: role,
            'aria-hidden': 'true',
            style: { fontSize: '16px', flexShrink: 0 }
          }),
          h('span', roleNames[role])
        ]
      )
    )
  }
  if (metadata.memberLabel)
    chunks.push(
      h(
        'span',
        {
          title: metadata.memberLabel,
          style: selected
            ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            : { flexBasis: '100%', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }
        },
        `· ${metadata.memberLabel}`
      )
    )
  return h(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: selected ? 'nowrap' : 'wrap',
        gap: '4px 8px',
        lineHeight: '22px',
        maxWidth: '100%'
      }
    },
    chunks
  )
}

export function renderRoleSelectLabel(option: SelectOption): VNodeChild {
  return roleSelectLabel(option, false)
}

// Naive's public single-selection renderer, distinct from menu renderLabel
// (whose second argument means option-selected, not menu vs closed context).
export function renderRoleSelectTag({ option }: { option: SelectOption }): VNodeChild {
  return roleSelectLabel(option, true)
}

/** The always-visible pair selector retains its established short titles. */
export function renderRolePairSegmentLabel(option: {
  value: string | number
  label: string
}): VNodeChild {
  const roles: Record<string, readonly string[]> = {
    upper_pair: ['TOP', 'JUNGLE'],
    mid_jg_pair: ['MIDDLE', 'JUNGLE'],
    bot_pair: ['BOTTOM', 'UTILITY']
  }
  if (!Object.hasOwn(roles, option.value)) return option.label
  return h(
    'span',
    { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' } },
    [
      ...roles[option.value].map((position) =>
        h(PositionIcon, {
          position,
          'aria-hidden': 'true',
          style: { fontSize: '14px', flexShrink: 0 }
        })
      ),
      h('span', option.label)
    ]
  )
}
