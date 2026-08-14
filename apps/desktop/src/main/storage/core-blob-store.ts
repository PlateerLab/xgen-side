export type CoreLocalDataKey = 'credentials' | 'settings' | 'workspace';

export interface CoreBlobStore {
  readLocalData(key: CoreLocalDataKey): Promise<string | undefined>;
  writeLocalData(key: CoreLocalDataKey, content: string): Promise<void>;
}
