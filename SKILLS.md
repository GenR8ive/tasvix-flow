# SKILLS â€” authoring `tasvix-flow` diagrams

Agent-facing reference for writing DSL that parses and simulates correctly, and for wiring the package into React. Read this before generating flow text.

Companion to [README.md](./README.md).

---

## 1. Grammar cheat sheet

```text
file        := line*
line        := edgeChain | varDecl | groupDecl
edgeChain   := segment ( "->" segment )*
segment     := head [ "(" condition ")" ] [ "{" props "}" ]
head        := [ type ":" ] id          | "start" | "end"
type        := start | end | process | decision | io
id          := \w+                      (letters, digits, underscore)
props       := prop ( "," prop )*
prop        := key ":" value | key ":" "quoted value"
varDecl     := "var:" name [ "{" props "}" ] "=" initValue
initValue   := value ( "|" value )*      (enum, first value = initial)
groupDecl   := "group:" id [ "{" props "}" ]
```

Rules the parser enforces:

- Conditions `(...)` only on the **first** segment of a chain.
- Node ids are `\w+`; type must be one of the five known types; conflicting types for one id are an error.
- Prop values with spaces, commas, or `->` **must** be double-quoted.
- Every line either parses or produces `{ line, message }` â€” no silent skips.
- A segment whose id equals a declared group id is treated as the group, not a node.

## 2. Minimal valid flows

Linear:

```
start -> process:work{label:Work} -> end
```

Branch:

```
start
start -> decision:approve{condition:score >= 60, label:Approved?}
approve(true)  -> io:ship{label:Ship}
approve(false) -> io:reject{label:Reject}
ship  -> end
reject -> end
```

With state:

```
var:score{label:Score} = 42
var:phase{label:Phase} = idle | running | done

start -> process:run{action:"phase = 'running'; score += 10"}
run -> decision:pass{condition:score >= 60}
pass(true)  -> process:done{label:Complete, action:"phase = 'done'"}
pass(false) -> run
done -> end
```

Grouped (container):

```
group:ci{label:"CI", color:#3b82f6}
start -> process:lint{in:ci, icon:check} -> process:test{in:ci, icon:search} -> end
```

Group as a routing hub (runtime passes through, follows its first outgoing edge):

```
group:hub
start -> hub -> process:after{label:After} -> end
```

## 3. Recipes

| Goal | Pattern |
| --- | --- |
| Loop until condition | `retry -> decision:d{condition:n < 3}` + `d(true) -> retry` + `n += 1` in `retry`'s `action` |
| Counter in label | `label:"Attempt <<n>> of 3"` or `label:"Attempt ${n + 1}"` |
| Parallel fan-out | One line per branch: `split -> a`, `split -> b`, then `a -> join`, `b -> join` |
| State machine | `var:phase = a \| b \| c`, decision keyed on `phase`, actions assign `phase` |
| Two-way on a variable | Name the decision after the variable: `decision:ok{condition:ok}` works, or just use `ok` as the id |
| Terminal success / failure | Distinct `io:` nodes with `icon:check` / `icon:x`, both -> `end` |
| Re-run forever | `mode="repeat"` (component) or `setMode('repeat')` (hook) â€” store reinitializes each lap |

## 4. Simulation model (what actually happens)

Per step, from the currently highlighted node `X`:

1. Run `X`'s `action` (statements split on `;`, applied in order).
2. Pick the outgoing edge:
   - `X` is `decision` â†’ evaluate `X`'s `condition` prop (fallback: a store variable named `X`), take the edge whose condition `String()`-equals the result; otherwise first edge.
   - any other type â†’ edge with condition `true`, else first edge.
3. If the target is a group, follow its first outgoing edge (repeat for nested groups, cycle-guarded).
4. Highlight moves; the edge animates.
5. `end` â†’ no outgoing edge â†’ run stops (`once`) or store resets and it starts again (`repeat`).

Consequences worth designing around:

- `start`'s `action` runs on the **first** step; `end`'s `action` never runs.
- Conditions see the store **after** the node's action â€” `action:"score += 10"` then `condition:score >= 60` behaves as expected.
- Non-decision nodes with several outgoing edges silently take the first one. If you need branching, type the node `decision`.
- Missing variables read as `0`, unknown labels fall back to the node id â€” typos fail soft, not loudly.

## 5. Expression language

```text
literals   42  3.5  "text"  'text'  true  false
vars       any identifier  (unknown â†’ 0)
operators  +  -  *  /  %            ( / or % by 0 â†’ 0 )
compare    <  >  <=  >=  ==  !=   ( "=" also compares in expressions )
assign     =  +=  -=   x++  x--    (statement position only, e.g. inside action)
grouping   ( )
concat     + when either side is a string
interpolate  ${expr}   <<expr>>    (label / io text)
```

**Quoting in prop values.** A `"â€¦"` prop value ends at the first `"` â€” there are no escape sequences, and a value that fails to match falls back to being taken literally (quotes included). Verified behavior:

```
action:"phase = 'running'"      âœ… value: phase = 'running'
action:"phase = \"running\""    âŒ value keeps the quotes, action misparses
```

So: string literals inside `action` / `condition` / labels use **single** quotes; the prop itself uses double quotes. Host-language escaping applies too â€” in a TS template literal write `action:"phase = 'running'"` verbatim, no extra backslashes.

## 6. Authoring pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Missing target after '->'` | Trailing arrow, or label contains an unquoted `->` | Quote the label: `label:"a -> b"` |
| `Invalid node expression` | Unquoted value with space/comma, bad head | `label:"Do the thing"` |
| `Invalid node type` | Typos like `dec:`, `task:` | `decision:`, `process:` |
| `Type conflict` | Same id typed `process:x` and `decision:x` | Type once, early |
| `Conditions are only allowed on the source node` | `a -> b(ok) -> c` | Move `(ok)` onto `a` |
| Group rendered as a box around nothing | `in:` id not declared | Add `group:id{...}` line |
| Group id drawn as a node | Group declared *after* it is referenced in a chain | Declare groups first |
| Branch always takes first edge | Node not a `decision` | Add `decision:` prefix |
| Branch always takes first edge | Condition mismatch (`"yes"` vs `1`) | Match edge condition text to the evaluated result exactly |
| Nothing runs | Missing `start` node | Begin with a `start` segment |
| `action` did nothing / var holds stray quotes | `\"` inside a quoted prop value | Use single quotes: `action:"x = 'done'"` |
| Diagram has no height | Wrapper has no height | `style={{ height: 560 }}` on the parent |

## 7. Integration snippets

Component (recommended):

```tsx
import { useRef } from 'react'
import { TasvixFlow, type TasvixFlowHandle } from 'tasvix-flow'
import 'tasvix-flow/style.css'

export function Demo({ dsl }: { dsl: string }) {
  const ref = useRef<TasvixFlowHandle>(null)
  return (
    <div style={{ height: 560 }}>
      <TasvixFlow
        ref={ref}
        dsl={dsl}
        direction="LR"
        controls
        speed={0.6}
        mode="once"
        cameraMode="follow"
        onStepChange={(id, i) => console.log(i, id)}
        onError={(errs) => console.error(errs)}
      />
    </div>
  )
}
```

Bring your own state:

```tsx
import { useFlowRuntime, FlowDiagram } from 'tasvix-flow'

function Custom({ dsl }: { dsl: string }) {
  const rt = useFlowRuntime({ dsl, speed: 0.5 })
  if (!rt.result) return null
  if (!rt.result.ok) return <pre>{rt.result.errors.map(e => `L${e.line}: ${e.message}`).join('\n')}</pre>

  return (
    <div style={{ height: 560 }}>
      <FlowDiagram
        graph={rt.graph!}
        currentStep={rt.currentStep}
        stepIndex={rt.stepIndex}
        activeEdge={rt.activeEdge}
        nextEdgeId={rt.nextEdgeId}
        visitedNodes={rt.visitedNodes}
        traversedEdges={rt.traversedEdges}
        cameraMode="follow"
        direction="TB"
      />
      <button onClick={rt.run}>{rt.running ? 'Stop' : 'Run'}</button>
      <button onClick={rt.step} disabled={!rt.canStep}>Step</button>
      <button onClick={rt.reset}>Reset</button>
      <span>{JSON.stringify(rt.varStore)}</span>
    </div>
  )
}
```

Validate before rendering:

```ts
import { parse } from 'tasvix-flow'

const res = parse(dsl)
if (!res.ok) showErrors(res.errors) // [{ line, message }]
```

## 8. Output checklist

Before returning generated DSL:

- [ ] Exactly one `start`, at least one `end`.
- [ ] Every `decision:` node: has a `condition` prop **or** an identically named variable, and one outgoing edge per expected value.
- [ ] Conditions only on the first segment of each chain.
- [ ] Prop values with spaces/commas/`->` are double-quoted.
- [ ] Groups declared before any chain references them; every `in:` matches a declared group.
- [ ] Loops have a guard (counter `action` + condition) so `mode="once"` terminates.
- [ ] String literals inside `action`/`condition` use single quotes; no `\"` inside prop values.
- [ ] Rendered in a container with explicit height; `tasvix-flow/style.css` imported once.
