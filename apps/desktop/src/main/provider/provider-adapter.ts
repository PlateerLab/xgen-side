import type { AgentRunRequest, ProviderId, ProviderStatus } from '../../shared/contracts';
import type { RunSession } from '../storage/local-run-store';

export interface LocatedExecutable {
  path: string;
  version: string;
}

export interface BrowserBridge {
  executablePath: string;
  args: string[];
  environment: Record<string, string>;
  toolProfiles: string[];
  tabId: string;
  targetId?: string;
}

export interface ProviderRunPlan {
  executable: LocatedExecutable;
  args: string[];
  env: NodeJS.ProcessEnv;
  sandbox: string;
}

export type ProviderStreamEvent =
  | { type: 'text'; text: string; mode: 'append' | 'replace' }
  | { type: 'activity'; name: string; phase: 'started' | 'updated' | 'completed' | 'failed'; detail?: string };

export interface ProviderAdapter {
  readonly id: ProviderId;
  getStatus(): Promise<ProviderStatus>;
  authenticate(): Promise<{ launched: boolean; message: string }>;
  prepareRun(
    request: AgentRunRequest,
    session: RunSession,
    browser?: BrowserBridge,
  ): Promise<ProviderRunPlan>;
  parseAnswer(stdout: string): string;
  parseStreamLine(line: string): ProviderStreamEvent[];
  isStreamComplete?(line: string): boolean;
}
