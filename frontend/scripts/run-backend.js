const { existsSync } = require("fs");
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const frontendDir = process.cwd();
const rootDir = path.resolve(frontendDir, "..");
const backendDir = path.join(rootDir, "backend");
const requirementsPath = path.join(backendDir, "requirements.txt");
const backendAppPath = path.join(backendDir, "app", "main.py");
const venvPython = process.platform === "win32"
  ? path.join(backendDir, ".venv", "Scripts", "python.exe")
  : path.join(backendDir, ".venv", "bin", "python");

const systemPythonCandidates = process.platform === "win32"
  ? ["py", "python"]
  : ["python3", "python"];

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error) {
    return false;
  }

  return result.status === 0;
}

function canRun(command) {
  const probeArgs = command === "py" ? ["-3", "--version"] : ["--version"];
  const result = spawnSync(command, probeArgs, {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    return false;
  }

  if (result.status === 0) {
    return true;
  }

  const stderr = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  return !stderr.includes("Unable to create process");
}

function findSystemPython() {
  return systemPythonCandidates.find((command) => canRun(command)) ?? null;
}

function pythonArgs(command, args) {
  return command === "py" ? ["-3", ...args] : args;
}

function ensureVenv(systemPython) {
  if (!existsSync(requirementsPath) || !existsSync(backendAppPath)) {
    fail("Backend app is not available yet. Expected backend/requirements.txt and backend/app/main.py.");
  }

  if (existsSync(venvPython)) {
    return;
  }

  log("Creating backend virtual environment...");
  const ok = run(systemPython, pythonArgs(systemPython, ["-m", "venv", "backend/.venv"]));
  if (!ok || !existsSync(venvPython)) {
    fail("Failed to create backend/.venv.");
  }
}

function ensurePip() {
  if (run(venvPython, ["-m", "pip", "--version"], { stdio: "ignore" })) {
    return;
  }

  log("Bootstrapping pip in backend virtual environment...");
  if (!run(venvPython, ["-m", "ensurepip", "--upgrade"])) {
    fail("Failed to install pip into backend/.venv.");
  }
}

function hasModule(moduleName) {
  return run(venvPython, ["-c", `import ${moduleName}`], { stdio: "ignore" });
}

function ensureRequirements() {
  if (hasModule("uvicorn") && hasModule("fastapi")) {
    return;
  }

  log("Installing backend Python dependencies...");
  const ok = run(venvPython, ["-m", "pip", "install", "-r", path.relative(rootDir, requirementsPath)]);
  if (!ok) {
    fail("Failed to install backend Python dependencies from backend/requirements.txt.");
  }
}

function startBackend() {
  const enableReload = process.argv.includes("--reload");
  const uvicornArgs = ["-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"];
  if (enableReload) {
    uvicornArgs.splice(3, 0, "--reload");
  }

  const child = spawn(
    venvPython,
    uvicornArgs,
    {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
    }
  );

  child.on("error", (error) => {
    fail(`Failed to start backend: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

const systemPython = findSystemPython();

if (!systemPython) {
  if (process.platform === "win32") {
    fail("No usable Python interpreter was found. Install Python 3 and make sure `py` or `python` is available.");
  } else {
    fail("No usable Python interpreter was found. Install Python 3 and make sure `python3` or `python` is available.");
  }
}

ensureVenv(systemPython);
ensurePip();
ensureRequirements();
startBackend();
