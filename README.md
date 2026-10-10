# tasvix-flow

Executable flow diagrams for React. One text DSL in, one interactive diagram out: parse â†’ simulate â†’ render.

- **DSL parser** â€” line-oriented text describing nodes, edges, variables, groups.
- **Simulation runtime** â€” steps through the graph, runs node actions, evaluates branch conditions, keeps a variable store.
- **Renderer** â€” dagre layout + React Flow, with standard/sketch styles, camera follow, group containers, and edge routing.

```
npm i tasvix-flow
```

Peer deps: `react` / `react-dom` `^18 || ^19`. ESM only (`"type": "module"`).

## Quick start

```tsx
import { useRef } from 'react'
import { TasvixFlow, type TasvixFlowHandle } from 'tasvix-flow'
import 'tasvix-flow/style.css'

const dsl = `
var:attempts{label:Attempts} = 0
var:state{label:State} = idle | running | done

group:core{label:"Core path", color:"var(--accent)"}

start{label:Start}
start -> process:work{label:"Do work", in:core, action:"attempts += 1; state = 'running'"}
work -> decision:ok{condition:attempts >= 3, label:"Enough attempts?"}
ok(true)  -> io:result{label:Persist, icon:database}
ok(false) -> work
result -> end{label:Done}
`

export function Flow() {
  const ref = useRef<TasvixFlowHandle>(null)

  return (
    <div style={{ height: 560 }}>
      <TasvixFlow ref={ref} dsl={dsl} controls direction="LR" speed={0.8} />
    </div>
  )
}
```

The container must have a height â€” the diagram fills `100%` of it.

## DSL reference

A file is a list of lines. Blank lines ignored. Four line kinds:

| Kind | Syntax | Notes |
| --- | --- | --- |
| Edge chain | `a -> b -> c` | Creates nodes (if new) and the edges between adjacent segments |
| Variable | `var:name{label:Label} = value` | `\|`-separated values make an enum, first is the initial value |
| Group | `group:id{label:Label, color:#f00}` | Declared before use |
| Comment / free text | anything that fails to parse | Reported as a line-numbered parse error |

### Node expressions

A segment of an edge chain is one of:

| Form | Meaning |
| --- | --- |
| `start`, `end` | Reserved ids, typed automatically |
| `id` | Node id; defaults to `process` type |
| `type:id` | Explicit type: `start` \| `end` \| `process` \| `decision` \| `io` |
| `id(cond)` | Edge leaving `id` carries condition `cond` |
| `type:id(cond)` | Both |
| any form `head{key:value, key:"quoted value"}` | Props |

Props (comma separated, quotes required for spaces or commas):

> There are **no escape sequences** inside a `"â€¦"` prop value â€” it ends at the first `"`. To put a string literal inside an `action`, use single quotes: `action:"state = 'running'"`. Quote labels that contain `->` or `,`.

| Prop | Used by | Effect |
| --- | --- | --- |
| `label` | all | Node text. Defaults to the id. Supports `${expr}` / `<<expr>>` interpolation |
| `icon` | all | Tabler icon name, see [icons](#icons) |
| `color` | all | Border/fill color (hex, `var(--â€¦)`), also drives group tag color |
| `in` | all | Id of the group this node belongs to |
| `action` | all | Statements run when the node is left: `count += 1; state = "done"` |
| `condition` | `decision` | Expression evaluated to choose the outgoing edge |

Examples:

```
process:build{label:"Build", icon:settings, in:ci, color:#3b82f6}
io:report{label:"<<state>> report", icon:file}
decision:d{condition:score > 100}
d(true) -> fast
d(false) -> slow
```

### Expression language

Used by `action`, `condition`, and label interpolation.

- Literals: `42`, `3.5`, `"text"` / `'text'`, `true`, `false`
- Identifiers resolve against the variable store (missing â†’ `0`)
- Operators: `+ - * / %`, comparisons `< > <= >= == !=` (`=` also compares inside expressions)
- Assignment (statement position only): `=`, `+=`, `-=`, and `x++` / `--x`
- Grouping with `(` `)`; `+` concatenates when either side is a string
- Division/modulo by zero yields `0`
- Interpolation in labels: `${attempts + 1}` or `<<state>>`

### Semantics of a step

1. The runtime is on node `X` (initially `start`).
2. `X`'s `action` runs against the store.
3. Outgoing edges of `X` are considered:
   - `X` is a `decision`: evaluate `condition` prop (or the variable named `X` if it exists in the store), then take the edge whose condition string-equals the result. No match â†’ first edge.
   - otherwise: take the edge with condition `true`, else the first edge.
4. If the target is a group, the runtime follows the group's first outgoing edge (passthrough).
5. Highlight moves to the target; the next step repeats from there. `end` stops.

Run modes: `once` (stop at the end) or `repeat` (reset the store and start over). `speed` is seconds per step.

## API

### `<TasvixFlow>` â€” the whole thing

```tsx
import { TasvixFlow, type TasvixFlowHandle } from 'tasvix-flow'
import 'tasvix-flow/style.css'
```

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `dsl` | `string` | | DSL source, parsed internally |
| `result` | `ParseResult \| null` | | Pre-parsed result; wins over `dsl` |
| `direction` | `'TB' \| 'LR'` | `'TB'` | Layout direction |
| `cameraMode` | `'free' \| 'follow'` | `'free'` | Follow the current step |
| `cameraDuration` | `number` | | Camera animation ms |
| `diagramStyle` | `'standard' \| 'sketch'` | `'standard'` | Sketch = rough.js hand-drawn |
| `edgeShape` | `'curve' \| 'straight' \| 'polyline'` | `'polyline'` | Edge path shape |
| `groupView` | `'containers' \| 'tags' \| 'hidden'` | `'containers'` | How groups render |
| `colors` | `FlowColors` | | Palette overrides (below) |
| `speed` | `number` | `1` | Seconds per step |
| `mode` | `'once' \| 'repeat'` | `'once'` | Behavior at the end |
| `controls` | `boolean` | `false` | Run / step / reset bar |
| `containerClassName` / `containerStyle` | | | Wrapper styling |
| `emptyState` | `ReactNode` | error list / "No diagram yet" | Rendered when there is no graph |
| `onStepChange` | `(currentStep, stepIndex) => void` | | |
| `onRunEnd` | `() => void` | | Auto-run finished or stopped |
| `onError` | `(errors: ParseError[]) => void` | | Fires once per distinct error set |
| `onNodeClick` | `(id: string) => void` | | |

Ref handle:

```ts
interface TasvixFlowHandle {
  step(): void
  run(): void
  stop(): void
  reset(): void
  fitView(): void
  getGraph(): FlowGraph | null
  getRuntime(): FlowRuntime
}
```

### `useFlowRuntime` â€” simulation without the component

```tsx
import { useFlowRuntime } from 'tasvix-flow'

const rt = useFlowRuntime({ dsl, speed: 0.5, mode: 'repeat' })
// rt.result, rt.graph, rt.currentStep, rt.stepIndex, rt.visitedNodes,
// rt.traversedEdges, rt.activeEdge, rt.nextEdgeId, rt.varStore,
// rt.running, rt.canStep, rt.step(), rt.run(), rt.stop(), rt.reset()
```

Options: `{ dsl?, result?, speed?, mode? }`. `graph` has labels interpolated against `varStore`.

### Headless (no React)

```ts
import { parse, initStore, executeAction, evaluateExpr, interpolate } from 'tasvix-flow'

const res = parse('start -> decision:d{condition:x > 1} -> end')
if (res.ok) {
  const store = initStore(res.graph.vars)      // {} when no vars
  const next = executeAction('x += 2', store)  // returns a new store
  const ok = evaluateExpr('x > 1', next)       // boolean
  const label = interpolate('total ${x}', next)
} else {
  console.log(res.errors) // [{ line, message }]
}
```

### `<FlowDiagram>` â€” renderer only

Takes a `FlowGraph` plus simulation state (`currentStep`, `visitedNodes`, `traversedEdges`, `activeEdge`, `nextEdgeId`, â€¦) and renders it. Use when you own the runtime. Extras over `TasvixFlow`: `labelOverrides`, `selectedNodeId`, `connectingFromId`, `onPaneClick`, `onStartConnection`, `onNodeLabelChange`, `containerRef`. Ref handle: `fitView()`, `getExportData(padding?)`.

### Layout & style helpers

- `computeLayout(graph, direction?, groupContainers?, maxRankWidth?)` â†’ `{ positions, edgePaths, nodeDimensions, groupRects }`
- `buildEdgePath(points, shape)` / `straightToPath` / `curveToPath` / `pointsToPath`
- `getNodeStyleOverrides`, `getEdgeStyleOverrides`, `getBackgroundConfig`
- `colorVars(colors)` â†’ CSS custom properties (`--accent`, `--border`, `--bg`, `--bg-alt`, `--highlight-bg`, `--text`, `--text-h`, `--text-muted`)
- `ICON_MAP` â€” icon name â†’ component

## Theming

```tsx
<TasvixFlow
  dsl={dsl}
  colors={{
    accent: '#6366f1',
    border: '#27272a',
    background: '#0b0b0f',
    backgroundAlt: '#111116',
    highlight: '#1e1b4b',
    text: '#d4d4d8',
    textStrong: '#fafafa',
    textMuted: '#71717a',
  }}
  diagramStyle="sketch"
  edgeShape="curve"
/>
```

Undefined keys fall back to the host theme's CSS variables, so the diagram adapts to your app's palette automatically.

## Icons

`icon:` accepts these Tabler names:

`player-play`, `player-stop`, `login`, `logout`, `arrow-right`, `check`, `x`, `alert-triangle`, `database`, `cloud-upload`, `cloud-download`, `search`, `settings`, `user`, `mail`, `shield-check`, `lock`, `file`, `download`, `upload`, `trash`, `edit`, `plus`, `minus`, `refresh`, `copy`, `external-link`, `code`, `terminal`, `git-branch`, `rocket`, `heart`, `star`, `flag`, `clock`, `calendar`, `bell`, `desktop`, `mobile`, `globe`, `wifi`, `link`, `photo`, `function`, `filter`, `list`, `template`, `transform`, `tree`

## Parse errors

`parse` returns `{ ok: false, errors: [{ line, message }] }` â€” never throws. `<TasvixFlow>` renders the list and calls `onError`. Common messages:

| Message | Fix |
| --- | --- |
| `Missing target after '->'` | Trailing arrow |
| `Invalid node expression: "â€¦"` | Malformed id/type/props (check quotes) |
| `Invalid node type: 'x'` | Use `start` \| `end` \| `process` \| `decision` \| `io` |
| `Type conflict for 'x'` | Same id typed two different ways |
| `Conditions are only allowed on the source node` | Put `(cond)` on the first segment of the chain only |

## Development

```bash
npm install
npm run dev         # tsup --watch
npm run build       # tsup + tsc declarations
npm run typecheck   # tsc --noEmit
```

Publishing is CI-driven: bump `package.json` version and push to `main`; `.github/workflows/publish.yml` publishes with OIDC trusted publishing and tags `vX.Y.Z`. Already-published versions are skipped.

## Package layout

```
src/
  core/      parser.ts, evaluate.ts, types.ts   DSL + expression evaluator
  runtime/   useFlowRuntime.ts                  simulation hook
  diagram/   FlowDiagram.tsx, layout.ts, nodes.tsx, styles.ts, edgePath.ts, sketch.tsx
  TasvixFlow.tsx                                all-in-one component
  index.ts                                      public exports
```
