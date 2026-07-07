/**
 * iOS platform stubs (V1). The seam must compile so iOS stays an adapter swap
 * (BUILD_V1 §13); every method throws until the iOS milestone implements them:
 *  - IOSTagReader:   NFCTagReaderSession / background NDEF via universal link
 *  - IOSPowerStateProvider: UIDevice battery-state notifications
 *  - IOSSessionRuntime:     no-op runtime; persisted state + launch reconciliation
 */
import type { PowerListener, PowerStateProvider } from '../PowerStateProvider';
import type { SessionRuntime, SessionRuntimeStartOptions } from '../SessionRuntime';
import type { TagListener, TagReader, TagState, TagWriteRequest, TagWriteResult, TagWriter } from '../TagReader';

class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented on iOS in V1 (BUILD_V1 §13)`);
    this.name = 'NotImplementedError';
  }
}

export class IOSTagReader implements TagReader {
  start(): Promise<void> {
    return Promise.reject(new NotImplementedError('IOSTagReader.start'));
  }
  stop(): Promise<void> {
    return Promise.reject(new NotImplementedError('IOSTagReader.stop'));
  }
  subscribe(_listener: TagListener): () => void {
    throw new NotImplementedError('IOSTagReader.subscribe');
  }
  isAvailable(): Promise<boolean> {
    return Promise.reject(new NotImplementedError('IOSTagReader.isAvailable'));
  }
}

export class IOSTagWriter implements TagWriter {
  beginWriteStep(
    _request: TagWriteRequest,
    _onTagState: (state: TagState) => void
  ): { proceed: () => Promise<TagWriteResult>; cancel: () => void } {
    throw new NotImplementedError('IOSTagWriter.beginWriteStep');
  }
}

export class IOSPowerStateProvider implements PowerStateProvider {
  isCharging(): Promise<boolean> {
    return Promise.reject(new NotImplementedError('IOSPowerStateProvider.isCharging'));
  }
  subscribe(_listener: PowerListener): () => void {
    throw new NotImplementedError('IOSPowerStateProvider.subscribe');
  }
}

export class IOSSessionRuntime implements SessionRuntime {
  start(_options: SessionRuntimeStartOptions): Promise<void> {
    return Promise.reject(new NotImplementedError('IOSSessionRuntime.start'));
  }
  stop(): Promise<void> {
    return Promise.reject(new NotImplementedError('IOSSessionRuntime.stop'));
  }
  isRunning(): Promise<boolean> {
    return Promise.reject(new NotImplementedError('IOSSessionRuntime.isRunning'));
  }
}
