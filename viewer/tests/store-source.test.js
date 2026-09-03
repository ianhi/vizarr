import { expect, test } from "vitest";
import * as zarr from "zarrita";
import { createSourceData } from "../src/io";

const SHAPE = [2, 4, 4];

const attributes = {
  ome: {
    version: "0.5",
    multiscales: [
      {
        name: "in-memory",
        axes: [
          { name: "c", type: "channel" },
          { name: "y", type: "space" },
          { name: "x", type: "space" },
        ],
        datasets: [{ path: "0", coordinateTransformations: [{ type: "scale", scale: [1, 1, 1] }] }],
      },
    ],
    omero: {
      channels: [
        { label: "first", color: "FF0000", window: { start: 0, end: 255, min: 0, max: 255 }, active: true },
        { label: "second", color: "00FF00", window: { start: 0, end: 255, min: 0, max: 255 }, active: true },
      ],
    },
  },
};

/** A one-image OME-Zarr hierarchy, written by zarrita so the metadata is not hand-rolled. */
async function image() {
  const contents = new Map();
  const root = zarr.root(contents);
  await zarr.create(root, { attributes });
  await zarr.create(root.resolve("0"), { shape: SHAPE, chunk_shape: [1, 4, 4], data_type: "uint8" });
  return contents;
}

/**
 * A store from outside vizarr: a plain object that implements zarrita's `Readable`,
 * the shape a host application's reader hands us. Deliberately not a zarrita store,
 * and it holds the whole image, so no network is involved.
 */
function foreignStore(contents) {
  const reads = [];
  return {
    reads,
    get: async (key) => {
      reads.push(key);
      return contents.get(key);
    },
  };
}

test("reads an image from a store source", async () => {
  const [data] = await createSourceData({ source: foreignStore(await image()) });
  expect(data.loader).toHaveLength(1);
  expect(data.loader[0].shape).toEqual(SHAPE);
  expect(data.channel_axis).toBe(0);
  expect(data.names).toEqual(["first", "second"]);
  expect(data.colors).toEqual(["FF0000", "00FF00"]);
});
