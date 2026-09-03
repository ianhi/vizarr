import { Box, Link, ThemeProvider, Typography } from "@mui/material";
import type { Layer } from "deck.gl";
import { type PrimitiveAtom, Provider, atom, useAtomValue, useSetAtom } from "jotai";
import React, { useId } from "react";
import { getSourceDataError, sourceDataValid, writeUserErrorMessage } from "../error";
import { ViewStateContext, useViewState } from "../hooks";
import { createSourceData } from "../io";
import {
  type ImageLayerConfig,
  type ViewState,
  type ViewportSize,
  currentImageBoundsAtom,
  currentTInfoAtom,
  currentZInfoAtom,
  redirectObjAtom,
  setTSliceAtom,
  setZSliceAtom,
  sourceErrorAtom,
  sourceInfoAtom,
  sourceWarningAtom,
  tileCacheSizeAtom,
  viewStateAtom,
  viewportAtom,
} from "../state";
import theme from "../theme";
import Menu from "./Menu";
import { InfoSnackbar } from "./Snackbar";
import Viewer from "./Viewer";

/** Viewer state snapshot exposed to the host application via onViewerStateChange. */
export interface ViewerInfo {
  /** URL of the first source; empty when it is a store rather than a url, or when there are no sources. */
  sourceUrl: string;
  imageBounds: { xMin: number; yMin: number; xMax: number; yMax: number; spatialUnit: string } | null;
  zInfo: { zValue: number; zMax: number } | null;
  tInfo: { tValue: number; tMax: number } | null;
  viewport: ViewportSize | null;
  setViewState: (vs: ViewState) => void;
  setZSlice: (z: number) => void;
  setTSlice: (t: number) => void;
}

export interface VizarrViewerProps {
  /**  Source image urls*/
  sources?: string[];
  /**
   * Fully specified image layers. A config's `source` may be a zarrita store
   * rather than a url, so a host application can supply its own reader.
   * Takes precedence over `sources`.
   */
  imageConfigs?: ImageLayerConfig[];
  /**
   * How many reads to cache per image, in chunks and metadata documents. Applies to
   * every image that does not set its own `cache_size`. See `ImageLayerConfig`.
   */
  cacheSize?: number;
  /**
   * How many decoded tiles to keep per multiscale image. Defaults to five times what
   * the viewport needs, which is enough that returning to a region does not re-read
   * it; raise it to keep more of a large image resident.
   */
  tileCacheSize?: number;
  /** View state of the viewer*/
  viewState?: ViewState;
  /** Callback to execute side effects when view state changes */
  onViewStateChange?: (viewState: ViewState) => void;
  onViewerStateChange?: (info: ViewerInfo) => void;
  additionalLayers?: Layer[];
  pluginCursor?: string;
  onPluginClick?: (coordinate: [number, number]) => boolean;
  onPluginHover?: (coordinate: [number, number] | null) => void;
  children?: React.ReactNode;
}

/**
 * Internal component that lives inside the jotai Provider + ViewStateContext.
 * It reads viewer atoms, notifies the host of viewer state changes,
 * and renders <Menu/> + <Viewer/> + children.
 */
function ViewerBridge({
  sourceUrl,
  onViewStateChange,
  onViewerStateChange,
  additionalLayers = [],
  pluginCursor,
  onPluginClick,
  onPluginHover,
  children,
}: {
  sourceUrl: string;
  onViewStateChange?: (viewState: ViewState) => void;
  onViewerStateChange?: (info: ViewerInfo) => void;
  additionalLayers?: Layer[];
  pluginCursor?: string;
  onPluginClick?: (coordinate: [number, number]) => boolean;
  onPluginHover?: (coordinate: [number, number] | null) => void;
  children?: React.ReactNode;
}) {
  const imageBounds = useAtomValue(currentImageBoundsAtom);
  const zInfo = useAtomValue(currentZInfoAtom);
  const tInfo = useAtomValue(currentTInfoAtom);
  const viewport = useAtomValue(viewportAtom);
  const [, setViewState] = useViewState();

  const setZSlice = useSetAtom(setZSliceAtom);
  const setTSlice = useSetAtom(setTSliceAtom);

  const stableSetViewState = React.useCallback(
    (vs: ViewState) => {
      setViewState(vs);
    },
    [setViewState],
  );

  // Notify host application when viewer state changes
  React.useEffect(() => {
    onViewerStateChange?.({
      sourceUrl,
      imageBounds,
      zInfo,
      tInfo,
      viewport,
      setViewState: stableSetViewState,
      setZSlice,
      setTSlice,
    });
  }, [sourceUrl, imageBounds, zInfo, tInfo, viewport, stableSetViewState, setZSlice, setTSlice, onViewerStateChange]);

  return (
    <>
      <Menu />
      <Viewer
        additionalLayers={additionalLayers}
        pluginCursor={pluginCursor}
        onPluginClick={onPluginClick}
        onPluginHover={onPluginHover}
      />
      {children}
    </>
  );
}

/**
 * Turns `imageConfigs` and `sources` into one list of configs, and returns the same
 * array as last time whenever the contents match.
 *
 * The images reload when this list changes, so what counts as a change matters twice:
 *
 * - `imageConfigs={[{ source: store }]}` builds a new array on every render. Comparing
 *   arrays by identity would call every render a change and reload the images.
 * - A host that opens its own store has nothing to pass on the first render, because
 *   opening is asynchronous. Reading the prop only once, when the component mounts,
 *   would never see the store.
 *
 * Comparing the contents covers both: an unchanged list reloads nothing, and a store
 * that appears on a later render is a change and loads.
 */
function useLayerConfigs(
  imageConfigs: ImageLayerConfig[] | undefined,
  sources: string[],
  cacheSize: number | undefined,
): ImageLayerConfig[] {
  const ignoringSources = imageConfigs !== undefined && sources.length > 0;
  React.useEffect(() => {
    if (ignoringSources) {
      console.warn("vizarr: both `imageConfigs` and `sources` were given, ignoring `sources`.");
    }
  }, [ignoringSources]);

  const given: ImageLayerConfig[] = imageConfigs ?? sources.map((source) => ({ source }));
  const next = given.map((config) => ({ ...config, cache_size: config.cache_size ?? cacheSize }));
  const current = React.useRef(next);
  if (!sameConfigs(current.current, next)) {
    current.current = next;
  }
  return current.current;
}

function sameConfigs(a: ImageLayerConfig[], b: ImageLayerConfig[]): boolean {
  return (
    a.length === b.length &&
    a.every((config, i) => {
      // A source is a url or a store object, so it is compared by identity. The rest
      // of a config is plain data, so JSON compares it by value. Callbacks do not
      // survive JSON, which means a new `onClick` alone does not count as a change.
      const { source, ...rest } = config;
      const { source: otherSource, ...otherRest } = b[i];
      return source === otherSource && JSON.stringify(rest) === JSON.stringify(otherRest);
    })
  );
}

function VizarrViewerComponent({
  sources = [],
  imageConfigs,
  cacheSize,
  tileCacheSize,
  viewState: initialViewState,
  onViewStateChange,
  onViewerStateChange,
  additionalLayers,
  pluginCursor,
  onPluginClick,
  onPluginHover,
  children,
}: VizarrViewerProps) {
  const setSourceInfo = useSetAtom(sourceInfoAtom);
  const setTileCacheSize = useSetAtom(tileCacheSizeAtom);
  const setViewStateAtom = useSetAtom(viewStateAtom);
  const sourceError = useAtomValue(sourceErrorAtom);
  const redirectObj = useAtomValue(redirectObjAtom);
  const setSourceError = useSetAtom(sourceErrorAtom);
  const sourceWarning = useAtomValue(sourceWarningAtom);
  React.useEffect(() => {
    if (initialViewState) {
      setViewStateAtom(initialViewState);
    }
  }, [initialViewState, setViewStateAtom]);

  React.useEffect(() => {
    setTileCacheSize(tileCacheSize ?? null);
  }, [tileCacheSize, setTileCacheSize]);

  const viewStateAtomWithEffect: PrimitiveAtom<ViewState | null> = atom(
    (get) => get(viewStateAtom),
    (get, set, update) => {
      const viewState = typeof update === "function" ? update(get(viewStateAtom)) : update;
      if (viewState) {
        onViewStateChange?.({
          target: viewState.target,
          zoom: viewState.zoom,
        });
        set(viewStateAtom, update);
      }
    },
  );

  const layerConfigs = useLayerConfigs(imageConfigs, sources, cacheSize);

  React.useEffect(() => {
    async function loadSources() {
      setSourceError(null);
      const results = await Promise.allSettled(
        layerConfigs.map(async (config, index) => {
          const sourceData = await createSourceData(config);
          return sourceData.flatMap((source) => {
            const id = Math.random().toString(36).slice(2);
            if (!source.name) {
              source.name = `image_${index}`;
            }
            return { id, ...source };
          });
        }),
      );
      let sourceDatas = [];
      if (!sourceDataValid(results)) {
        setSourceError(writeUserErrorMessage(getSourceDataError(results)));
      }

      for (const res of results) {
        if (res.status === "fulfilled") {
          sourceDatas.push(res.value);
        } else {
          console.error(res.reason);
        }
      }
      sourceDatas = sourceDatas.filter((s) => s !== null);
      sourceDatas = sourceDatas.flat();
      setSourceInfo(sourceDatas);
    }

    loadSources();
  }, [layerConfigs, setSourceInfo, setSourceError]);

  const firstSource = layerConfigs[0]?.source;
  return (
    <>
      {redirectObj === null && (
        <ViewStateContext.Provider value={viewStateAtomWithEffect}>
          <ViewerBridge
            sourceUrl={typeof firstSource === "string" ? firstSource : ""}
            onViewStateChange={onViewStateChange}
            onViewerStateChange={onViewerStateChange}
            additionalLayers={additionalLayers}
            pluginCursor={pluginCursor}
            onPluginClick={onPluginClick}
            onPluginHover={onPluginHover}
          >
            {children}
          </ViewerBridge>
        </ViewStateContext.Provider>
      )}
      {sourceError !== null && (
        <Box
          sx={{
            position: "fixed",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            textAlign: "center",
            justifyContent: "center",
            fontSize: "120%",
          }}
        >
          <p>
            {" "}
            Sorry, we were unable to load this image due to the following error: <br /> <br /> {sourceError} <br />{" "}
            <br /> If you believe this is an error with our application, please open an issue:{" "}
            <a href="https://github.com/BioNGFF/vizarr/issues "> here </a>
          </p>
        </Box>
      )}
      {sourceWarning.length &&
        sourceWarning.map((warning, index) => {
          return <InfoSnackbar message={warning} key={useId()} />;
        })}
      {redirectObj !== null && (
        <Box
          sx={{
            position: "fixed",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            textAlign: "center",
            justifyContent: "center",
            fontSize: "120%",
          }}
        >
          <Typography variant="h5">
            {redirectObj.message}
            <Link href={redirectObj.url}> {redirectObj.url} </Link>
          </Typography>
        </Box>
      )}
    </>
  );
}

/**
 *Component to render source images
 */
export default function VizarrViewer({ children, ...props }: VizarrViewerProps) {
  return (
    <ThemeProvider theme={theme}>
      <Provider>
        <VizarrViewerComponent {...props}>{children}</VizarrViewerComponent>
      </Provider>
    </ThemeProvider>
  );
}
