import type { XgenSideApi } from '../../shared/contracts';

declare global {
  interface Window {
    xgenSide: XgenSideApi;
  }
}

export {};
