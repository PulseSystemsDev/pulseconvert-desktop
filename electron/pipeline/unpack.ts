import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import yauzl from 'yauzl';
import { safeJoin, ensureDir } from './localStorage';
import { MAX_ARCHIVE_ENTRIES, formatBytes, MAX_DECOMPRESSED_BYTES } from './localConstants';

/**
 * Extracts a zip (or .oiv, which is just a zip/7z with an assembly.xml) into destDir.
 * Guards against zip-slip (entry paths escaping destDir) and zip-bombs (total decompressed
 * size or entry count far beyond anything a real vehicle mod would need) - this runs against
 * arbitrary public uploads, so both checks happen before any bytes are written.
 */
export function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    ensureDir(destDir);
    const extractedPaths: string[] = [];
    let totalBytes = 0;
    let entryCount = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return fail(err);

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRIES) {
          zipfile.close();
          return fail(new Error(`Archive has too many entries (>${MAX_ARCHIVE_ENTRIES}) - refusing to extract.`));
        }

        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_DECOMPRESSED_BYTES) {
          zipfile.close();
          return fail(new Error(`Archive decompresses beyond the configured safety limit (${formatBytes(MAX_DECOMPRESSED_BYTES)}) - refusing to extract.`));
        }

        let targetPath: string;
        try {
          targetPath = safeJoin(destDir, entry.fileName);
        } catch (e) {
          zipfile.close();
          return fail(e);
        }

        if (/\/$/.test(entry.fileName)) {
          ensureDir(targetPath);
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, async (streamErr, readStream) => {
          if (streamErr) {
            zipfile.close();
            return fail(streamErr);
          }
          ensureDir(path.dirname(targetPath));
          try {
            await pipeline(readStream, fs.createWriteStream(targetPath));
            extractedPaths.push(targetPath);
            zipfile.readEntry();
          } catch (pipelineError) {
            zipfile.close();
            fs.rmSync(targetPath, { force: true });
            fail(pipelineError);
          }
        });
      });

      zipfile.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(extractedPaths);
      });
      zipfile.on('error', fail);
    });
  });
}
