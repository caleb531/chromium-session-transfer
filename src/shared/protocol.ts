// The installed native host used by the Brave extension
export const HOST_NAME = 'com.calebevans.chrome_session_transfer';

// The format version shared by the extension and native helper
export const FORMAT_VERSION = 2;

// A JSON-safe node in a graph of structured IndexedDB values
export interface ValueNode {
  // The structured value type represented by this node
  type: string;
  // The primitive value or encoded binary data
  value?: string | number | boolean | null;
  // The references to named object properties
  props?: [string, number][];
  // The references to collection elements
  items?: number[];
  // The reference to a typed array's underlying buffer
  buffer?: number;
  // The constructor name or MIME type
  name?: string;
  // The byte offset of a view into a buffer
  offset?: number;
  // The element or byte length of a collection
  length?: number;
}

// A graph that preserves shared references and circular values across JSON
export interface ValueGraph {
  // The index of the graph's root value
  root: number;
  // The values referenced by their index
  nodes: ValueNode[];
}

// The structure and contents of one IndexedDB object store
export interface StoreSnapshot {
  // The object store's name
  name: string;
  // The key path used for inline keys; null means out-of-line keys
  keyPath: string | string[] | null;
  // Whether the store generates keys automatically
  autoIncrement: boolean;
  // The next generated key; null means no generator, exhausted means no keys
  nextKey: number | 'exhausted' | null;
  // The definitions used to recreate this store's indexes
  indexes: {
    // The index's name
    name: string;
    // The properties indexed by this definition
    keyPath: string | string[];
    // Whether duplicate index keys are forbidden
    unique: boolean;
    // Whether each array element produces an index entry
    multiEntry: boolean;
  }[];
  // The encoded array of records with their separate primary keys
  records: ValueGraph;
}

// A versioned IndexedDB database for one origin
export interface DatabaseSnapshot {
  // The database's name
  name: string;
  // The database schema version
  version: number;
  // The object stores that belong to this database
  stores: StoreSnapshot[];
}

// The stored website state visible to a tab's top-level origin
export interface StorageSnapshot {
  // The exact scheme, hostname, and port owning the storage
  origin: string;
  // The origin's localStorage entries
  local: [string, string][];
  // The tab's sessionStorage entries
  session: [string, string][];
  // The origin's IndexedDB databases
  databases: DatabaseSnapshot[];
}

// The serialized result returned even when an injected storage operation fails
export type StorageResult =
  | {
      // Whether the storage operation completed successfully
      ok: true;
      // The captured state; writes return only their completion status
      snapshot?: StorageSnapshot;
    }
  | {
      // Whether the storage operation completed successfully
      ok: false;
      // The failure reason without database record contents
      message: string;
    };

// A tab and its separately captured sessionStorage
export interface TransferTab {
  // The Brave tab ID used only to close a successfully transferred tab
  sourceId: number;
  // The original page URL to open after storage restoration
  url: string;
  // The original title displayed in transfer results
  title: string;
  // The page's origin used to locate shared storage
  origin: string;
  // The tab's own sessionStorage entries
  session: [string, string][];
}

// The entire in-memory transfer sent over native messaging
export interface TransferPayload {
  // The wire format expected by this build
  version: typeof FORMAT_VERSION;
  // The top-level tabs explicitly selected by the user
  tabs: TransferTab[];
  // The shared storage captured once per selected origin
  origins: StorageSnapshot[];
  // The cookie values and attributes read through the browser API
  cookies: chrome.cookies.Cookie[];
}

// A small response that never includes credentials or website storage
export interface HostResult {
  // Whether all destination tabs were prepared and opened
  ok: boolean;
  // The number of tabs opened successfully
  count?: number;
  // A user-facing result without exported storage contents
  message: string;
}
