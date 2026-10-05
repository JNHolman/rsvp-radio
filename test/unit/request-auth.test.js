"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isLoopbackAddress, tokenMatches, webhookAllowed, isCrossSiteBrowserRequest, browserMutationAllowed } = require("../../intelligence/request-auth");

test("loopback address recognition covers IPv4 and IPv6 forms", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.50"), false);
});

test("token comparison rejects missing, wrong, and length-mismatched tokens", () => {
  assert.equal(tokenMatches("secret", "secret"), true);
  assert.equal(tokenMatches("secret", "wrong!"), false);
  assert.equal(tokenMatches("secret", "short"), false);
  assert.equal(tokenMatches("", ""), false);
});

test("webhook allows loopback without a token and remote only with configured token", () => {
  assert.equal(webhookAllowed({ remoteAddress: "127.0.0.1" }), true);
  assert.equal(webhookAllowed({ remoteAddress: "192.168.1.8", configuredToken: "abc", presentedToken: "abc" }), true);
  assert.equal(webhookAllowed({ remoteAddress: "192.168.1.8", configuredToken: "", presentedToken: "" }), false);
  assert.equal(webhookAllowed({ remoteAddress: "192.168.1.8", configuredToken: "abc", presentedToken: "bad" }), false);
});


test("cross-site browser mutations are distinguishable without blocking non-browser clients", () => {
  assert.equal(isCrossSiteBrowserRequest("cross-site"), true);
  assert.equal(isCrossSiteBrowserRequest("same-origin"), false);
  assert.equal(isCrossSiteBrowserRequest("same-site"), false);
  assert.equal(isCrossSiteBrowserRequest(""), false);
});


test("browser mutation guard rejects foreign Origin without blocking direct LAN clients", () => {
  assert.equal(browserMutationAllowed({ secFetchSite: "", origin: "", host: "rsvp.local:3000" }), true);
  assert.equal(browserMutationAllowed({ secFetchSite: "same-origin", origin: "http://rsvp.local:3000", host: "rsvp.local:3000" }), true);
  assert.equal(browserMutationAllowed({ secFetchSite: "same-site", origin: "http://evil.local:3000", host: "rsvp.local:3000" }), false);
  assert.equal(browserMutationAllowed({ secFetchSite: "cross-site", origin: "http://rsvp.local:3000", host: "rsvp.local:3000" }), false);
  assert.equal(browserMutationAllowed({ secFetchSite: "", origin: "null", host: "rsvp.local:3000" }), false);
});
