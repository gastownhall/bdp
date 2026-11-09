# graph/identity

Body of the identity-and-annotation node.

```
all {
  /// title: Aliases — alias, unalias, isalias, and resolution
  aliases: after(capability/callables)
  /// title: Owned links, pinned references, link identity
  links: after(core/data-model)
  /// title: Comments and annotations — beads plus annotation links
  annotations: after(links)
}
```
