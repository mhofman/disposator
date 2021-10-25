import { symbolDispose, symbolAsyncDispose } from "./index.js";

declare global {
  interface SymbolConstructor {
    readonly dispose: typeof symbolDispose;
    readonly asyncDispose: typeof symbolAsyncDispose;
  }

  interface Iterator<T, TReturn = any, TNext = undefined> {
    [Symbol.dispose](): void;
  }

  interface AsyncIterator<T, TReturn = any, TNext = undefined> {
    [Symbol.asyncDispose](): Promise<void>;
  }

  var Disposable: typeof import("./index.js").Disposable;
  var AsyncDisposable: typeof import("./index.js").AsyncDisposable;
}
