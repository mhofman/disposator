// @ts-check
/// <reference lib="dom" />

import "./polyfill.js";

/**
 * @typedef {import("./index.js").Disposable & {name: string}} NamedDisposable
 */

/**
 * @typedef {import("./index.js").AsyncDisposable & {name: string}} NamedAsyncDisposable
 */

/** @param {{name: string}} obj */
function cleanup(obj) {
  console.log(`Cleaning ${obj.name}`);
}

/**
 *
 * @param {string} name
 * @returns {NamedDisposable}
 */
const getResource = (name) => {
  console.log(`creating ${name}`);
  return {
    name,
    [Symbol.dispose]() {
      cleanup(this);
    },
  };
};

/** @param {Iterable<string>} names */
const getResources = function* (names) {
  try {
    console.log("generating resources for", names);
    for (const name of names) {
      yield getResource(name);
    }
  } finally {
    console.log("done generating resources");
  }
};

/**
 *
 * @param {string} name
 * @returns {NamedAsyncDisposable}
 */
const getAsyncResource = (name) => {
  console.log(`creating async ${name}`);
  return {
    name,
    async [Symbol.asyncDispose]() {
      await Promise.resolve();
      cleanup(this);
    },
  };
};

/** @param {Iterable<string>} names */
const getAsyncResources = function* (names) {
  try {
    console.log("generating async resources for", names);
    for (const name of names) {
      yield getAsyncResource(name);
    }
  } finally {
    console.log("done generating async resources");
  }
};

/** @param {Iterable<string>} names */
const getResourcesAsync = async function* (names) {
  try {
    console.log("generating resources async for", names);
    let i = 0;
    for (const name of names) {
      await Promise.resolve();
      yield ++i % 2 ? getAsyncResource(name) : getResource(name);
    }
  } finally {
    console.log("done generating resources async");
  }
};

const testNames = ["hello", "bonjour"];

for (const using of Disposable) {
  const res1 = using(getResource("ola"));
  console.log(`using ${res1.name}`);
  const res2 = using(getResource("gracias"));
  console.log(`using ${res2.name}`);
  using(Disposable.from(getResources(testNames)));
  console.log("using aggregate");
  using(new Disposable(() => console.log("done")));
}

for (const using of Disposable) {
  using(new Disposable(() => console.log("cleaning after break")));
  break;
}

try {
  for (const using of Disposable) {
    using(new Disposable(() => console.log("cleaning after throw")));
    throw new Error();
  }
} catch (err) {}

for (const res of Disposable.usingFrom(getResources(testNames))) {
  console.log(`using ${res.name}`);
}

for (const res of Disposable.usingFrom(getResources(testNames))) {
  console.log(`using ${res.name}`);
  break;
}

try {
  for (const res of Disposable.usingFrom(getResources(["trouble"]))) {
    console.log(`using ${res.name}`);
    throw new Error();
  }
} catch (err) {}

for (const obj of Disposable.usingFrom(
  testNames.map((name) => ({ name })),
  (obj) => new Disposable(() => cleanup(obj))
)) {
  console.log(`using ${obj.name}`);
}

for await (const using of AsyncDisposable) {
  const res1 = using(getResource("ola"));
  console.log(`async using ${res1.name}`);
  const res2 = using(getAsyncResource("gracias"));
  console.log(`async using ${res2.name}`);
  using(await AsyncDisposable.from(getAsyncResources(testNames)));
  console.log("using async aggregate");
  using(await AsyncDisposable.from(getResourcesAsync(testNames)));
  console.log("using aggregate async");
  using(new AsyncDisposable(() => console.log("done")));
}

for await (const using of AsyncDisposable) {
  using(new AsyncDisposable(() => console.log("cleaning after break async")));
  break;
}

try {
  for await (const using of AsyncDisposable) {
    using(new AsyncDisposable(() => console.log("cleaning after throw async")));
    throw new Error();
  }
} catch (err) {}

for await (const res of AsyncDisposable.usingFrom(
  getAsyncResources(testNames)
)) {
  console.log(`using async ${res.name}`);
}

for await (const res of AsyncDisposable.usingFrom(
  getResourcesAsync(testNames)
)) {
  console.log(`async using ${res.name}`);
}
