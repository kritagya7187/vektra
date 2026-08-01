/**
 * Minimal ambient declarations for `@google/earthengine` v1.7.37.
 *
 * The package ships no `types` field and no `@types/google-earthengine`
 * package exists (both confirmed via `npm view` before writing this file)
 * — this covers exactly the surface VEKTRA's GEE acquisition layer uses,
 * verified against the installed package's own JSDoc/source
 * (node_modules/@google/earthengine/src/{data,ee,image}.js), not guessed.
 * Extend as additional surface is actually used.
 */
declare module '@google/earthengine' {
  namespace ee {
    namespace data {
      /** Matches the real shape of a downloaded GEE service-account JSON key. */
      interface AuthPrivateKey {
        readonly client_email: string;
        readonly private_key: string;
        readonly [key: string]: unknown;
      }

      /** Real signature confirmed in src/data.js — takes the parsed key object, not a file path. */
      function authenticateViaPrivateKey(
        privateKey: AuthPrivateKey,
        onSuccess?: () => void,
        onError?: (error: string) => void,
        extraScopes?: readonly string[],
        suppressDefaultScopes?: boolean,
      ): void;

      /** Current bearer token after a successful authenticate+initialize — used to authorize the manual getDownloadURL fetch. */
      function getAuthToken(): string;
    }

    /** Real signature confirmed in src/ee.js: (baseurl, tileurl, onSuccess, onError, xsrfToken, project). */
    function initialize(
      baseurl: string | null,
      tileurl: string | null,
      onSuccess: (() => void) | null,
      onError: ((error: string) => void) | null,
      xsrfToken: string | null,
      project?: string,
    ): void;

    function reset(): void;

    /** Opaque handle — constructed via Geometry.Rectangle or a plain GeoJSON object, never introspected directly. */
    type Geometry = unknown;

    namespace Geometry {
      function Rectangle(coords: readonly [number, number, number, number]): Geometry;
      function Point(coords: readonly [number, number]): Geometry;
    }

    interface GetDownloadUrlParams {
      readonly region?: unknown;
      readonly scale?: number;
      readonly crs?: string;
      /** 'GEO_TIFF' (single file, no zip wrapper) is required — matches rasterStorage.ts's raw-bytes contract. */
      readonly format?: 'GEO_TIFF' | 'ZIPPED_GEO_TIFF' | 'NPY';
      /** Must be false to get one band-stacked GeoTIFF instead of one file per band (real default is true). */
      readonly filePerBand?: boolean;
      readonly dimensions?: number | string;
    }

    class Image {
      constructor(args: unknown);
      select(bandNames: readonly string[]): Image;
      addBands(image: Image): Image;
      rename(names: readonly string[]): Image;
      clip(geometry: Geometry): Image;
      mask(): Image;
      updateMask(mask: Image): Image;
      unmask(value: number): Image;
      neq(value: number): Image;
      eq(value: number): Image;
      gte(value: number): Image;
      lte(value: number): Image;
      bitwiseAnd(value: number): Image;
      rightShift(value: number): Image;
      not(): Image;
      toByte(): Image;
      toFloat(): Image;
      multiply(value: number): Image;
      divide(value: number): Image;
      add(value: number): Image;
      get(property: string): unknown;
      /** Synchronous overload (no callback) throws in Node without a browser event loop trick — always use the callback form. */
      getInfo(callback: (info: unknown, error?: string) => void): void;
      /** Real signature confirmed in src/image.js — callback form is (url | null, error?). */
      getDownloadURL(
        params: GetDownloadUrlParams,
        callback: (url: string | null, error?: string) => void,
      ): void;
    }

    /** Any lazily-evaluated EE server-side object (ee.Number, ee.String, ...) — only the async getInfo() accessor is ever needed by VEKTRA. */
    interface ComputedObject {
      getInfo(callback: (info: unknown, error?: string) => void): void;
    }

    class ImageCollection {
      constructor(args: unknown);
      filterBounds(geometry: Geometry): ImageCollection;
      filterDate(start: string, end: string): ImageCollection;
      filter(filter: unknown): ImageCollection;
      merge(other: ImageCollection): ImageCollection;
      sort(property: string, ascending?: boolean): ImageCollection;
      first(): Image;
      mosaic(): Image;
      median(): Image;
      select(bandNames: readonly string[]): ImageCollection;
      size(): ComputedObject;
      /** Real EE method for extracting a full band time series at a point across a collection in one server-side call. */
      getRegion(geometry: Geometry, scale: number): ComputedObject;
    }

    namespace Filter {
      function lt(name: string, value: unknown): unknown;
      function lte(name: string, value: unknown): unknown;
      function eq(name: string, value: unknown): unknown;
    }
  }

  export = ee;
}
