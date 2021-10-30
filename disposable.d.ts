import { symbolDispose } from "./symbols.js";

export interface Disposable {
  /**
   * Disposes resources within this object
   */
  [symbolDispose](): void;
}

declare namespace Disposable {
  /**
   * A disposable object aggregating multiple resources
   *
   * When the object is disposed of, the aggregated resources are disposed of
   * in reverse order to which they were added for tracking.
   */
  export interface Aggregate extends Disposable {
    /**
     * Helper adding new resources to track in the aggregated disposable.
     * The helper can be detached
     */
    readonly using: Using;
  }

  export interface Constructor {
    /**
     * Creates a disposable object aggregating the given disposable resources
     *
     * @param disposables An iterable containing resources to be disposed of
     * when the returned object is itself disposed of
     */
    from(disposables: Iterable<Resource>): Aggregate;

    /**
     * Creates a disposable object aggregating the given disposable resources
     *
     * @param values An iterable containing values for which the mapped
     * resource will be disposed of when the returned object is itself disposed of
     * @param mapFn A function returning a disposable resource from the
     * iterated value
     */
    from<T>(values: Iterable<T>, mapFn: (value: T) => Resource<T>): Aggregate;

    /**
     * Creates an aggregate disposable object
     *
     * @param args Initial resources to add for tracking
     */
    new (...args: Resource[]): Aggregate;

    /**
     * Wraps an iterable to ensure that iterated resources are disposed of
     *
     * @param disposables An iterable containing disposable resources over
     * which to iterate then dispose
     */
    usingFrom<T extends Resource>(disposables: Iterable<T>): Iterable<T>;

    /**
     * Wraps an iterable to ensure that iterated resources are disposed of
     *
     * @param values An iterable containing values over which to iterate
     * @param mapFn A function returning a disposable resource from the
     * iterated value
     */
    usingFrom<T>(
      values: Iterable<T>,
      mapFn: (value: T) => Resource<T>
    ): Iterable<T>;

    /**
     * Returns an iterator which yields a new aggregate instance. Its `using`
     * helper can be used to track disposable resources which will be disposed
     * of when the iterator is closed. Use with a `for-of` statement to perform
     * RAII style explicit resource management
     */
    [Symbol.iterator](): UsingIterator;
  }

  export interface Using {
    /**
     * Add a disposable resource for tracking
     *
     * @param disposable The disposable resource to track
     * @returns The disposable resource
     */
    <T extends Resource>(disposable: T): T;

    /**
     * Add a disposable resource for tracking
     *
     * @param value A value to consider as a resource to dispose
     * @param onDispose The dispose callback invoked with the value
     * as `this` context
     * @returns The value
     */
    <T>(value: T, onDispose: OnDispose<T>): T;
  }

  export type OnDispose<T = void> = (this: T) => void;

  export type Resource<T = void> = Disposable | OnDispose<T>;

  export type UsingIterator = Iterator<Aggregate, void, void>;
}

export declare const Disposable: Disposable.Constructor;
