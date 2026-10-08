import type { NodeProps, Node } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { useState, useRef, useEffect } from 'react'
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconLogin,
  IconLogout,
  IconArrowRight,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconDatabase,
  IconCloudUpload,
  IconCloudDownload,
  IconSearch,
  IconSettings,
  IconUser,
  IconMail,
  IconShieldCheck,
  IconLock,
  IconFile,
  IconDownload,
  IconUpload,
  IconTrash,
  IconEdit,
  IconPlus,
  IconMinus,
  IconRefresh,
  IconCopy,
  IconExternalLink,
  IconCode,
  IconTerminal2,
  IconGitBranch,
  IconRocket,
  IconHeart,
  IconStar,
  IconFlag,
  IconClock,
  IconCalendar,
  IconBell,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconGlobe,
  IconWifi,
  IconLink,
  IconPhoto,
  IconMathFunction,
  IconFilter,
  IconList,
  IconTemplate,
  IconTransform,
  IconBinaryTree,
} from '@tabler/icons-react'
import type { TablerIcon } from '@tabler/icons-react'
import type { DiagramStyle } from './styles'
import { getNodeStyleOverrides } from './styles'
import { SketchShape, hashSeed } from './sketch'

const ICON_MAP: Record<string, TablerIcon> = {
  'player-play': IconPlayerPlay,
  'player-stop': IconPlayerStop,
  login: IconLogin,
  logout: IconLogout,
  'arrow-right': IconArrowRight,
  check: IconCheck,
  x: IconX,
  'alert-triangle': IconAlertTriangle,
  database: IconDatabase,
  'cloud-upload': IconCloudUpload,
  'cloud-download': IconCloudDownload,
  search: IconSearch,
  settings: IconSettings,
  user: IconUser,
  mail: IconMail,
  'shield-check': IconShieldCheck,
  lock: IconLock,
  file: IconFile,
  download: IconDownload,
  upload: IconUpload,
  trash: IconTrash,
  edit: IconEdit,
  plus: IconPlus,
  minus: IconMinus,
  refresh: IconRefresh,
  copy: IconCopy,
  'external-link': IconExternalLink,
  code: IconCode,
  terminal: IconTerminal2,
  'git-branch': IconGitBranch,
  rocket: IconRocket,
  heart: IconHeart,
  star: IconStar,
  flag: IconFlag,
  clock: IconClock,
  calendar: IconCalendar,
  bell: IconBell,
  desktop: IconDeviceDesktop,
  mobile: IconDeviceMobile,
  globe: IconGlobe,
  wifi: IconWifi,
  link: IconLink,
  photo: IconPhoto,
  function: IconMathFunction,
  filter: IconFilter,
  list: IconList,
  template: IconTemplate,
  transform: IconTransform,
  tree: IconBinaryTree,
}

type FlowNodeData = {
  label: string
  nodeType: 'start' | 'end' | 'decision' | 'process' | 'io'
  isActive: boolean
  isVisited: boolean
  stepIndex?: number
  isSelected?: boolean
  isConnectingSource?: boolean
  isEditing?: boolean
  onEditStart?: () => void
  onEditEnd?: (newLabel: string) => void
  direction?: 'TB' | 'LR'
  diagramStyle?: DiagramStyle
  props: Record<string, string>
  computedWidth?: number
  computedHeight?: number
  groupLabel?: { label: string; color?: string }
}

type FlowNode = Node<FlowNodeData>

const handleStyle = { opacity: 0, width: 1, height: 1 }

function sourcePos(data: FlowNodeData) {
  return data.direction === 'LR' ? Position.Right : Position.Bottom
}

function targetPos(data: FlowNodeData) {
  return data.direction === 'LR' ? Position.Left : Position.Top
}

const base: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 500,
  fontFamily: 'var(--sans)',
  textAlign: 'center' as const,
  padding: '10px 14px',
  minHeight: 48,
  transition: 'box-shadow 0.3s, border-color 0.3s, background 0.3s',
  cursor: 'default',
  position: 'relative' as const,
  boxSizing: 'border-box',
  color: 'var(--text)',
  flexDirection: 'row' as const,
}

function getNodeColor(data: FlowNodeData): string {
  if (data.isActive) return 'var(--accent)'
  return data.props.color ?? 'var(--border)'
}

function getBoxShadow(data: FlowNodeData): string {
  if (!data.isActive) return 'none'
  const color = data.props.color ?? 'var(--accent)'
  return `0 0 0 3px ${color}`
}

function selectionOutline(data: FlowNodeData): React.CSSProperties {
  if (!data.isSelected) return {}
  return {
    outline: '2px dashed var(--accent)',
    outlineOffset: 4,
    borderRadius: 2,
  }
}

function getNodeBg(data: FlowNodeData, overrides: { background: string | ((active: boolean, visited: boolean) => string) | undefined }): string {
  if (overrides.background) {
    return typeof overrides.background === 'function'
      ? overrides.background(data.isActive, data.isVisited)
      : overrides.background
  }
  if (data.isActive) return 'var(--highlight-bg)'
  if (data.isVisited) return 'var(--bg-alt)'
  return 'var(--bg)'
}

function styleOverrides(data: FlowNodeData, nodeType: 'start' | 'end' | 'process' | 'io' | 'decision' | 'group') {
  const variant = data.diagramStyle ?? 'standard'
  return getNodeStyleOverrides(variant, nodeType)
}

function connectingPulse(data: FlowNodeData): React.CSSProperties {
  if (!data.isConnectingSource) return {}
  return {
    animation: 'pulse-ring 1s ease-in-out infinite',
    outline: '2px solid var(--accent)',
    outlineOffset: 5,
    borderRadius: 4,
  }
}

function StepPulse({ data, shape = 'rect' }: { data: FlowNodeData; shape?: 'rect' | 'diamond' }) {
  if (!data.isActive) return null

  if (shape === 'diamond') {
    const size = Math.min(data.computedWidth ?? 170, data.computedHeight ?? 68)
    return (
      <span
        key={data.stepIndex ?? 0}
        className="tv-step-pulse tv-step-pulse--diamond"
        style={{ width: size, height: size, marginTop: -size / 2, marginLeft: -size / 2 }}
        aria-hidden
      />
    )
  }

  return (
    <span
      key={data.stepIndex ?? 0}
      className="tv-step-pulse"
      style={{ borderRadius: data.diagramStyle === 'sketch' ? 12 : undefined }}
      aria-hidden
    />
  )
}

function EditableLabel({
  label,
  isEditing,
  onEditStart,
  onEditEnd,
}: {
  label: string
  isEditing: boolean
  onEditStart: () => void
  onEditEnd: (newLabel: string) => void
}) {
  const [value, setValue] = useState(label)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      const textarea = inputRef.current
      textarea.style.height = 'auto'
      const scrollHeight = textarea.scrollHeight
      textarea.style.height = `${scrollHeight}px`
    }
  }, [value, isEditing])

  useEffect(() => {
    if (isEditing) {
      setValue(label)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing, label])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isEditing) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onEditEnd(value)
      } else if (e.key === 'Escape') {
        onEditEnd(label)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isEditing, value, label, onEditEnd])

  if (!isEditing) {
    return (
      <span
        onDoubleClick={(e) => { e.stopPropagation(); onEditStart() }}
        style={{
          cursor: 'text',
          display: 'block',
          whiteSpace: 'pre-wrap' as const,
          wordWrap: 'break-word' as const,
          overflowWrap: 'anywhere' as const,
          hyphens: 'auto' as const,
        }}
      >
        {label}
      </span>
    )
  }

  return (
    <textarea
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onEditEnd(value)}
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--accent)',
        borderRadius: 4,
        padding: '4px 8px',
        fontSize: '13px',
        fontWeight: 'inherit',
        fontFamily: 'var(--sans)',
        color: 'inherit',
        textAlign: 'center',
        outline: 'none',
        width: '100%',
        boxSizing: 'border-box',
        height: 'auto',
        minHeight: '1.4em',
        resize: 'none',
        overflow: 'hidden',
        lineHeight: '1.4',
        display: 'block',
      }}
      className="nodrag nopan"
    />
  )
}

function NodeIcon({ name, size }: { name: string; size?: number }) {
  const Icon = ICON_MAP[name]
  if (!Icon) return null
  return <Icon size={size ?? 18} stroke={1.8} style={{ flexShrink: 0 }} />
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function contrastColor(hex: string): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? 'var(--bg)' : '#fff'
}

function GroupTag({ label, color }: { label: string; color?: string }) {
  const bg = color ?? 'var(--text-muted)'
  const text = color ? contrastColor(color) : 'var(--bg)'
  return (
    <span
      style={{
        position: 'absolute',
        bottom: -4,
        right: -4,
        fontSize: 9,
        fontWeight: 600,
        fontFamily: 'var(--sans)',
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color: text,
        background: bg,
        padding: '1px 5px',
        borderRadius: 3,
        lineHeight: '14px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {label}
    </span>
  )
}

const contentStyle: React.CSSProperties = { position: 'relative', zIndex: 1, maxWidth: '100%', wordWrap: 'break-word', overflowWrap: 'anywhere', hyphens: 'auto' }

function StartNode({ data }: NodeProps<FlowNode>) {
  const color = data.props.color ?? 'var(--accent)'
  const o = styleOverrides(data, 'start')
  const isSketch = data.diagramStyle === 'sketch'
  const w = data.computedWidth ?? 170
  const h = data.computedHeight ?? 48

  return (
    <div
      style={{
        ...base,
        ...o.base,
        ...selectionOutline(data),
        ...connectingPulse(data),
        ...(isSketch
          ? { border: 'none', background: 'transparent', boxShadow: 'none' }
          : {
              borderRadius: o.borderRadius ?? 24,
              background: o.startFilled ? color : 'transparent',
              border: `${o.borderWidth}px solid ${color}`,
              color: o.startFilled ? 'var(--bg)' : color,
              fontWeight: o.startFilled ? 600 : 500,
              boxShadow: data.isActive && o.startFilled ? `0 0 0 3px ${color}` : o.startFilled ? 'none' : getBoxShadow(data),
            }),
        width: w,
        height: h,
      }}
    >
      <StepPulse data={data} />
      {isSketch && (
        <SketchShape
          shape="pill" width={w} height={h}
          seed={hashSeed(data.label)} stroke={color}
          fill={o.startFilled ? color : 'none'}
          fillStyle="solid"
          strokeWidth={o.borderWidth} roughness={o.roughness} bowing={o.bowing}
          borderRadius={o.borderRadius ?? 24}
        />
      )}
      <Handle type="source" position={sourcePos(data)} style={handleStyle} />
      {data.props.icon && <NodeIcon name={data.props.icon} />}
      <div style={contentStyle}>
        <EditableLabel
          label={data.label}
          isEditing={data.isEditing ?? false}
          onEditStart={data.onEditStart ?? (() => {})}
          onEditEnd={data.onEditEnd ?? (() => {})}
        />
      </div>
      {data.groupLabel && <GroupTag label={data.groupLabel.label} color={data.groupLabel.color} />}
    </div>
  )
}

function EndNode({ data }: NodeProps<FlowNode>) {
  const borderColor = getNodeColor(data)
  const o = styleOverrides(data, 'end')
  const isSketch = data.diagramStyle === 'sketch'
  const w = data.computedWidth ?? 170
  const h = data.computedHeight ?? 48

  return (
    <div
      style={{
        ...base,
        ...o.base,
        ...selectionOutline(data),
        ...connectingPulse(data),
        ...(isSketch
          ? { border: 'none', background: 'transparent', boxShadow: 'none' }
          : {
              borderRadius: o.borderRadius ?? 24,
              background: getNodeBg(data, o),
              border: `${o.borderWidth}px solid ${borderColor}`,
              boxShadow: getBoxShadow(data),
            }),
        width: w,
        height: h,
      }}
    >
      <StepPulse data={data} />
      {isSketch ? (
        <>
          <SketchShape
            shape="pill" width={w} height={h}
            seed={hashSeed(data.label)} stroke={borderColor}
            fill={getNodeBg(data, o)} fillStyle="hachure"
            strokeWidth={o.borderWidth} roughness={o.roughness} bowing={o.bowing}
            borderRadius={o.borderRadius ?? 24}
          />
          <SketchShape
            shape="pill" width={w - 6} height={h - 6}
            seed={hashSeed(data.label + '-inner')} stroke={borderColor}
            fill="none" strokeWidth={o.innerBorderWidth}
            roughness={o.roughness} bowing={o.bowing}
            borderRadius={(o.borderRadius ?? 24) - 3}
            offset={{ top: 3, left: 3 }}
          />
        </>
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 3,
            borderRadius: (o.borderRadius ?? 24) - 3,
            border: `${o.innerBorderWidth}px solid ${borderColor}`,
            pointerEvents: 'none',
          }}
        />
      )}
      <Handle type="target" position={targetPos(data)} style={handleStyle} />
      {data.props.icon && <NodeIcon name={data.props.icon} />}
      <div style={contentStyle}>
        <EditableLabel
          label={data.label}
          isEditing={data.isEditing ?? false}
          onEditStart={data.onEditStart ?? (() => {})}
          onEditEnd={data.onEditEnd ?? (() => {})}
        />
      </div>
      {data.groupLabel && <GroupTag label={data.groupLabel.label} color={data.groupLabel.color} />}
    </div>
  )
}

function ProcessNode({ data }: NodeProps<FlowNode>) {
  const o = styleOverrides(data, 'process')
  const isSketch = data.diagramStyle === 'sketch'
  const w = data.computedWidth ?? 170
  const h = data.computedHeight ?? 48

  return (
    <div
      style={{
        ...base,
        ...o.base,
        ...selectionOutline(data),
        ...connectingPulse(data),
        ...(isSketch
          ? { border: 'none', background: 'transparent', boxShadow: 'none' }
          : {
              borderRadius: o.borderRadius ?? 8,
              background: getNodeBg(data, o),
              border: `${o.borderWidth}px solid ${getNodeColor(data)}`,
              boxShadow: getBoxShadow(data),
            }),
        width: w,
        height: h,
      }}
    >
      <StepPulse data={data} />
      {isSketch && (
        <SketchShape
          shape="rectangle" width={w} height={h}
          seed={hashSeed(data.label)} stroke={getNodeColor(data)}
          fill={getNodeBg(data, o)} fillStyle="hachure"
          strokeWidth={o.borderWidth} roughness={o.roughness} bowing={o.bowing}
          borderRadius={o.borderRadius ?? 8}
        />
      )}
      <Handle type="target" position={targetPos(data)} style={handleStyle} />
      <Handle type="source" position={sourcePos(data)} style={handleStyle} />
      {data.props.icon && <NodeIcon name={data.props.icon} />}
      <div style={contentStyle}>
        <EditableLabel
          label={data.label}
          isEditing={data.isEditing ?? false}
          onEditStart={data.onEditStart ?? (() => {})}
          onEditEnd={data.onEditEnd ?? (() => {})}
        />
      </div>
      {data.groupLabel && <GroupTag label={data.groupLabel.label} color={data.groupLabel.color} />}
    </div>
  )
}

function IONode({ data }: NodeProps<FlowNode>) {
  const o = styleOverrides(data, 'io')
  const isSketch = data.diagramStyle === 'sketch'
  const w = data.computedWidth ?? 170
  const h = data.computedHeight ?? 48

  return (
    <div
      style={{
        ...base,
        ...o.base,
        ...selectionOutline(data),
        ...connectingPulse(data),
        ...(isSketch
          ? { border: 'none', background: 'transparent', boxShadow: 'none' }
          : {
              borderRadius: o.borderRadius ?? 4,
              background: getNodeBg(data, o),
              border: `${o.borderWidth}px solid ${getNodeColor(data)}`,
              boxShadow: getBoxShadow(data),
              transform: 'skewX(-12deg)',
            }),
        width: w,
        height: h,
      }}
    >
      <StepPulse data={data} />
      {isSketch && (
        <SketchShape
          shape="parallelogram" width={w} height={h}
          seed={hashSeed(data.label)} stroke={getNodeColor(data)}
          fill={getNodeBg(data, o)} fillStyle="hachure"
          strokeWidth={o.borderWidth} roughness={o.roughness} bowing={o.bowing}
        />
      )}
      <Handle type="target" position={targetPos(data)} style={handleStyle} />
      <Handle type="source" position={sourcePos(data)} style={handleStyle} />
      <span style={
        isSketch
          ? { display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative', zIndex: 1 }
          : { transform: 'skewX(12deg)', display: 'inline-flex', alignItems: 'center', gap: 6 }
      }>
        {data.props.icon && <NodeIcon name={data.props.icon} />}
        <span style={{ maxWidth: '100%', wordWrap: 'break-word', overflowWrap: 'anywhere', hyphens: 'auto' }}>
          <EditableLabel
            label={data.label}
            isEditing={data.isEditing ?? false}
            onEditStart={data.onEditStart ?? (() => {})}
            onEditEnd={data.onEditEnd ?? (() => {})}
          />
        </span>
      </span>
      {data.groupLabel && <GroupTag label={data.groupLabel.label} color={data.groupLabel.color} />}
    </div>
  )
}

function DecisionNode({ data }: NodeProps<FlowNode>) {
  const borderColor = getNodeColor(data)
  const nodeWidth = data.computedWidth ?? 170
  const nodeHeight = data.computedHeight ?? 68
  const o = styleOverrides(data, 'decision')
  const isSketch = data.diagramStyle === 'sketch'

  const diamondSize = Math.min(nodeWidth, nodeHeight)
  const halfDiamond = diamondSize / 2

  return (
    <div
      style={{
        width: nodeWidth,
        height: nodeHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        ...selectionOutline(data),
        ...connectingPulse(data),
      }}
    >
      <StepPulse data={data} shape="diamond" />
      <Handle type="target" position={targetPos(data)} style={{ ...handleStyle, [data.direction === 'LR' ? 'left' : 'top']: 0 }} />
      {isSketch ? (
        <SketchShape
          shape="diamond" width={nodeWidth} height={nodeHeight}
          seed={hashSeed(data.label)} stroke={borderColor}
          fill={getNodeBg(data, o)} fillStyle="hachure"
          strokeWidth={o.borderWidth} roughness={o.roughness} bowing={o.bowing}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            width: diamondSize,
            height: diamondSize,
            transform: 'rotate(45deg)',
            border: `${o.borderWidth}px solid ${borderColor}`,
            background: getNodeBg(data, o),
            borderRadius: o.diamondRadius,
            transition: 'box-shadow 0.3s, border-color 0.3s, background 0.3s',
            boxShadow: getBoxShadow(data),
            top: '50%',
            left: '50%',
            marginTop: -halfDiamond,
            marginLeft: -halfDiamond,
            pointerEvents: 'none',
          }}
        />
      )}
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'var(--sans)',
          ...o.base,
          color: 'var(--text)',
          maxWidth: nodeWidth * 0.7,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          textAlign: 'center' as const,
          whiteSpace: 'normal' as const,
          wordWrap: 'break-word' as const,
          overflowWrap: 'anywhere' as const,
          hyphens: 'auto' as const,
          lineHeight: 1.4,
        }}
      >
        {data.props.icon && <NodeIcon name={data.props.icon} />}
        <EditableLabel
          label={data.label}
          isEditing={data.isEditing ?? false}
          onEditStart={data.onEditStart ?? (() => {})}
          onEditEnd={data.onEditEnd ?? (() => {})}
        />
      </span>
      <Handle type="source" position={sourcePos(data)} style={{ ...handleStyle, [data.direction === 'LR' ? 'right' : 'bottom']: 0 }} />
      {data.groupLabel && <GroupTag label={data.groupLabel.label} color={data.groupLabel.color} />}
    </div>
  )
}

function GroupNode({ data }: NodeProps<FlowNode>) {
  const o = styleOverrides(data, 'group')
  const isSketch = data.diagramStyle === 'sketch'
  const w = data.computedWidth ?? 160
  const h = data.computedHeight ?? 80
  const color = data.props.color
  const borderColor = color ?? 'var(--text-muted)'
  const bgAlpha = data.isActive ? 0.2 : data.isVisited ? 0.16 : 0.12
  const bgColor = color ? hexToRgba(color, bgAlpha) : data.isActive ? 'var(--highlight-bg)' : data.isVisited ? 'var(--bg-alt)' : 'var(--bg-alt)'
  const labelColor = color ?? 'var(--text-muted)'
  const borderStyle = data.isActive ? 'dashed' : 'dotted'
  const boxShadow = data.isActive ? `0 0 0 2px ${hexToRgba(color ?? '#6b7280', 0.25)}` : 'none'

  return (
    <div
      style={{
        width: w,
        height: h,
        ...(isSketch
          ? {}
          : {
              border: `${o.borderWidth}px ${borderStyle} ${borderColor}`,
              borderRadius: o.borderRadius ?? 12,
              background: bgColor,
              boxShadow,
            }),
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        padding: '6px 12px',
        boxSizing: 'border-box',
        position: 'relative',
        transition: 'background 0.3s, border-color 0.3s, box-shadow 0.3s',
      }}
    >
      {isSketch && (
        <SketchShape
          shape="dotted-rect" width={w} height={h}
          seed={hashSeed(data.label)} stroke={borderColor}
          fill={bgColor} fillStyle="solid"
          strokeWidth={data.isActive ? o.borderWidth + 1 : o.borderWidth} roughness={0.8} bowing={1}
          borderRadius={o.borderRadius ?? 12}
        />
      )}
      <Handle type="target" position={targetPos(data)} style={handleStyle} />
      <Handle type="source" position={sourcePos(data)} style={handleStyle} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'var(--sans)',
          ...o.base,
          color: labelColor,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {data.label}
      </span>
    </div>
  )
}

export { StartNode, EndNode, ProcessNode, IONode, DecisionNode, GroupNode, ICON_MAP }
export type { FlowNodeData, FlowNode }
