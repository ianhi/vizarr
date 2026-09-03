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

## Caching

Two caches sit between the screen and the store, and they hold different things.

deck.gl keeps **decoded tiles** for a multiscale image, by default five times as many
as the viewport needs. This is the cache that decides whether returning to a region
costs anything, and `tileCacheSize` sets it in tiles:

```
<Vizarr imageConfigs={imageConfigs} tileCacheSize={500} />
```

Behind it, a url source caches the **bytes it read**, keyed by chunk and metadata
document, 100 reads by default. This is what a tile-cache miss falls back to, so
raising it turns a re-read into a memory hit rather than a request. A store you pass
in is read as given, so this applies to url sources only. Set it for one image with
`cache_size` in its config, or for all of them with the `cacheSize` prop:

```
<Vizarr imageConfigs={[{ source: store, cache_size: 2000 }]} />
```

A chunk is held whole, so budget with the chunk size in mind: 100 chunks of 256x256
uint8 is about 6 MB, while 100 chunks of 512x512 uint16 is 50 MB.

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
