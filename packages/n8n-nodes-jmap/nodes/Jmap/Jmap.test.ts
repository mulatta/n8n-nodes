import {
  buildMailboxPaths,
  keywordsFromString,
  matchImapListPattern,
} from "./Jmap";

describe("JMAP helpers", () => {
  it("maps IMAP flags to JMAP keywords", () => {
    expect(keywordsFromString("\\Seen \\Flagged $draft custom")).toEqual({
      $seen: true,
      $flagged: true,
      $draft: true,
      custom: true,
    });
  });

  it("matches IMAP LIST wildcards against assembled paths", () => {
    expect(matchImapListPattern("INBOX", "%", "/")).toBe(true);
    expect(matchImapListPattern("Projects", "%", "/")).toBe(true);
    expect(matchImapListPattern("Projects/Work", "%", "/")).toBe(false);
    expect(matchImapListPattern("Projects/Work", "*", "/")).toBe(true);
    expect(matchImapListPattern("Projects/Work", "Projects/%", "/")).toBe(true);
  });

  it("assembles mailbox paths from parent ids", () => {
    expect(
      buildMailboxPaths(
        [
          { id: "root", name: "Projects", parentId: null },
          { id: "child", name: "Work", parentId: "root" },
        ],
        "/",
      ),
    ).toEqual([
      { id: "root", name: "Projects", parentId: null, path: "Projects" },
      { id: "child", name: "Work", parentId: "root", path: "Projects/Work" },
    ]);
  });
});
