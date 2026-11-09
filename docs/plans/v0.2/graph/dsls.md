# graph/dsls

Body of the authoring-DSLs node — owner Eva. The surfaces the spec is written in.

```
all {
  /// title: Markdown JSON Schema v0.7 — readable surface, codec, fixtures
  json-schema
  /// title: BLL and markdown-plan
  bll
  /// title: Type definition format
  type-def: after(json-schema)
  /// title: Callable declaration format
  callable: after(json-schema, type-def)
  /// title: EventSource declaration format
  eventsource: after(json-schema, type-def)
}
```
