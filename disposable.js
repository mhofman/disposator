import { createIterator } from "./iterator-prototypes.js";
import { symbolDispose } from "./symbols.js";

/** @typedef {import("./disposable.js").Disposable.Constructor} DisposableConstructor */
/** @typedef {import("./disposable.js").Disposable} IDisposable */
/** @typedef {import("./disposable.js").Disposable.Resource} DisposableResource */

/** @typedef {import("./disposable.js").Disposable.OnDispose<any>} DisposeMethod */
/** @typedef {(value: any) => DisposableResource} MapFn */
/** @typedef {import("./disposable.js").Disposable.Aggregate} DisposableAggregate */

/**
 * @typedef {Object} DisposableResourceRecord
 * @property {unknown} resourceValue
 * @property {'sync'} hint
 * @property {DisposeMethod} disposeMethod
 */

/** @type {MapFn} */
const defaultMapFn = (value) => value;

/** @type {(value: any, resource: any) => DisposableResourceRecord | undefined } */
const getRecordFromValue = (value, resource) => {
  const syncDispose = value[symbolDispose];
  if (typeof syncDispose === "function") {
    return {
      resourceValue: value,
      hint: "sync",
      disposeMethod: syncDispose,
    };
  } else if (typeof value === "function") {
    return {
      resourceValue: resource,
      hint: "sync",
      disposeMethod: value,
    };
  }
  return undefined;
};

/**
 * @template {DisposableResource} T
 * @param {T} disposable
 * @param {unknown} resource
 * @param {Array<DisposableResourceRecord>} stack
 * @param {(err: unknown) => void} [onError]
 */
const addDisposable = (disposable, resource, stack, onError) => {
  try {
    const record = getRecordFromValue(disposable, resource);
    if (!record) {
      throw new TypeError("Invalid disposable");
    } else {
      stack.push(record);
    }
  } catch (error) {
    if (onError) {
      onError(error);
    } else {
      throw error;
    }
  }
  return disposable;
};

/**
 * @param {DisposableResourceRecord} record
 * @returns {void}
 */
const disposeRecord = ({ resourceValue, hint, disposeMethod }) => {
  switch (hint) {
    case "sync":
      return void disposeMethod.call(resourceValue);
    default:
      throw new TypeError("Invalid disposable record");
  }
};

/**
 * @param {unknown} error
 * @param {unknown} cause
 */
const mergeCause = (error, cause) => {
  let result;

  try {
    if (!("cause" in /** @type {Object}*/ (error))) {
      Object.defineProperty(error, "cause", {
        value: cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      result = error;
    }
  } catch (e) {}

  return result || new AggregateError([cause, error]);
};

/**
 * @param {Iterator<unknown>} iter
 * @param {MapFn} getDisposable
 */
const wrapIterator = (iter, getDisposable) => {
  const hasReturn = typeof iter.return === "function";
  const hasThrow = typeof iter.throw === "function";

  let closed = false;

  /** @type {DisposableResourceRecord | undefined} */
  let pendingRecord;
  const dispose = () => {
    if (!pendingRecord) return;
    const record = pendingRecord;
    pendingRecord = undefined;
    return disposeRecord(record);
  };

  /**
   * @template T
   * @param {() => T} fn
   * @param {boolean} [closeIter]
   */
  const tryOrClose = (fn, closeIter) => {
    try {
      return fn();
    } catch (err) {
      closed = true;
      try {
        dispose();
      } catch (disposeError) {
        throw new AggregateError([err, disposeError]);
      } finally {
        if (closeIter && hasReturn) {
          // @ts-ignore
          iter.return();
        }
      }
      throw err;
    }
  };

  /** @type {IterableIterator<any>} */
  const wrapped = createIterator({
    /** @param {[] | [any]} args */
    next: (...args) => {
      tryOrClose(dispose, true);
      const nextResult = closed
        ? { value: undefined, done: true }
        : tryOrClose(() => iter.next(...args));
      tryOrClose(() => {
        if (!nextResult.done) {
          /** @type {DisposableResourceRecord[]} */
          const stack = [];
          const { value } = nextResult;
          addDisposable(getDisposable(value), value, stack);
          // Call dispose in case of some re-entrancy
          dispose();
          pendingRecord = stack[0];
        }
      }, true);
      return nextResult;
    },
    /** @param {[] | [any]} args */
    return: (...args) => {
      closed = true;
      dispose();
      if (hasReturn) {
        // @ts-ignore
        return iter.return(...args);
      } else {
        return { value: args[0], done: true };
      }
    },
    /** @param {[] | [any]} args */
    throw: (...args) => {
      closed = true;
      dispose();
      if (hasThrow) {
        // @ts-ignore
        return iter.throw(...args);
      } else {
        if (hasReturn) {
          // @ts-ignore
          iter.return(undefined);
        }
        throw args[0];
      }
    },
    [Symbol.iterator]: () => wrapped,
    [symbolDispose]() {
      // @ts-ignore
      wrapped.return();
    },
  });

  return wrapped;
};

/**
 * @template T
 * @param {T} value
 * @param {IDisposable} disposable
 * @returns {import("./disposable.js").Disposable.UsingIterator<T>}
 */
const getIterator = (value, disposable) => {
  /** @type {IDisposable | undefined} */
  let res = disposable;

  let used = false;

  return createIterator({
    next() {
      if (!used && res) {
        used = true;
        return {
          value,
          done: false,
        };
      } else {
        if (res) {
          res[symbolDispose]();
          res = undefined;
        }
        return {
          value: undefined,
          done: true,
        };
      }
    },
    return() {
      used = true;
      try {
        if (res) {
          res[symbolDispose]();
          res = undefined;
        }
      } catch (disposeError) {
        // TODO: find a way to report when `return` triggered by a throw
        throw disposeError;
      }
      return {
        value: undefined,
        done: true,
      };
    },
    throw(err) {
      used = true;
      try {
        if (res) {
          res[symbolDispose]();
          res = undefined;
        }
      } catch (disposeError) {
        err = mergeCause(disposeError, err);
      }
      throw err;
    },
  });
};

export const Disposable = /** @type {DisposableConstructor} */ (
  class Disposable {
    /** @type {Array<DisposableResourceRecord>} */
    #resourceStack = [];

    /** @type {'pending'|'disposed'} */
    #state = "pending";

    /**
     * @param {DisposableResource[]} args
     */
    constructor(...args) {
      Object.defineProperty(this, "using", {
        value: this.using.bind(this),
        configurable: true,
        writable: true,
        enumerable: true,
      });

      if (args.length) this.#from(args);
    }

    [symbolDispose]() {
      if (this.#state === "disposed") {
        return;
      }
      this.#state = "disposed";

      const errors = [];
      const multipleResources = this.#resourceStack.length > 1;

      while (this.#resourceStack.length) {
        const record = /** @type {DisposableResourceRecord} */ (
          this.#resourceStack.pop()
        );

        try {
          disposeRecord(record);
        } catch (err) {
          errors.push(err);
        }
      }

      if (errors.length) {
        if (multipleResources) {
          throw new AggregateError(errors);
        } else {
          throw errors.pop();
        }
      }
    }

    /**
     * @param {any} value
     * @param {DisposeMethod} [onDispose]
     */
    using(value, onDispose) {
      const isDisposed = this.#state === "disposed";

      const stack = !isDisposed ? this.#resourceStack : [];

      typeof onDispose === "function"
        ? addDisposable(onDispose, value, stack)
        : addDisposable(value, value, stack);

      if (isDisposed) {
        /** @type {unknown} */
        let err = new TypeError(
          "Can't add resource, Disposable has already been disposed"
        );
        try {
          disposeRecord(/** @type {DisposableResourceRecord} */ (stack.pop()));
        } catch (disposeError) {
          err = mergeCause(disposeError, err);
        }
        throw err;
      }

      return value;
    }

    /**
     * @param {Iterable<unknown>} disposables
     * @param {MapFn} [mapFn]
     */
    #from(disposables, mapFn = defaultMapFn) {
      const res = this;
      const stack = res.#resourceStack;

      const errors = [];
      let iterationError;
      try {
        const syncIterable = /** @type {Iterable<unknown>} */ (disposables);
        for (const disposable of syncIterable) {
          addDisposable(mapFn(disposable), disposable, stack, (err) =>
            errors.push(err)
          );
        }
      } catch (err) {
        iterationError = err;
      }

      if (iterationError || errors.length) {
        const multipleResources = stack.length;
        try {
          res[symbolDispose]();
        } catch (err) {
          const disposeErrors = multipleResources
            ? /** @type {AggregateError} */ (err).errors
            : [err];

          errors.push(...disposeErrors);
        }

        let error;
        if (!errors.length) {
          error = iterationError;
        } else {
          error = new AggregateError(errors);
          if (iterationError) {
            error = mergeCause(error, iterationError);
          }
        }
        throw error;
      }
    }

    /**
     * @param {Iterable<unknown>} disposables
     * @param {MapFn} [mapFn]
     */
    static from(disposables, mapFn = undefined) {
      const res = new (this || Disposable)();
      res.#from(disposables, mapFn);

      return res;
    }

    /**
     *
     * @param {Iterable<unknown>} values
     * @param {MapFn} [mapFn]
     */
    static usingFrom(values, mapFn = defaultMapFn) {
      const syncIterable = /** @type {Iterable<unknown>} */ (values);

      if (typeof syncIterable[Symbol.iterator] !== "function") {
        throw new TypeError("values is not iterable");
      }

      if (typeof mapFn !== "function") {
        throw new TypeError("mapFn is not a function");
      }

      return {
        [Symbol.iterator]() {
          const iterator = syncIterable[Symbol.iterator]();
          return wrapIterator(iterator, mapFn);
        },
      };
    }

    /**
     * @param {any} value
     * @param {DisposeMethod} [onDispose]
     */
    static using(value, onDispose) {
      // Wrap value even if it's already a disposable
      const disposable = new (this || Disposable)();
      disposable.using(value, onDispose);
      return getIterator(value, disposable);
    }

    static [Symbol.iterator]() {
      const disposable = new (this || Disposable)();
      return getIterator(disposable, disposable);
    }
  }
);
