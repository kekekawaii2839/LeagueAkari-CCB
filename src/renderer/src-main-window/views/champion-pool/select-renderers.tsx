import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { NTag, type SelectOption } from 'naive-ui'

const identityStyle = { display: 'inline-flex', alignItems: 'center', gap: '8px' }
export function renderRoleLabel(option: SelectOption) {
  return (
    <span style={identityStyle}>
      <PositionIcon
        position={option.value === 'SUP' ? 'SUPPORT' : String(option.value)}
        style={{ fontSize: '20px', flexShrink: 0 }}
        aria-hidden="true"
      />
      <span>{String(option.label)}</span>
    </span>
  )
}
export function renderChampionLabel(option: SelectOption) {
  return (
    <span style={identityStyle}>
      <ChampionIcon
        championId={Number(option.value)}
        style={{ width: '24px', height: '24px', flexShrink: 0 }}
        aria-hidden="true"
      />
      <span>{String(option.label)}</span>
    </span>
  )
}
export function renderChampionTag({
  option,
  handleClose
}: {
  option: SelectOption
  handleClose: () => void
}) {
  return (
    <NTag
      size="medium"
      closable
      onClose={handleClose}
      style={{ height: '28px', padding: '0 8px', fontSize: '14px' }}
    >
      <span
        style={{
          ...identityStyle,
          display: 'flex',
          gap: '6px',
          height: '24px',
          lineHeight: '22px'
        }}
      >
        <ChampionIcon
          championId={Number(option.value)}
          style={{ width: '22px', height: '22px', flexShrink: 0 }}
          aria-hidden="true"
        />
        <span>{String(option.label)}</span>
      </span>
    </NTag>
  )
}
