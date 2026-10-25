import { describe, expect, it } from "vitest";
import { buildWindowsStartupCommand } from "../src/startup.js";

describe("Windows startup command", () => {
  const common = {
    cli: String.raw`C:\Program Files\ilias-sync\dist\cli.js`,
    projectDir: String.raw`C:\Program Files\ilias-sync`,
    logPath: String.raw`C:\Users\Test User\.config\ilias-sync\ilias-sync.log`,
  };

  it("launches a packaged executable directly and retries after failure", () => {
    const command = buildWindowsStartupCommand({
      ...common,
      executable: String.raw`C:\Program Files\ilias-sync\ilias-sync.exe`,
      packaged: true,
    });

    expect(command).toContain(String.raw`"C:\Program Files\ilias-sync\ilias-sync.exe" watch`);
    expect(command).not.toContain("dist\\cli.js");
    expect(command).toContain("if not errorlevel 1 exit /b 0");
    expect(command).toContain("goto retry");
  });

  it("launches the compiled CLI with Node for source installations", () => {
    const command = buildWindowsStartupCommand({
      ...common,
      executable: String.raw`C:\Program Files\nodejs\node.exe`,
      packaged: false,
    });

    expect(command).toContain(String.raw`cd /d "C:\Program Files\ilias-sync"`);
    expect(command).toContain(String.raw`"C:\Program Files\nodejs\node.exe" "C:\Program Files\ilias-sync\dist\cli.js" watch`);
  });
});
