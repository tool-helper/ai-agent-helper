import assert from "node:assert/strict";
import { test } from "node:test";
import { configKeySchema, configSchema, proxyUrlSchema } from "../src/index.js";

test("omitted fields yield defaults without inventing a proxy", () => {
  assert.deepEqual(configSchema.parse({}), { version: 1, no_proxy: [] });
});

test("valid proxy endpoints include HTTPS, encoded credentials and IPv6", () => {
  for (const proxy of [
    "http://127.0.0.1:7890",
    "https://proxy.example.com:8443/",
    "http://user:p%40ss@proxy.example.com:8080",
    "http://[::1]:7890",
  ]) {
    assert.equal(configSchema.parse({ proxy }).proxy, proxy);
  }
});

test("invalid and unsupported proxy endpoints are rejected", () => {
  for (const proxy of [
    "", "proxy.example.com:7890", "http:localhost", "socks5://127.0.0.1:7890", "file:///tmp/proxy",
    "http://", "http://localhost:99999", " http://localhost:7890",
    "http://local host:7890", "http://localhost/api", "http://localhost?token=secret",
    "http://localhost#fragment",
  ]) {
    assert.equal(proxyUrlSchema.safeParse(proxy).success, false, proxy);
  }
});

test("a bypass list retains one rule per entry", () => {
  const rules = ["localhost", "127.0.0.1", "::1", ".example.com"];
  assert.deepEqual(configSchema.parse({ no_proxy: rules }).no_proxy, rules);
  for (const no_proxy of ["localhost", [""], [" localhost"], ["localhost,127.0.0.1"]]) {
    assert.equal(configSchema.safeParse({ no_proxy }).success, false);
  }
});

test("unknown keys, future format versions and incorrect types fail validation", () => {
  for (const value of [
    { version: 2 }, { version: "1" }, { porxy: "http://localhost:7890" },
    { proxy: null }, { proxy: false }, { no_proxy: [123] }, { install: {} },
  ]) {
    assert.equal(configSchema.safeParse(value).success, false);
  }
});

test("only user-editable keys are accepted by the configuration key model", () => {
  assert.equal(configKeySchema.parse("proxy"), "proxy");
  assert.equal(configKeySchema.parse("no_proxy"), "no_proxy");
  assert.equal(configKeySchema.safeParse("version").success, false);
  assert.equal(configKeySchema.safeParse("unknown").success, false);
});
