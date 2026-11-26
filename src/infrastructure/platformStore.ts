import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { RecordStorePort } from '../application/index';
import { createBrowserRecordStore, createRecordStore, type RecordFileSystem } from './recordStore';

const recordFiles: RecordFileSystem = {
  async read(path) {
    const res = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return typeof res.data === 'string' ? res.data : '';
  },
  async write(path, data) {
    await Filesystem.writeFile({ path, directory: Directory.Data, encoding: Encoding.UTF8, data });
  },
  async mkdir(path) {
    await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
  },
  async list(path) {
    const listing = await Filesystem.readdir({ path, directory: Directory.Data });
    return listing.files.map((f) => (typeof f === 'string' ? f : f.name));
  },
  async remove(path) {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  },
};

export function createPlatformRecordStore(): RecordStorePort {
  if (Capacitor.isNativePlatform()) return createRecordStore(recordFiles);
  // Access localStorage lazily; in particular, a permission error belongs to
  // load/save and must be reported by the application, not at import time.
  return createBrowserRecordStore({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  });
}
