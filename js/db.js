/* ===========================================================
   Ma — local storage (IndexedDB)
   Source of truth for the current session. Drive is the
   cross-device backup + sync layer, layered on top.
   =========================================================== */

const MaDB = (() => {
  const DB_NAME = 'ma';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('notebooks')) {
          db.createObjectStore('notebooks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('documents')) {
          const docs = db.createObjectStore('documents', { keyPath: 'id' });
          docs.createIndex('notebookId', 'notebookId', { unique: false });
          docs.createIndex('updatedAt', 'updatedAt', { unique: false });
          docs.createIndex('driveFileId', 'driveFileId', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }
  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    // ---- notebooks ----
    async listNotebooks() {
      const store = await tx('notebooks', 'readonly');
      return reqToPromise(store.getAll());
    },
    async putNotebook(notebook) {
      const store = await tx('notebooks', 'readwrite');
      return reqToPromise(store.put(notebook));
    },
    async deleteNotebook(id) {
      const store = await tx('notebooks', 'readwrite');
      return reqToPromise(store.delete(id));
    },

    // ---- documents (each has .tabs: [{id, name, markdown}]) ----
    async listDocuments(notebookId) {
      const store = await tx('documents', 'readonly');
      const idx = store.index('notebookId');
      return reqToPromise(idx.getAll(notebookId));
    },
    async allDocuments() {
      const store = await tx('documents', 'readonly');
      return reqToPromise(store.getAll());
    },
    async getDocument(id) {
      const store = await tx('documents', 'readonly');
      return reqToPromise(store.get(id));
    },
    async putDocument(doc) {
      const store = await tx('documents', 'readwrite');
      return reqToPromise(store.put(doc));
    },
    async deleteDocument(id) {
      const store = await tx('documents', 'readwrite');
      return reqToPromise(store.delete(id));
    },
    async findByDriveFileId(driveFileId) {
      const all = await this.allDocuments();
      return all.find((d) => d.driveFileId === driveFileId) || null;
    },

    // ---- meta (theme, font, layout toggles, drive state, etc) ----
    async getMeta(key) {
      const store = await tx('meta', 'readonly');
      const row = await reqToPromise(store.get(key));
      return row ? row.value : undefined;
    },
    async setMeta(key, value) {
      const store = await tx('meta', 'readwrite');
      return reqToPromise(store.put({ key, value }));
    }
  };
})();
