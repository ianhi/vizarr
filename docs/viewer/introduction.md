---
title: Quick start
---


### Getting started

## Installation


```
npm install @biongff/vizarr
```

## Basic Usage

```
import { Vizarr } from '@biongff/vizarr'

function App() {

const sources = ["https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.5/idr0062A/6001240_labels.zarr"]

return(
  <Vizarr
    sources={sources}
    viewState={viewState}
/>
)
}


```

## Custom stores and per-image settings

`sources` covers urls read over HTTP with default settings. Pass `imageConfigs`
instead to read through a zarrita store of your own — an Icechunk repository, say —
or to set a name, channel colors, or contrast limits up front. These are the same
`ImageLayerConfig` objects that `createViewer().addImage()` accepts:

```
import { Vizarr, type ImageLayerConfig } from '@biongff/vizarr'
import { IcechunkStore } from 'icechunk-js'

function App() {

const [imageConfigs, setImageConfigs] = useState<ImageLayerConfig[]>([])

useEffect(() => {
  IcechunkStore.open("https://example.com/my-repo", { branch: "main" }).then((store) =>
    setImageConfigs([{ source: store, name: "my image" }]),
  )
}, [])

return <Vizarr imageConfigs={imageConfigs} viewState={viewState} />
}
```

A store only has to satisfy zarrita's `Readable` interface: a `get(key)` that returns
the bytes at that key, or `undefined` when the key is absent, plus an optional
`getRange(key, range)`.

The store is opened at its root, so scope it to the image group before passing it.
`IcechunkStore`, for instance, has a `resolve(path)` that returns a store rooted at
`path`.

### Adapting a store that reports a miss differently

The example above uses [icechunk-js](https://github.com/EarthyScience/icechunk-js),
whose store already satisfies `Readable`. The official Rust bindings,
[@earthmover/icechunk](https://github.com/earth-mover/icechunk/tree/main/icechunk-js),
return `null` for a key that is absent rather than `undefined`, so wrap that store
before passing it:

```
import { Repository } from '@earthmover/icechunk'

const repo = await Repository.open(storage)
const { store } = await repo.readonlySession({ branch: "main" })

const source = {
  get: async (key, opts) => (await store.get(key, opts)) ?? undefined,
  getRange: async (key, range, opts) => (await store.getRange(key, range, opts)) ?? undefined,
}

setImageConfigs([{ source, name: "my image" }])
```

Give the wrapper a `getRange` only if the underlying store has one: zarrita reads its
presence as a promise of byte-range support.

`imageConfigs` takes precedence over `sources`; pass one or the other. Both are
re-read whenever their contents change, so a store that arrives from an async open
loads as soon as you set it.
