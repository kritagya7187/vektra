import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RasterDataSourceCode } from '../../types';

/**
 * Phase 3 Milestone 2, Task 3 (Raster Storage). Writes real downloaded
 * raster bytes to a configurable directory — never a hard-coded path
 * (RASTER_STORAGE_DIR, config/env.schema.ts). Mirrors
 * environmental_raster_asset.storage_location's existing role (an opaque
 * reference string, db/migrations/0006) — this function is what actually
 * produces that string now, instead of an unresolved upstream href.
 *
 * Reproducibility: the checksum returned here is what
 * DataProvenanceRecord.checksum (EDD Section 24: "A checksum of the
 * retrieved artifact... to detect silent corruption or unexpected
 * upstream changes") already existed to carry — this is real SHA-256 of
 * the actual bytes written, computed with Node's own crypto module, not
 * an invented scheme.
 */

export interface WriteRasterFileOptions {
  readonly storageDir: string | undefined;
  readonly sourceCode: RasterDataSourceCode;
  /** Used to derive a stable, collision-resistant filename — never trusted as a raw path fragment (sanitized below). */
  readonly sourceProductIdentifier: string;
  readonly bytes: Uint8Array | Buffer;
}

export interface WrittenRasterFile {
  readonly storageLocation: string;
  readonly checksum: string;
}

/** Strips anything that isn't a safe filename character — source product identifiers (SAFE names, tile ids) are upstream-controlled strings, never trusted as path fragments verbatim. */
function sanitizeForFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

export async function writeRasterFile(options: WriteRasterFileOptions): Promise<WrittenRasterFile> {
  if (!options.storageDir) {
    throw new Error(
      'RASTER_STORAGE_DIR must be set to ingest raster data (see backend/.env.example) — no default path is assumed.',
    );
  }

  const sourceDir = path.join(options.storageDir, options.sourceCode);
  await mkdir(sourceDir, { recursive: true });

  const fileName = `${sanitizeForFilename(options.sourceProductIdentifier)}.tif`;
  const filePath = path.join(sourceDir, fileName);

  await writeFile(filePath, options.bytes);

  const checksum = createHash('sha256').update(options.bytes).digest('hex');

  return { storageLocation: filePath, checksum };
}
