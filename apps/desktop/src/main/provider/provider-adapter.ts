import type { AgentRunRequest, ProviderId, ProviderStatus } from '../../shared/contracts';
import type { RunSession } from '../storage/local-run-store';

export interface LocatedExecutable {
  path: string;
  version: string;
}

export interface BrowserBridge {
  executablePath: string;
  environment: Record<string, string>;
}

export interface ProviderRunPlan {
  executable: LocatedExecutable;
  args: string[];
  env: NodeJS.ProcessEnv;
  sandbox: string;
}

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
}
