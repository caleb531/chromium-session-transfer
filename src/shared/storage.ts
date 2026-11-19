import type {
  DatabaseSnapshot,
  StorageSnapshot,
  StorageResult,
  StoreSnapshot,
  ValueGraph,
  ValueNode,
} from './protocol.js';

// Read or replace stored state in a deliberately script-free origin document
// Keep this function self-contained because both browsers execute its source
export async function websiteStorage(
  mode: 'read' | 'read-session' | 'write',
  snapshot?: StorageSnapshot,
): Promise<StorageResult> {
  // Convert an IndexedDB value to a JSON-safe graph without losing references
  async function encode(root: unknown): Promise<ValueGraph> {
    // The graph nodes referenced by numeric indexes
    const nodes: ValueNode[] = [];
    // The objects already visited, including circular collections
    const seen = new Map<object, number>();

    // Add one value and return its graph index
    async function visit(value: unknown): Promise<number> {
      if (typeof value === 'object' && value !== null && seen.has(value)) {
        return seen.get(value)!;
      }
      // The slot reserved before recursively visiting any child objects
      const index = nodes.length;
      // The node filled according to the stored value's actual type
      const node: ValueNode = { type: typeof value };
      nodes.push(node);
      if (typeof value === 'object' && value !== null) seen.set(value, index);
      if (value === null) node.type = 'null';
      else if (typeof value === 'string' || typeof value === 'boolean') {
        node.value = value;
      } else if (typeof value === 'number' || typeof value === 'bigint') {
        node.value = Object.is(value, -0) ? '-0' : String(value);
      } else if (
        typeof CryptoKey !== 'undefined' &&
        value instanceof CryptoKey
      ) {
        if (!value.extractable) {
          throw new Error(
            'IndexedDB contains a non-exportable cryptographic key',
          );
        }
        node.type = 'crypto';
        node.items = [
          await visit({
            jwk: await crypto.subtle.exportKey('jwk', value),
            algorithm: value.algorithm,
            usages: value.usages,
          }),
        ];
      } else if (value instanceof Date) {
        node.type = 'date';
        node.value = String(value.getTime());
      } else if (value instanceof RegExp) {
        node.type = 'regexp';
        node.value = value.source;
        node.name = value.flags;
      } else if (value instanceof ArrayBuffer) {
        node.type = 'buffer';
        node.value = bytesToBase64(new Uint8Array(value));
      } else if (ArrayBuffer.isView(value)) {
        if (
          ![
            'Int8Array',
            'Uint8Array',
            'Uint8ClampedArray',
            'Int16Array',
            'Uint16Array',
            'Int32Array',
            'Uint32Array',
            'Float32Array',
            'Float64Array',
            'BigInt64Array',
            'BigUint64Array',
            'DataView',
          ].includes(value.constructor.name)
        ) {
          throw new Error('IndexedDB contains an unsupported typed array');
        }
        node.type = 'view';
        node.name = value.constructor.name;
        node.buffer = await visit(value.buffer);
        node.offset = value.byteOffset;
        node.length = value.byteLength;
      } else if (value instanceof Blob) {
        node.type = value instanceof File ? 'file' : 'blob';
        node.name = value.type;
        node.value = bytesToBase64(new Uint8Array(await value.arrayBuffer()));
        if (value instanceof File) {
          node.items = [
            await visit(value.name),
            await visit(value.lastModified),
          ];
        }
      } else if (value instanceof Map) {
        node.type = 'map';
        node.items = [];
        for (const [key, entry] of value) {
          node.items.push(await visit(key), await visit(entry));
        }
      } else if (value instanceof Set) {
        node.type = 'set';
        node.items = [];
        for (const entry of value) node.items.push(await visit(entry));
      } else if (
        Array.isArray(value) ||
        (typeof value === 'object' &&
          value !== null &&
          (Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null))
      ) {
        node.type = Array.isArray(value) ? 'array' : 'object';
        if (Array.isArray(value)) node.length = value.length;
        node.props = [];
        for (const [key, entry] of Object.entries(value)) {
          node.props.push([key, await visit(entry)]);
        }
      } else if (typeof value !== 'undefined') {
        throw new Error(
          `IndexedDB contains an unsupported value (${Object.prototype.toString.call(value)})`,
        );
      }
      return index;
    }

    // The index returned after the complete graph has been traversed
    const rootIndex = await visit(root);
    return { root: rootIndex, nodes };
  }

  // Encode bytes in bounded chunks so large blobs do not overflow the stack
  function bytesToBase64(bytes: Uint8Array): string {
    // The bounded strings used to construct a single binary string
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      chunks.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 16384)),
      );
    }
    return btoa(chunks.join(''));
  }

  // Rebuild a graph using the destination browser's native structured types
  async function decode(graph: ValueGraph): Promise<unknown> {
    // The values already allocated, including unfinished circular collections
    const values = new Map<number, unknown>();

    // Resolve a node and populate any child values after allocating the parent
    async function visit(index: number): Promise<unknown> {
      if (values.has(index)) return values.get(index);
      // The serialized node requested by an object or collection
      const node = graph.nodes[index];
      // The reconstructed value retained for shared and circular references
      let value: unknown;
      switch (node.type) {
        case 'null':
          value = null;
          break;
        case 'undefined':
          value = undefined;
          break;
        case 'string':
        case 'boolean':
          value = node.value;
          break;
        case 'number':
          value = Number(node.value);
          break;
        case 'bigint':
          value = BigInt(node.value as string);
          break;
        case 'date':
          value = new Date(Number(node.value));
          break;
        case 'regexp':
          value = new RegExp(node.value as string, node.name);
          break;
        case 'buffer':
        case 'blob':
        case 'file': {
          // The decoded binary content of an ArrayBuffer, Blob, or File
          const bytes = Uint8Array.from(
            atob(node.value as string),
            // Convert each binary character into its byte value
            (character) => character.charCodeAt(0),
          );
          value =
            node.type === 'buffer'
              ? bytes.buffer
              : node.type === 'blob'
                ? new Blob([bytes], { type: node.name })
                : new File([bytes], String(await visit(node.items![0])), {
                    type: node.name,
                    lastModified: Number(await visit(node.items![1])),
                  });
          break;
        }
        case 'view': {
          // The backing buffer shared by any other views in the graph
          const buffer = (await visit(node.buffer!)) as ArrayBuffer;
          // The supported numeric typed array constructors
          const constructors = {
            Int8Array,
            Uint8Array,
            Uint8ClampedArray,
            Int16Array,
            Uint16Array,
            Int32Array,
            Uint32Array,
            Float32Array,
            Float64Array,
            BigInt64Array,
            BigUint64Array,
          };
          if (node.name === 'DataView') {
            value = new DataView(buffer, node.offset, node.length);
          } else {
            // The exact constructor used by the source buffer view
            const constructor =
              constructors[node.name as keyof typeof constructors];
            if (!constructor)
              throw new Error('Unsupported IndexedDB buffer view');
            value = new constructor(
              buffer,
              node.offset,
              node.length! / constructor.BYTES_PER_ELEMENT,
            );
          }
          break;
        }
        case 'crypto': {
          // The exported key material and import parameters
          const key = (await visit(node.items![0])) as {
            jwk: JsonWebKey;
            algorithm: Algorithm;
            usages: KeyUsage[];
          };
          value = await crypto.subtle.importKey(
            'jwk',
            key.jwk,
            key.algorithm,
            true,
            key.usages,
          );
          break;
        }
        case 'array':
          value = new Array(node.length);
          break;
        case 'object':
          value = {};
          break;
        case 'map':
          value = new Map();
          break;
        case 'set':
          value = new Set();
          break;
        default:
          throw new Error('Unsupported IndexedDB graph node');
      }
      values.set(index, value);
      for (const [key, child] of node.props ?? []) {
        Object.defineProperty(value, key, {
          value: await visit(child),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      if (value instanceof Map) {
        for (let cursor = 0; cursor < node.items!.length; cursor += 2) {
          value.set(
            await visit(node.items![cursor]),
            await visit(node.items![cursor + 1]),
          );
        }
      }
      if (value instanceof Set) {
        for (const child of node.items!) value.add(await visit(child));
      }
      return value;
    }
    return visit(graph.root);
  }

  // Await one IndexedDB request without exposing record contents in errors
  function request<T>(operation: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      operation.onsuccess = () => resolve(operation.result);
      operation.onerror = () =>
        reject(
          new Error(`IndexedDB request failed (${operation.error?.name})`),
        );
    });
  }

  // Await commit or abort so a returned snapshot never hides transaction errors
  function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          new Error(
            `IndexedDB transaction aborted (${transaction.error?.name})`,
          ),
        );
      transaction.onerror = () =>
        reject(
          new Error(
            `IndexedDB transaction failed (${transaction.error?.name})`,
          ),
        );
    });
  }

  // Open an existing database or create a schema during restoration
  async function openDatabase(
    name: string,
    version: number,
    stores?: StoreSnapshot[],
  ): Promise<IDBDatabase> {
    // The open operation that may need another page to release its connection
    const operation = indexedDB.open(name, version);
    operation.onblocked = () => {
      /* The deadline below handles held connections */
    };
    operation.onupgradeneeded = () => {
      if (!stores) {
        operation.transaction!.abort();
        return;
      }
      for (const definition of stores) {
        // The object store recreated with the original key contract
        const store = operation.result.createObjectStore(definition.name, {
          keyPath: definition.keyPath,
          autoIncrement: definition.autoIncrement,
        });
        for (const index of definition.indexes) {
          store.createIndex(index.name, index.keyPath, {
            unique: index.unique,
            multiEntry: index.multiEntry,
          });
        }
      }
    };
    // The deadline prevents blocked database operations from hanging the picker
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        request(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            operation.onsuccess = () => operation.result.close();
            reject(
              new Error(
                'IndexedDB is blocked by another open page; close it and retry',
              ),
            );
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }

  // Read all databases without keeping transactions alive across serialization
  async function readDatabases(): Promise<DatabaseSnapshot[]> {
    // The database names and versions currently registered for this origin
    const databases = (await indexedDB.databases()).sort((left, right) =>
      (left.name ?? '').localeCompare(right.name ?? ''),
    );
    // The completed snapshots for each database
    const result: DatabaseSnapshot[] = [];
    for (const info of databases) {
      if (info.name === undefined || info.version === undefined) {
        throw new Error('An IndexedDB database changed during capture; retry');
      }
      // The live database connection closed after its records are read
      const database = await openDatabase(info.name, info.version);
      try {
        // The stores that participate in one consistent database transaction
        const names = Array.from(database.objectStoreNames);
        // The schema and encoded records for this database
        const stores: StoreSnapshot[] = [];
        if (names.length) {
          // The read-only transaction spanning all stores in this database
          const transaction = database.transaction(names, 'readonly');
          // The completion listener attached before requests finish
          const done = transactionDone(transaction);
          // The reads issued synchronously to keep the transaction active
          const pending = names.map((name) => {
            // The store whose records and schema are captured together
            const store = transaction.objectStore(name);
            return {
              name,
              keyPath: store.keyPath,
              autoIncrement: store.autoIncrement,
              indexes: Array.from(store.indexNames, (indexName) => {
                // The source index definition
                const index = store.index(indexName);
                return {
                  name: index.name,
                  keyPath: index.keyPath,
                  unique: index.unique,
                  multiEntry: index.multiEntry,
                };
              }),
              keys: request(store.getAllKeys()),
              values: request(store.getAll()),
            };
          });
          // The resolved keys and values read before encoding any binary data
          const [raw] = await Promise.all([
            Promise.all(
              pending.map(async (store) => {
                // The paired reads observed together so either failure is
                // handled
                const [keys, values] = await Promise.all([
                  store.keys,
                  store.values,
                ]);
                return { ...store, keys, values };
              }),
            ),
            done,
          ]);
          for (const store of raw) {
            if (store.autoIncrement) {
              throw new Error(
                'IndexedDB uses an auto-increment key generator that cannot be faithfully exported',
              );
            }
            stores.push({
              name: store.name,
              keyPath: store.keyPath,
              autoIncrement: store.autoIncrement,
              indexes: store.indexes,
              records: await encode(
                store.keys.map((key, index) => ({
                  key,
                  value: store.values[index],
                })),
              ),
            });
          }
        }
        result.push({ name: info.name, version: database.version, stores });
      } finally {
        database.close();
      }
    }
    return result;
  }

  // Replace the current databases before writing the captured schema and
  // records
  async function writeDatabases(databases: DatabaseSnapshot[]): Promise<void> {
    for (const info of await indexedDB.databases()) {
      if (info.name === undefined)
        throw new Error('An IndexedDB database has no name');
      // The deletion request that must complete before recreating the database
      const operation = indexedDB.deleteDatabase(info.name);
      // The deadline used when a different document holds a database connection
      let timer: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          request(operation),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    'IndexedDB deletion is blocked; close other pages for this origin',
                  ),
                ),
              10000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer!);
      }
    }
    for (const definition of databases) {
      // The database populated after its schema is recreated
      const database = await openDatabase(
        definition.name,
        definition.version,
        definition.stores,
      );
      try {
        // The records decoded before opening a write transaction
        const decoded = await Promise.all(
          definition.stores.map(async (store) => ({
            ...store,
            records: (await decode(store.records)) as {
              key: IDBValidKey;
              value: unknown;
            }[],
          })),
        );
        if (decoded.length) {
          // The transaction commits every object store in the database together
          const transaction = database.transaction(
            decoded.map((store) => store.name),
            'readwrite',
          );
          // The promise that reports commit or abort
          const done = transactionDone(transaction);
          try {
            for (const definition of decoded) {
              // The store using inline or separate keys as originally
              // configured
              const store = transaction.objectStore(definition.name);
              for (const record of definition.records) {
                if (store.keyPath === null) store.put(record.value, record.key);
                else store.put(record.value);
              }
            }
          } catch (cause) {
            transaction.abort();
            // Wait for rollback before closing the database; consume the
            // expected abort rejection so it doesn't hide the original error
            await done.catch(() => undefined);
            throw cause;
          }
          await done;
        }
      } finally {
        database.close();
      }
    }
  }

  try {
    if (mode === 'write') {
      if (!snapshot || snapshot.origin !== location.origin) {
        throw new Error(
          'Storage restoration must run under its original origin',
        );
      }
      await writeDatabases(snapshot.databases);
      localStorage.clear();
      for (const [key, value] of snapshot.local)
        localStorage.setItem(key, value);
      sessionStorage.clear();
      for (const [key, value] of snapshot.session)
        sessionStorage.setItem(key, value);
      return { ok: true };
    }
    return {
      ok: true,
      snapshot: {
        origin: location.origin,
        local:
          mode === 'read-session'
            ? []
            : Object.entries(localStorage).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
        session: Object.entries(sessionStorage).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
        databases: mode === 'read-session' ? [] : await readDatabases(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Website storage could not be read or restored',
    };
  }
}
