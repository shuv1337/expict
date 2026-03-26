import { assert, describe, it } from "vite-plus/test";
import { Effect, Option } from "effect";
import { Browsers } from "../src/browser-detector";
import { layerLive } from "../src/layers";

describe("Browsers", () => {
  it("returns an array of detected browsers", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const results = yield* browsers.list;
      assert.isArray(results);
      for (const browser of results) {
        assert.isString(browser._tag);
      }
    }).pipe(Effect.provide(layerLive), Effect.runPromise));

  it("chromium browsers have an executablePath", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const results = yield* browsers.list;
      const chromium = results.filter((browser) => browser._tag === "ChromiumBrowser");
      assert.isAbove(chromium.length, 0);
      for (const browser of chromium) {
        assert.isString(browser.executablePath);
        assert.notStrictEqual(browser.executablePath, "");
      }
    }).pipe(Effect.provide(layerLive), Effect.runPromise));

  it("defaultBrowser returns a known browser when one is detected", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const result = yield* browsers.defaultBrowser();
      if (Option.isNone(result)) {
        assert.isTrue(true);
        return;
      }
      const tag = result.value._tag;
      assert.isTrue(
        tag === "ChromiumBrowser" || tag === "FirefoxBrowser" || tag === "SafariBrowser",
      );
    }).pipe(Effect.provide(layerLive), Effect.runPromise));
});
