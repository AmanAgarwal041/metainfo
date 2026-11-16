// The server-side half (lib/traffic.ts): who a reported visitor was.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, hostMatches, normalisePath, referralSource } from "../../lib/traffic.ts";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

test("crawlers are recognised by their user agent", () => {
  const cases: [string, string, string][] = [
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)", "ai_training", "gptbot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ai_user", "chatgpt-user"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)", "ai_search", "oai-searchbot"],
    ["Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)", "ai_search", "claude-searchbot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ai_training", "claudebot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", "ai_user", "perplexity-user"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "search", "googlebot"],
    ["Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "search", "googlebot"],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "search", "bingbot"],
    ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "preview", "facebookexternalhit"],
    ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "preview", "slackbot"],
  ];
  for (const [ua, kind, agent] of cases) assert.deepEqual(classify(ua), { kind, agent }, ua);
});

test("people and scripts", () => {
  assert.deepEqual(classify(CHROME, "navigate"), { kind: "human", agent: "" });
  // A browser UA without fetch metadata: a script pretending.
  assert.deepEqual(classify(CHROME), { kind: "bot", agent: "other" });
  assert.deepEqual(classify("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), { kind: "human", agent: "" });
  assert.deepEqual(classify("curl/8.4.0"), { kind: "bot", agent: "other" });
  assert.deepEqual(classify("python-requests/2.31"), { kind: "bot", agent: "other" });
  assert.deepEqual(classify(""), { kind: "bot", agent: "other" });
  assert.deepEqual(classify(CHROME, undefined, '"https://chatgpt.com"'), { kind: "ai_user", agent: "signed-agent" });
});

test("where people came from", () => {
  assert.equal(referralSource("https://chatgpt.com/c/1", undefined, "example.com"), "chatgpt");
  assert.equal(referralSource(undefined, "chatgpt.com", "example.com"), "chatgpt");
  assert.equal(referralSource("https://www.perplexity.ai/search", undefined, "example.com"), "perplexity");
  assert.equal(referralSource("https://gemini.google.com/app", undefined, "example.com"), "gemini");
  assert.equal(referralSource("https://www.google.co.uk/", undefined, "example.com"), "google");
  assert.equal(referralSource("https://news.ycombinator.com/item", undefined, "example.com"), "news.ycombinator.com");
  assert.equal(referralSource("https://www.example.com/blog", undefined, "example.com"), "internal");
  assert.equal(referralSource(undefined, undefined, "example.com"), "direct");
  assert.equal(referralSource("not a url", undefined, "example.com"), "direct");
});

test("paths and hosts", () => {
  assert.equal(normalisePath("/pricing/"), "/pricing");
  assert.equal(normalisePath("/"), "/");
  assert.equal(normalisePath("/a?b=1"), "/a");
  assert.equal(hostMatches("www.example.com", "example.com"), true);
  assert.equal(hostMatches("docs.example.com:443", "example.com"), true);
  assert.equal(hostMatches("example.com.evil.net", "example.com"), false);
  assert.equal(hostMatches("myproject.pages.dev", "example.com"), false);
});
