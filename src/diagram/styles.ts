import type { CSSProperties } from 'react'

export type DiagramStyle = 'standard' | 'sketch'

/** Path shape for edges: smooth curve, single direct line, or routed polyline. */
export type EdgeShape = 'curve' | 'straight' | 'polyline'

/** Palette overrides mapped onto the diagram's CSS custom properties. */
export interface FlowColors {
  accent?: string
  border?: string
  background?: string
  backgroundAlt?: string
  highlight?: string
  text?: string
  textStrong?: string
  textMuted?: string
}

/** CSS custom properties for `colors`; undefined keys fall back to host theme vars. */
export function colorVars(colors?: FlowColors): Record<string, string> {
  if (!colors) return {}
  const vars: Record<string, string> = {}
  if (colors.accent) vars['--accent'] = colors.accent
  if (colors.border) vars['--border'] = colors.border
  if (colors.background) vars['--bg'] = colors.background
  if (colors.backgroundAlt) vars['--bg-alt'] = colors.backgroundAlt
  if (colors.highlight) vars['--highlight-bg'] = colors.highlight
  if (colors.text) vars['--text'] = colors.text
  if (colors.textStrong) vars['--text-h'] = colors.textStrong
  if (colors.textMuted) vars['--text-muted'] = colors.textMuted
  return vars
}


export interface NodeStyleResult {
  base: CSSProperties
  borderRadius: number | undefined
  borderWidth: number
  borderStyle: CSSProperties['borderStyle']
  background: string | ((active: boolean, visited: boolean) => string) | undefined
  color: string | undefined
  startFilled: boolean
  innerBorderWidth: number
  diamondRadius: number
  roughness?: number
  bowing?: number
}

export interface EdgeStyleResult {
  defaultStroke: string
  defaultWidth: number
  traversedWidth: number
  strokeLinecap: CSSProperties['strokeLinecap']
  labelFont: CSSProperties
  labelBg: CSSProperties
}

export function getNodeStyleOverrides(
  variant: DiagramStyle,
  nodeType: 'start' | 'end' | 'process' | 'io' | 'decision' | 'group',
): NodeStyleResult {
  switch (variant) {
    case 'sketch':
      return {
        base: {
          fontFamily: '"Caveat", cursive',
          fontSize: 15,
          fontWeight: 600,
        },
        borderRadius: nodeType === 'group' ? 16 : 12,
        borderWidth: 2.5,
        borderStyle: 'solid',
        background: undefined,
        color: undefined,
        startFilled: true,
        innerBorderWidth: 1.5,
        diamondRadius: 8,
        roughness: 1.2,
        bowing: 2,
      }
    default:
      return {
        base: {},
        borderRadius: undefined,
        borderWidth: 2,
        borderStyle: 'solid',
        background: undefined,
        color: undefined,
        startFilled: true,
        innerBorderWidth: 1.5,
        diamondRadius: 6,
      }
  }
}

export function getEdgeStyleOverrides(variant: DiagramStyle): EdgeStyleResult {
  switch (variant) {
    case 'sketch':
      return {
        defaultStroke: 'var(--text-muted)',
        defaultWidth: 2,
        traversedWidth: 3,
        strokeLinecap: 'round',
        labelFont: { fontFamily: '"Caveat", cursive', fontSize: 14, fontWeight: 500 },
        labelBg: { borderRadius: 8, border: '1.5px dashed var(--border)', boxShadow: 'none' },
      }
    default:
      return {
        defaultStroke: 'var(--border)',
        defaultWidth: 1.5,
        traversedWidth: 2.5,
        strokeLinecap: undefined,
        labelFont: {},
        labelBg: {},
      }
  }
}

export function getBackgroundConfig(variant: DiagramStyle): { gap: number; size: number } {
  switch (variant) {
    case 'sketch': return { gap: 24, size: 1.5 }
    default: return { gap: 20, size: 1 }
  }
}
