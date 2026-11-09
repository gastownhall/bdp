# graph/capability

Body of the capability-beads node — callables and event sources.

```
all {
  /// title: Callable mechanism — call, function/command/formula, 200/202
  callables: after(core/primitives, dsls/callable)
  /// title: EventSource mechanism — pull, dual-mode delivery, retention
  event-source: after(core/views, dsls/eventsource)
}
```
