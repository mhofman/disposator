import {
  symbolDispose,
  symbolAsyncDispose,
  Disposable,
  AsyncDisposable,
} from "./index.js";
import {
  AsyncIteratorPrototype,
  IteratorPrototype,
} from "./iterator-prototypes.js";

if (!("dispose" in Symbol)) {
  Object.defineProperty(Symbol, "dispose", { value: symbolDispose });
}

if (!("asyncDispose" in Symbol)) {
  Object.defineProperty(Symbol, "asyncDispose", { value: symbolAsyncDispose });
}

if (typeof IteratorPrototype[symbolDispose] !== "function") {
  Object.defineProperty(IteratorPrototype, symbolDispose, {
    value() {
      this.return != null && this.return();
    },
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

if (typeof AsyncIteratorPrototype[symbolAsyncDispose] !== "function") {
  Object.defineProperty(AsyncIteratorPrototype, symbolAsyncDispose, {
    async value() {
      await (this.return != null && this.return());
    },
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

if (typeof globalThis.Disposable !== "function") {
  globalThis.Disposable = Disposable;
}

if (typeof globalThis.AsyncDisposable !== "function") {
  globalThis.AsyncDisposable = AsyncDisposable;
}
