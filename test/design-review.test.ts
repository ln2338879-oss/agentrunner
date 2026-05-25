import { describe, expect, test } from "bun:test";
import { needsDesignChoice } from "../src/design/review";
import { formatUserPing } from "../src/discord/mention-format";

describe("design review helpers", () => {
  test("detects user choice wording for design requests", () => {
    expect(needsDesignChoice("로고 시안 중 하나 골라줘")).toBe(true);
    expect(needsDesignChoice("이 디자인에 내 의견이 필요해")).toBe(true);
  });

  test("allows direct design generation wording", () => {
    expect(needsDesignChoice("픽셀아트 아이콘 만들어줘")).toBe(false);
  });

  test("formats Discord user ping", () => {
    expect(formatUserPing("12345")).toBe("<@12345>");
  });
});
