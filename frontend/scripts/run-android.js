const { spawnSync } = require("child_process");
const path = require("path");

const frontendDir = process.cwd();
const sdkDir = process.env.ANDROID_HOME
  || process.env.ANDROID_SDK_ROOT
  || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : "");
const javaHome = process.env.JAVA_HOME || "C:\\Program Files\\Android\\Android Studio\\jbr";

const env = { ...process.env };
if (sdkDir) {
  env.ANDROID_HOME = sdkDir;
  env.ANDROID_SDK_ROOT = sdkDir;
  env.ANDROID_AVD_HOME = env.ANDROID_AVD_HOME || path.join(env.USERPROFILE || "", ".android", "avd");
}
if (process.platform === "win32" && !process.env.JAVA_HOME) {
  env.JAVA_HOME = javaHome;
}

const pathParts = [
  env.JAVA_HOME ? path.join(env.JAVA_HOME, "bin") : null,
  sdkDir ? path.join(sdkDir, "platform-tools") : null,
  sdkDir ? path.join(sdkDir, "emulator") : null,
  env.Path || env.PATH,
].filter(Boolean);
env.Path = pathParts.join(path.delimiter);
env.PATH = env.Path;

function run(command, args, options = {}) {
  const useShell = process.platform === "win32" && command.endsWith(".cmd");
  return spawnSync(command, args, {
    cwd: frontendDir,
    env,
    stdio: "inherit",
    shell: useShell,
    ...options,
  });
}

function tryReverse(port) {
  const result = run("adb", ["reverse", `tcp:${port}`, `tcp:${port}`], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

tryReverse(8000);
tryReverse(8081);

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = run(npxCommand, ["react-native", "run-android", "--no-packager"]);

if (result.error) {
  process.stderr.write(`Failed to run Android app: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 0);
