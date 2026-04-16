<?php
/**
 * Vela CMS Web Installer
 *
 * Standalone installer that works without Laravel/Composer.
 * Handles: requirements check, .env setup, composer install, migrations, admin user, setup wizard.
 * Self-disables after installation.
 *
 * Cross-platform: Linux, macOS, Windows. Supports Apache, Nginx, IIS.
 */

// ============================================================================
// SECURITY: Abort if already installed
// ============================================================================

$basePath = dirname(__DIR__);

if (file_exists($basePath . '/storage/vela_installed')) {
    http_response_code(404);
    exit('<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>');
}

// ============================================================================
// CONFIGURATION
// ============================================================================

set_time_limit(300);
error_reporting(E_ALL & ~E_DEPRECATED & ~E_STRICT);

// ============================================================================
// SESSION (secure defaults)
// ============================================================================

ini_set('session.use_strict_mode', '1');
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Strict');
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
    ini_set('session.cookie_secure', '1');
}
session_start();

if (empty($_SESSION['_init'])) {
    session_regenerate_id(true);
    $_SESSION['_init'] = true;
}

// ============================================================================
// CSRF TOKEN
// ============================================================================

if (empty($_SESSION['_csrf'])) {
    $_SESSION['_csrf'] = bin2hex(random_bytes(32));
}
$csrfToken = $_SESSION['_csrf'];

function verifyCsrf(): bool
{
    return isset($_POST['_token'], $_SESSION['_csrf'])
        && hash_equals($_SESSION['_csrf'], $_POST['_token']);
}

// ============================================================================
// SECURITY HEADERS
// ============================================================================

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isWindows(): bool
{
    return strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';
}

function nullDev(): string
{
    return isWindows() ? 'NUL' : '/dev/null';
}

function parseEnvFile(string $path): array
{
    if (!file_exists($path)) {
        return [];
    }
    $vars = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (strpos($line, '=') === false) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        // Strip surrounding quotes
        if (strlen($value) >= 2) {
            $first = $value[0];
            $last = substr($value, -1);
            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                $value = substr($value, 1, -1);
            }
        }
        $vars[$key] = $value;
    }
    return $vars;
}

function escapeEnvValue(string $value): string
{
    // Strip control characters that could inject new .env lines
    $value = str_replace(["\r", "\n", "\0"], '', $value);
    if ($value === '' || preg_match('/[\s"\'#\\\\$]/', $value)) {
        return '"' . str_replace(['\\', '"', '$'], ['\\\\', '\\"', '\\$'], $value) . '"';
    }
    return $value;
}

function testDbConnection(string $host, string $port, string $name, string $user, string $pass): ?string
{
    try {
        $dsn = "mysql:host={$host};port={$port};dbname={$name}";
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        $pdo = null;
        return null;
    } catch (PDOException $e) {
        return $e->getMessage();
    }
}

function findComposerBinary(string $basePath): string
{
    $nd = nullDev();

    // Global composer in PATH
    $cmd = isWindows() ? "where composer 2>{$nd}" : "which composer 2>{$nd}";
    $global = trim(shell_exec($cmd) ?? '');
    if ($global) {
        // 'where' on Windows may return multiple lines; escapeshellarg for safe use in commands
        return escapeshellarg(trim(strtok($global, "\n")));
    }

    // Downloaded phar in storage
    $phar = $basePath . '/storage/composer.phar';
    if (file_exists($phar)) {
        return escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($phar);
    }

    return '';
}

function hasGit(): bool
{
    $nd = nullDev();
    $cmd = isWindows() ? "where git 2>{$nd}" : "which git 2>{$nd}";
    return (bool) trim(shell_exec($cmd) ?? '');
}

function shellFunctionsAvailable(): bool
{
    $disabled = array_map('trim', explode(',', ini_get('disable_functions') ?: ''));
    return !in_array('exec', $disabled, true) && !in_array('shell_exec', $disabled, true);
}

function installerCss(): string
{
    return <<<'CSS'
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; color: #1e293b; line-height: 1.6; }
.container { max-width: 640px; margin: 40px auto; padding: 0 20px; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); padding: 32px; margin-bottom: 24px; }
h1 { font-size: 24px; margin-bottom: 8px; }
h2 { font-size: 18px; margin-bottom: 16px; color: #475569; }
.subtitle { color: #64748b; margin-bottom: 24px; }
.steps { display: flex; gap: 4px; margin-bottom: 32px; }
.step-dot { flex: 1; height: 4px; border-radius: 2px; background: #e2e8f0; }
.step-dot.active { background: #4f46e5; }
.step-dot.done { background: #22c55e; }
.check-list { list-style: none; }
.check-list li { padding: 8px 0; display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; }
.check-ok { color: #22c55e; font-weight: 600; }
.check-fail { color: #ef4444; font-weight: 600; }
.check-warn { color: #f59e0b; font-weight: 600; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 14px; }
.form-group input[type="text"],
.form-group input[type="email"],
.form-group input[type="password"] { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
.form-group input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,.1); }
.form-group small { color: #94a3b8; font-size: 12px; }
.btn { display: inline-block; padding: 10px 24px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-primary:hover { background: #4338ca; }
.btn-secondary { background: #e2e8f0; color: #475569; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.alert { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
.alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.alert-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin .6s linear infinite; vertical-align: middle; margin-right: 8px; }
.spinner-large { display: inline-block; width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top-color: #4f46e5; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.auto-status { text-align: center; padding: 32px 0; }
.auto-status p { margin-top: 16px; color: #64748b; font-size: 15px; }
.complete-icon { font-size: 48px; text-align: center; margin-bottom: 16px; }
.option-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
.option-box p { color: #64748b; font-size: 13px; margin: 8px 0 0 26px; }
code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
hr.divider { margin: 20px 0; border: none; border-top: 1px solid #e2e8f0; }
CSS;
}

// ============================================================================
// INSTALL CODE GATE
// ============================================================================

$installCodeFile = $basePath . '/storage/install_code';
$needsInstallCode = file_exists($installCodeFile);
$installCodeOk = !empty($_SESSION['_code_ok']);
$installCodeErrors = [];

if ($needsInstallCode && !$installCodeOk) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['install_code'])) {
        if (!verifyCsrf()) {
            $installCodeErrors[] = 'Invalid request. Please reload and try again.';
        } else {
            $attempts = $_SESSION['_code_attempts'] ?? 0;
            if ($attempts >= 10) {
                $installCodeErrors[] = 'Too many failed attempts. Please wait a moment and try again.';
                usleep(500000);
            } else {
                $expected = trim(file_get_contents($installCodeFile));
                if (hash_equals($expected, trim($_POST['install_code']))) {
                    $_SESSION['_code_ok'] = true;
                    $installCodeOk = true;
                    // PRG redirect to avoid resubmission
                    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
                    exit;
                } else {
                    $_SESSION['_code_attempts'] = $attempts + 1;
                    $installCodeErrors[] = 'Invalid install code.';
                }
            }
        }
    }

    if (!$installCodeOk) {
        ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vela CMS - Installation</title>
    <style><?= installerCss() ?></style>
</head>
<body>
<div class="container">
    <div class="card">
        <div style="text-align:center;margin-bottom:8px">
            <img src="images/vela-logo-black.png" alt="Vela CMS" style="height:70px;width:auto">
        </div>
        <p class="subtitle" style="text-align:center">Installation Wizard</p>

        <?php foreach ($installCodeErrors as $err): ?>
            <div class="alert alert-error"><?= htmlspecialchars($err) ?></div>
        <?php endforeach; ?>

        <h2>Install Code Required</h2>
        <p style="margin-bottom:16px">This installer is protected. Enter the code found in <code>storage/install_code</code> on the server to continue.</p>
        <form method="POST">
            <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">
            <div class="form-group">
                <label>Install Code</label>
                <input type="text" name="install_code" required autofocus autocomplete="off">
            </div>
            <button type="submit" class="btn btn-primary">Continue</button>
        </form>
    </div>
</div>
</body>
</html>
        <?php
        exit;
    }
}

// ============================================================================
// PARSE EXISTING .env & DETERMINE SKIP FLAGS
// ============================================================================

$envVars = parseEnvFile($basePath . '/.env');
$envHasWorkingDb = false;
$envHasStaticConfig = false;

if (!empty($envVars['DB_DATABASE']) && !empty($envVars['DB_USERNAME'])) {
    $dbErr = testDbConnection(
        $envVars['DB_HOST'] ?? '127.0.0.1',
        $envVars['DB_PORT'] ?? '3306',
        $envVars['DB_DATABASE'],
        $envVars['DB_USERNAME'],
        $envVars['DB_PASSWORD'] ?? ''
    );
    $envHasWorkingDb = ($dbErr === null);
}

if (array_key_exists('VELA_COMMIT_STATIC', $envVars)) {
    $envHasStaticConfig = true;
}

// If skipping env step, ensure APP_KEY exists
if ($envHasWorkingDb && file_exists($basePath . '/.env')) {
    $envContent = file_get_contents($basePath . '/.env');
    $hasKey = (bool) preg_match('/^APP_KEY=.+$/m', $envContent);
    if (!$hasKey) {
        $appKey = 'base64:' . base64_encode(random_bytes(32));
        if (preg_match('/^APP_KEY=\s*$/m', $envContent)) {
            $envContent = preg_replace('/^APP_KEY=\s*$/m', 'APP_KEY=' . $appKey, $envContent);
        } else {
            $envContent = rtrim($envContent) . "\nAPP_KEY=" . $appKey . "\n";
        }
        file_put_contents($basePath . '/.env', $envContent);
    }
}

// ============================================================================
// DETERMINE STEP
// ============================================================================

$step = $_POST['step'] ?? $_GET['step'] ?? 'requirements';
$errors = [];
$success = [];

// Compute the correct "next step" after requirements
$nextAfterRequirements = 'environment';
if ($envHasWorkingDb) {
    $nextAfterRequirements = file_exists($basePath . '/vendor/autoload.php') ? 'database' : 'composer';
}

// Apply skip logic on GET requests so skipped steps are never rendered
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    if ($step === 'environment' && $envHasWorkingDb) {
        $step = file_exists($basePath . '/vendor/autoload.php') ? 'database' : 'composer';
    }
    if ($step === 'composer' && file_exists($basePath . '/vendor/autoload.php')) {
        $step = 'database';
    }
}

// ============================================================================
// STEP HANDLERS
// ============================================================================

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Don't re-process install-code POSTs that already passed the gate
    if (!isset($_POST['install_code'])) {
        if (!verifyCsrf()) {
            $errors[] = 'Invalid request token. Please reload the page and try again.';
        } else {
            switch ($step) {
                case 'environment':
                    $step = handleEnvironment($basePath);
                    break;
                case 'composer':
                    $step = handleComposer($basePath);
                    break;
                case 'database':
                    $step = handleDatabase($basePath);
                    break;
                case 'admin':
                    $step = handleAdmin($basePath);
                    break;
                case 'finalize':
                    $step = handleFinalize($basePath, $envVars);
                    break;
            }
        }
    }
}

// ============================================================================
// REQUIREMENTS CHECK
// ============================================================================

function checkRequirements(string $basePath): array
{
    $checks = [];
    $checks['php_version'] = [
        'label' => 'PHP >= 8.1',
        'ok' => version_compare(PHP_VERSION, '8.1.0', '>='),
        'value' => PHP_VERSION,
    ];
    $checks['pdo'] = [
        'label' => 'PDO Extension',
        'ok' => extension_loaded('pdo'),
        'value' => extension_loaded('pdo') ? 'Installed' : 'Missing',
    ];
    $checks['pdo_mysql'] = [
        'label' => 'PDO MySQL',
        'ok' => extension_loaded('pdo_mysql'),
        'value' => extension_loaded('pdo_mysql') ? 'Installed' : 'Missing',
    ];
    $checks['mbstring'] = [
        'label' => 'Mbstring Extension',
        'ok' => extension_loaded('mbstring'),
        'value' => extension_loaded('mbstring') ? 'Installed' : 'Missing',
    ];
    $checks['openssl'] = [
        'label' => 'OpenSSL Extension',
        'ok' => extension_loaded('openssl'),
        'value' => extension_loaded('openssl') ? 'Installed' : 'Missing',
    ];
    $checks['json'] = [
        'label' => 'JSON Extension',
        'ok' => extension_loaded('json'),
        'value' => extension_loaded('json') ? 'Installed' : 'Missing',
    ];
    $checks['curl'] = [
        'label' => 'cURL Extension',
        'ok' => extension_loaded('curl'),
        'value' => extension_loaded('curl') ? 'Installed' : 'Missing',
    ];
    $checks['gd'] = [
        'label' => 'GD Extension',
        'ok' => extension_loaded('gd'),
        'value' => extension_loaded('gd') ? 'Installed' : 'Missing (optional, for images)',
        'optional' => true,
    ];
    $checks['exec'] = [
        'label' => 'Shell functions (exec)',
        'ok' => shellFunctionsAvailable(),
        'value' => shellFunctionsAvailable() ? 'Available' : 'Disabled — required for Composer',
    ];
    $checks['storage_writable'] = [
        'label' => 'storage/ writable',
        'ok' => is_writable($basePath . '/storage'),
        'value' => is_writable($basePath . '/storage') ? 'Writable' : 'Not writable',
    ];
    $checks['root_writable'] = [
        'label' => 'Root dir writable (.env)',
        'ok' => is_writable($basePath),
        'value' => is_writable($basePath) ? 'Writable' : 'Not writable',
    ];
    return $checks;
}

// ============================================================================
// ENVIRONMENT SETUP
// ============================================================================

function handleEnvironment(string $basePath): string
{
    global $errors, $success;

    $dbHost = trim($_POST['db_host'] ?? '127.0.0.1');
    $dbPort = trim($_POST['db_port'] ?? '3306');
    $dbName = trim($_POST['db_name'] ?? '');
    $dbUser = trim($_POST['db_user'] ?? '');
    $dbPass = $_POST['db_pass'] ?? '';
    $appUrl = trim($_POST['app_url'] ?? '');
    $appName = trim($_POST['app_name'] ?? 'Vela CMS');

    // If password field was left blank and .env has an existing one, keep it
    $existingEnv = parseEnvFile($basePath . '/.env');
    if ($dbPass === '' && !empty($existingEnv['DB_PASSWORD'])) {
        $dbPass = $existingEnv['DB_PASSWORD'];
    }

    if (!$dbName || !$dbUser) {
        $errors[] = 'Database name and user are required.';
        return 'environment';
    }

    // Test DB connection
    $dbError = testDbConnection($dbHost, $dbPort, $dbName, $dbUser, $dbPass);
    if ($dbError !== null) {
        $errors[] = 'Database connection failed: ' . $dbError;
        return 'environment';
    }

    // Values to write/update
    $updates = [
        'APP_NAME' => $appName,
        'APP_URL' => $appUrl,
        'ASSET_URL' => $appUrl,
        'APP_ENV' => 'production',
        'APP_DEBUG' => 'false',
        'DB_CONNECTION' => 'mysql',
        'DB_HOST' => $dbHost,
        'DB_PORT' => $dbPort,
        'DB_DATABASE' => $dbName,
        'DB_USERNAME' => $dbUser,
        'DB_PASSWORD' => $dbPass,
    ];

    $envPath = $basePath . '/.env';
    $examplePath = $basePath . '/.env.example';

    // Determine source: existing .env > .env.example > build from scratch
    if (file_exists($envPath)) {
        $lines = file($envPath, FILE_IGNORE_NEW_LINES);
    } elseif (file_exists($examplePath)) {
        $lines = file($examplePath, FILE_IGNORE_NEW_LINES);
    } else {
        $lines = null;
    }

    if ($lines === null) {
        // Build minimal .env
        $appKey = 'base64:' . base64_encode(random_bytes(32));
        $env = "APP_NAME=" . escapeEnvValue($appName) . "\nAPP_ENV=production\nAPP_KEY={$appKey}\nAPP_DEBUG=false\n"
            . "APP_URL=" . escapeEnvValue($appUrl) . "\nASSET_URL=" . escapeEnvValue($appUrl) . "\n\n"
            . "DB_CONNECTION=mysql\nDB_HOST=" . escapeEnvValue($dbHost) . "\nDB_PORT={$dbPort}\n"
            . "DB_DATABASE=" . escapeEnvValue($dbName) . "\nDB_USERNAME=" . escapeEnvValue($dbUser) . "\n"
            . "DB_PASSWORD=" . escapeEnvValue($dbPass) . "\n\n"
            . "QUEUE_CONNECTION=sync\nSESSION_DRIVER=file\nCACHE_DRIVER=file\n";
    } else {
        // Update lines in-place, preserving all unrelated values
        $written = [];
        foreach ($lines as $i => $line) {
            $trimmed = trim($line);
            if ($trimmed === '' || ($trimmed[0] ?? '') === '#' || strpos($trimmed, '=') === false) {
                continue;
            }
            $key = trim(explode('=', $trimmed, 2)[0]);
            if (isset($updates[$key])) {
                $lines[$i] = $key . '=' . escapeEnvValue($updates[$key]);
                $written[$key] = true;
            }
        }

        // Append any values not already in the file
        foreach ($updates as $key => $value) {
            if (!isset($written[$key])) {
                $lines[] = $key . '=' . escapeEnvValue($value);
            }
        }

        // Ensure APP_KEY has a value
        $hasValidKey = false;
        foreach ($lines as $line) {
            if (preg_match('/^APP_KEY=.+$/', trim($line))) {
                $val = trim(explode('=', trim($line), 2)[1] ?? '');
                if ($val !== '' && $val !== '""' && $val !== "''") {
                    $hasValidKey = true;
                    break;
                }
            }
        }
        if (!$hasValidKey) {
            $appKey = 'base64:' . base64_encode(random_bytes(32));
            $keySet = false;
            foreach ($lines as $i => $line) {
                if (preg_match('/^APP_KEY=/', trim($line))) {
                    $lines[$i] = 'APP_KEY=' . $appKey;
                    $keySet = true;
                    break;
                }
            }
            if (!$keySet) {
                array_splice($lines, 1, 0, ['APP_KEY=' . $appKey]);
            }
        }

        $env = implode("\n", $lines) . "\n";
    }

    if (!file_put_contents($envPath, $env)) {
        $errors[] = 'Failed to write .env file. Check directory permissions.';
        return 'environment';
    }

    $success[] = 'Environment configured successfully.';

    if (file_exists($basePath . '/vendor/autoload.php')) {
        return 'database';
    }
    return 'composer';
}

// ============================================================================
// COMPOSER INSTALL
// ============================================================================

function handleComposer(string $basePath): string
{
    global $errors, $success;

    set_time_limit(300); // Fresh 5-minute window for composer

    $composerPhar = $basePath . '/storage/composer.phar';
    $composerBin = findComposerBinary($basePath);
    $downloadedComposer = false;
    $nd = nullDev();

    if (!$composerBin) {
        // Download composer installer
        $installerUrl = 'https://getcomposer.org/installer';
        $installer = @file_get_contents($installerUrl);
        if (!$installer) {
            $errors[] = 'Failed to download Composer installer. Check that the server can reach getcomposer.org.';
            return 'composer';
        }

        // Verify installer signature
        $expectedSig = @file_get_contents('https://composer.github.io/installer.sig');
        if ($expectedSig && hash('sha384', $installer) !== trim($expectedSig)) {
            $errors[] = 'Composer installer signature verification failed. The download may be corrupted.';
            return 'composer';
        }

        $setupPath = $basePath . '/storage/composer-setup.php';
        file_put_contents($setupPath, $installer);

        $composerHome = $basePath . '/storage/.composer';
        if (!is_dir($composerHome)) {
            @mkdir($composerHome, 0755, true);
        }
        // Use putenv() for cross-platform env vars (Unix inline syntax doesn't work on Windows)
        putenv('COMPOSER_HOME=' . $composerHome);
        putenv('HOME=' . $composerHome);

        $phpBin = escapeshellarg(PHP_BINARY);
        $storageDir = escapeshellarg($basePath . '/storage');
        $output = shell_exec("cd {$storageDir} && {$phpBin} composer-setup.php 2>&1");
        @unlink($setupPath);

        if (!file_exists($composerPhar)) {
            $errors[] = 'Composer installation failed: ' . ($output ?? 'unknown error');
            return 'composer';
        }

        $composerBin = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($composerPhar);
        $downloadedComposer = true;
    }

    // Set up environment for composer — web server users typically lack HOME
    // putenv() works cross-platform (Unix, macOS, Windows) unlike inline ENV=val syntax
    $composerHome = $basePath . '/storage/.composer';
    if (!is_dir($composerHome)) {
        @mkdir($composerHome, 0755, true);
    }
    putenv('COMPOSER_HOME=' . $composerHome);
    putenv('HOME=' . $composerHome);
    $projectDir = escapeshellarg($basePath);

    // Mark repo as safe for git (web server user may differ from repo owner)
    exec("git config --global --add safe.directory " . escapeshellarg($basePath) . " 2>&1");

    // Try composer install first (uses lock file for reproducible builds)
    $cmd = "cd {$projectDir} && {$composerBin} install --no-dev --optimize-autoloader --no-interaction 2>&1";
    $output = [];
    $exitCode = 0;
    exec($cmd, $output, $exitCode);

    // If install fails (stale lock file, version mismatch), fall back to composer update
    if ($exitCode !== 0 && !file_exists($basePath . '/vendor/autoload.php')) {
        $cmd = "cd {$projectDir} && {$composerBin} update --no-dev --optimize-autoloader --no-interaction 2>&1";
        $output = [];
        exec($cmd, $output, $exitCode);
    }

    // Clean up downloaded composer.phar and temp composer home
    if ($downloadedComposer && file_exists($composerPhar)) {
        @unlink($composerPhar);
    }
    if (is_dir($composerHome)) {
        $iter = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($composerHome, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($iter as $item) {
            $item->isDir() ? @rmdir($item->getRealPath()) : @unlink($item->getRealPath());
        }
        @rmdir($composerHome);
    }

    // Clean up env vars so they don't leak into later steps
    putenv('COMPOSER_HOME');
    putenv('HOME');

    if ($exitCode !== 0 || !file_exists($basePath . '/vendor/autoload.php')) {
        $tail = array_slice($output, -15);
        $errors[] = 'Composer install failed (exit code ' . $exitCode . "):\n" . implode("\n", $tail);
        return 'composer';
    }

    $success[] = 'Dependencies installed successfully.';
    return 'database';
}

// ============================================================================
// LARAVEL BOOTSTRAP HELPER
// ============================================================================

function bootLaravel(string $basePath): \Illuminate\Foundation\Application
{
    // Clear cached config so the freshly-written .env is read
    $cachedConfig = $basePath . '/bootstrap/cache/config.php';
    if (file_exists($cachedConfig)) {
        @unlink($cachedConfig);
    }

    require_once $basePath . '/vendor/autoload.php';
    $app = require $basePath . '/bootstrap/app.php';
    $app->make('Illuminate\Contracts\Console\Kernel')->bootstrap();
    return $app;
}

// ============================================================================
// DATABASE MIGRATION
// ============================================================================

function handleDatabase(string $basePath): string
{
    global $errors, $success;

    set_time_limit(300);

    try {
        bootLaravel($basePath);

        // Publish config & assets
        \Illuminate\Support\Facades\Artisan::call('vendor:publish', ['--tag' => 'vela-config', '--force' => true]);
        \Illuminate\Support\Facades\Artisan::call('vendor:publish', ['--tag' => 'vela-assets', '--force' => true]);

        // Run migrations
        \Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]);

        // Seed permissions & roles
        \Illuminate\Support\Facades\Artisan::call('db:seed', [
            '--class' => 'VelaBuild\Core\Database\Seeders\VelaDatabaseSeeder',
            '--force' => true,
        ]);

        // Create storage link
        if (!file_exists($basePath . '/public/storage')) {
            try {
                \Illuminate\Support\Facades\Artisan::call('storage:link');
            } catch (\Exception $e) {
                // Non-fatal: symlinks may require elevated privileges on Windows
            }
        }

        // Install default homepage from active template if none exists
        if (!\VelaBuild\Core\Models\Page::where('slug', 'home')->exists()) {
            $activeTemplate = config('vela.template.active', 'default');
            $templates = app(\VelaBuild\Core\Vela::class)->templates()->all();
            $templateDef = $templates[$activeTemplate] ?? null;

            if ($templateDef && $templateDef['path']) {
                $jsonPath = $templateDef['path'] . '/home-template.json';
                if (file_exists($jsonPath)) {
                    $rowsData = json_decode(file_get_contents($jsonPath), true);
                    if (is_array($rowsData)) {
                        \Illuminate\Support\Facades\DB::transaction(function () use ($rowsData) {
                            $page = \VelaBuild\Core\Models\Page::create([
                                'title'        => 'Home',
                                'slug'         => 'home',
                                'locale'       => config('vela.primary_language', 'en'),
                                'status'       => 'published',
                                'order_column' => 0,
                            ]);

                            foreach ($rowsData as $rowOrder => $rowData) {
                                $pageRow = \VelaBuild\Core\Models\PageRow::create([
                                    'page_id'          => $page->id,
                                    'name'             => $rowData['name'] ?? null,
                                    'css_class'        => $rowData['css_class'] ?? null,
                                    'background_color' => $rowData['background_color'] ?? null,
                                    'background_image' => $rowData['background_image'] ?? null,
                                    'order_column'     => $rowData['order'] ?? $rowOrder,
                                ]);

                                foreach ($rowData['blocks'] ?? [] as $blockOrder => $blockData) {
                                    $pageRow->blocks()->create([
                                        'column_index'     => $blockData['column_index'] ?? 0,
                                        'column_width'     => $blockData['column_width'] ?? 12,
                                        'order_column'     => $blockData['order'] ?? $blockOrder,
                                        'type'             => $blockData['type'],
                                        'content'          => $blockData['content'] ?? null,
                                        'settings'         => $blockData['settings'] ?? null,
                                        'background_color' => $blockData['background_color'] ?? null,
                                        'background_image' => $blockData['background_image'] ?? null,
                                    ]);
                                }
                            }
                        });
                    }
                }
            }
        }

    } catch (\Exception $e) {
        $errors[] = 'Database setup failed: ' . $e->getMessage();
        return 'database';
    }

    $success[] = 'Database migrated and seeded.';
    return 'admin';
}

// ============================================================================
// ADMIN USER CREATION
// ============================================================================

function handleAdmin(string $basePath): string
{
    global $errors, $success;

    $name = trim($_POST['admin_name'] ?? '');
    $email = trim($_POST['admin_email'] ?? '');
    $password = $_POST['admin_password'] ?? '';

    if (!$name || !$email || !$password) {
        $errors[] = 'All fields are required.';
        return 'admin';
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'Please enter a valid email address.';
        return 'admin';
    }

    if (strlen($password) < 8) {
        $errors[] = 'Password must be at least 8 characters.';
        return 'admin';
    }

    try {
        bootLaravel($basePath);

        $user = \VelaBuild\Core\Models\VelaUser::where('email', $email)->first();

        if ($user) {
            $user->update([
                'name' => $name,
                'password' => \Illuminate\Support\Facades\Hash::make($password),
            ]);
        } else {
            $user = \VelaBuild\Core\Models\VelaUser::create([
                'name' => $name,
                'email' => $email,
                'password' => \Illuminate\Support\Facades\Hash::make($password),
                'email_verified_at' => now(),
            ]);
        }

        // Attach admin role if not already assigned
        if (!$user->roles()->where('role_id', 1)->exists()) {
            $user->roles()->attach(1);
        }

    } catch (\Exception $e) {
        $errors[] = 'Failed to create admin user: ' . $e->getMessage();
        return 'admin';
    }

    $success[] = 'Admin user created.';
    return 'finalize';
}

// ============================================================================
// FINALIZE
// ============================================================================

function handleFinalize(string $basePath, array $envVars): string
{
    global $success;

    // Determine static tracking: POST form value > .env value > default false
    if (isset($_POST['track_static'])) {
        $trackStatic = $_POST['track_static'] === '1';
    } elseif (isset($envVars['VELA_COMMIT_STATIC'])) {
        $trackStatic = in_array(strtolower($envVars['VELA_COMMIT_STATIC']), ['true', '1', 'yes', 'on'], true);
    } else {
        $trackStatic = false;
    }

    // Determine git remote: POST form value > .env value > empty
    $gitRemote = trim($_POST['git_remote'] ?? $envVars['VELA_GIT_REMOTE'] ?? '');

    $nd = nullDev();
    $projectDir = escapeshellarg($basePath);

    // Detach from VelaBuild starter repo — this is the user's project now
    if (hasGit()) {
        $originUrl = trim(shell_exec("cd {$projectDir} && git remote get-url origin 2>{$nd}") ?? '');
        if ($originUrl && preg_match('#github\.com[:/]velabuild/#i', $originUrl)) {
            shell_exec("cd {$projectDir} && git remote remove origin 2>{$nd}");
        }

        // Set up user's own git remote if provided
        if ($gitRemote && preg_match('#^(https?://|git@|ssh://)#', $gitRemote)) {
            // Remove any existing origin first
            shell_exec("cd {$projectDir} && git remote remove origin 2>{$nd}");
            shell_exec("cd {$projectDir} && git remote add origin " . escapeshellarg($gitRemote) . " 2>{$nd}");
        }
    }

    // Mark as installed
    file_put_contents($basePath . '/storage/vela_installed', date('Y-m-d H:i:s'));

    // Configure static file tracking in .gitignore
    $gitignore = $basePath . '/.gitignore';
    if (file_exists($gitignore) && $trackStatic) {
        $contents = file_get_contents($gitignore);
        if (str_contains($contents, '/resources/static/')) {
            $lines = explode("\n", $contents);
            $lines = array_filter($lines, function ($line) {
                $trimmed = trim($line);
                return !str_starts_with($trimmed, '/resources/static/')
                    && $trimmed !== '# Static cache (remove this line after vela:install for deployment tracking)';
            });
            file_put_contents($gitignore, implode("\n", $lines));
        }
    }

    // Persist settings to .env if not already present
    $envPath = $basePath . '/.env';
    if (file_exists($envPath)) {
        $envContent = file_get_contents($envPath);
        $additions = '';
        if (!str_contains($envContent, 'VELA_COMMIT_STATIC=')) {
            $additions .= "\nVELA_COMMIT_STATIC=" . ($trackStatic ? 'true' : 'false');
        }
        if ($gitRemote && !str_contains($envContent, 'VELA_GIT_REMOTE=')) {
            $additions .= "\nVELA_GIT_REMOTE=" . escapeEnvValue($gitRemote);
        }
        if ($additions) {
            file_put_contents($envPath, rtrim($envContent) . $additions . "\n");
        }
    }

    // Generate initial static files
    try {
        bootLaravel($basePath);
        \Illuminate\Support\Facades\Artisan::call('vela:generate-static');
    } catch (\Exception $e) {
        // Non-fatal
    }

    $success[] = 'Installation complete!';
    return 'complete';
}

// ============================================================================
// RENDER SETUP
// ============================================================================

$requirements = checkRequirements($basePath);
$allPassed = true;
foreach ($requirements as $check) {
    if (!($check['optional'] ?? false) && !$check['ok']) {
        $allPassed = false;
        break;
    }
}

$stepMap = ['requirements' => 1, 'environment' => 2, 'composer' => 3, 'database' => 4, 'admin' => 5, 'finalize' => 6, 'complete' => 7];
$currentStep = $stepMap[$step] ?? 1;

// Auto-start flag for finalize: if .env already has VELA_COMMIT_STATIC, skip the form
$finalizeAutoStart = $envHasStaticConfig;

// Compute admin/site URLs for the complete page
$siteBase = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vela CMS - Installation</title>
    <style><?= installerCss() ?></style>
</head>
<body>
<div class="container">
    <div class="card">
        <div style="text-align:center;margin-bottom:8px">
            <img src="images/vela-logo-black.png" alt="Vela CMS" style="height:70px;width:auto">
        </div>
        <p class="subtitle" style="text-align:center">Installation Wizard</p>

        <div class="steps">
            <?php for ($i = 1; $i <= 6; $i++): ?>
                <div class="step-dot <?= $i < $currentStep ? 'done' : ($i === $currentStep ? 'active' : '') ?>"></div>
            <?php endfor; ?>
        </div>

        <?php foreach ($errors as $err): ?>
            <div class="alert alert-error"><?= htmlspecialchars($err) ?></div>
        <?php endforeach; ?>
        <?php foreach ($success as $msg): ?>
            <div class="alert alert-success"><?= htmlspecialchars($msg) ?></div>
        <?php endforeach; ?>

        <?php // ============================================================ ?>
        <?php // STEP 1: Requirements ?>
        <?php // ============================================================ ?>
        <?php if ($step === 'requirements'): ?>
            <h2>Step 1: System Requirements</h2>
            <ul class="check-list">
                <?php foreach ($requirements as $check): ?>
                    <li>
                        <span><?= $check['label'] ?></span>
                        <span class="<?= $check['ok'] ? 'check-ok' : (($check['optional'] ?? false) ? 'check-warn' : 'check-fail') ?>">
                            <?= htmlspecialchars($check['value']) ?>
                        </span>
                    </li>
                <?php endforeach; ?>
            </ul>
            <br>
            <?php if ($allPassed): ?>
                <a href="?step=<?= $nextAfterRequirements ?>" class="btn btn-primary">Continue</a>
            <?php else: ?>
                <p style="color:#ef4444;margin-bottom:12px">Please fix the failed requirements before continuing.</p>
                <a href="?step=requirements" class="btn btn-secondary">Re-check</a>
            <?php endif; ?>

        <?php // ============================================================ ?>
        <?php // STEP 2: Database & Environment ?>
        <?php // ============================================================ ?>
        <?php elseif ($step === 'environment'): ?>
            <h2>Step 2: Database & Environment</h2>
            <form method="POST" autocomplete="off">
                <input type="hidden" name="step" value="environment">
                <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">
                <div class="form-group">
                    <label>Site Name</label>
                    <input type="text" name="app_name" value="<?= htmlspecialchars($_POST['app_name'] ?? $envVars['APP_NAME'] ?? 'Vela CMS') ?>">
                </div>
                <div class="form-group">
                    <label>Site URL</label>
                    <input type="text" name="app_url" value="<?= htmlspecialchars($_POST['app_url'] ?? $envVars['APP_URL'] ?? ((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $siteBase)) ?>" placeholder="https://example.com">
                </div>
                <hr class="divider">
                <div class="form-group">
                    <label>Database Host</label>
                    <input type="text" name="db_host" value="<?= htmlspecialchars($_POST['db_host'] ?? $envVars['DB_HOST'] ?? '127.0.0.1') ?>" autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Database Port</label>
                    <input type="text" name="db_port" value="<?= htmlspecialchars($_POST['db_port'] ?? $envVars['DB_PORT'] ?? '3306') ?>" autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Database Name</label>
                    <input type="text" name="db_name" value="<?= htmlspecialchars($_POST['db_name'] ?? $envVars['DB_DATABASE'] ?? '') ?>" required autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Database User</label>
                    <input type="text" name="db_user" value="<?= htmlspecialchars($_POST['db_user'] ?? $envVars['DB_USERNAME'] ?? '') ?>" required autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Database Password</label>
                    <input type="password" name="db_pass" value="" autocomplete="new-password">
                    <?php if (!empty($envVars['DB_PASSWORD'])): ?>
                        <small>Leave blank to keep existing password, or enter a new one.</small>
                    <?php endif; ?>
                </div>
                <button type="submit" class="btn btn-primary">Connect & Continue</button>
            </form>

        <?php // ============================================================ ?>
        <?php // STEP 3: Composer Install (auto-start) ?>
        <?php // ============================================================ ?>
        <?php elseif ($step === 'composer'): ?>
            <h2>Step 3: Installing Dependencies</h2>
            <?php if (empty($errors)): ?>
                <form method="POST" id="auto-form">
                    <input type="hidden" name="step" value="composer">
                    <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">
                </form>
                <div class="auto-status" id="auto-progress" style="display:none">
                    <div class="spinner-large"></div>
                    <p>Installing packages via Composer. This may take a few minutes&hellip;</p>
                </div>
                <noscript>
                    <p style="margin-bottom:12px">Click below to install PHP dependencies via Composer. This may take a few minutes.</p>
                    <button type="submit" form="auto-form" class="btn btn-primary">Install Dependencies</button>
                </noscript>
                <script>document.getElementById('auto-progress').style.display='block';document.getElementById('auto-form').submit();</script>
            <?php else: ?>
                <p style="margin-bottom:16px">Dependency installation encountered an error. You can retry below.</p>
                <form method="POST">
                    <input type="hidden" name="step" value="composer">
                    <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">
                    <button type="submit" class="btn btn-primary">Retry</button>
                </form>
            <?php endif; ?>

        <?php // ============================================================ ?>
        <?php // STEP 4: Database Setup (auto-start) ?>
        <?php // ============================================================ ?>
        <?php elseif ($step === 'database'): ?>
            <h2>Step 4: Database Setup</h2>
            <?php if (empty($errors)): ?>
                <form method="POST" id="auto-form">
                    <input type="hidden" name="step" value="database">
                    <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">
                </form>
                <div class="auto-status" id="auto-progress" style="display:none">
                    <div class="spinner-large"></div>
                    <p>Running migrations, seeding permissions, and setting up your site&hellip;</p>
                </div>
                <noscript>
                    <p style="margin-bottom:12px">Click below to create database tables, permissions, and roles.</p>
                    <button type="submit" form="auto-form" class="btn btn-primary">Setup Database</button>
                </noscript>
                <script>document.getElementById('auto-progress').style.display='block';document.getElementById('auto-form').submit();</script>
            <?php else: ?>
                <p style="margin-bottom:16px">Database setup encountered an error. You can retry below.</p>
                <form method="POST">
                    <input type="hidden" name="step" value="database">
                    <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">
                    <button type="submit" class="btn btn-primary">Retry</button>
                </form>
            <?php endif; ?>

        <?php // ============================================================ ?>
        <?php // STEP 5: Admin Account ?>
        <?php // ============================================================ ?>
        <?php elseif ($step === 'admin'): ?>
            <h2>Step 5: Create Admin Account</h2>
            <form method="POST">
                <input type="hidden" name="step" value="admin">
                <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" name="admin_name" value="<?= htmlspecialchars($_POST['admin_name'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" name="admin_email" value="<?= htmlspecialchars($_POST['admin_email'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" name="admin_password" required minlength="8">
                    <small>Minimum 8 characters</small>
                </div>
                <button type="submit" class="btn btn-primary">Create Admin</button>
            </form>

        <?php // ============================================================ ?>
        <?php // STEP 6: Finalize ?>
        <?php // ============================================================ ?>
        <?php elseif ($step === 'finalize'): ?>
            <h2>Step 6: Finalizing</h2>

            <?php if ($finalizeAutoStart && empty($errors)): ?>
                <?php // .env already has VELA_COMMIT_STATIC — auto-start finalize ?>
                <form method="POST" id="auto-form">
                    <input type="hidden" name="step" value="finalize">
                    <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">
                </form>
                <div class="auto-status" id="auto-progress" style="display:none">
                    <div class="spinner-large"></div>
                    <p>Finalizing installation and generating static pages&hellip;</p>
                </div>
                <noscript>
                    <p style="margin-bottom:12px">Click below to finalize the installation.</p>
                    <button type="submit" form="auto-form" class="btn btn-primary">Finalize</button>
                </noscript>
                <script>document.getElementById('auto-progress').style.display='block';document.getElementById('auto-form').submit();</script>

            <?php else: ?>
                <form method="POST">
                    <input type="hidden" name="step" value="finalize">
                    <input type="hidden" name="_token" value="<?= htmlspecialchars($csrfToken) ?>">

                    <div class="option-box">
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-weight:500">
                            <input type="checkbox" name="track_static" value="1" id="track-static-cb" style="margin-top:4px">
                            Track static HTML files in git
                        </label>
                        <p>
                            Vela generates static HTML snapshots for fast serving. By default these are <strong>not</strong> committed to git, which is best for most setups since they regenerate automatically.
                        </p>
                        <p>
                            Enable this if you build locally or on staging and deploy to production via git &mdash; static files will be in your repository so the live server serves them immediately.
                        </p>
                    </div>

                    <div class="option-box" id="git-remote-box" style="display:none">
                        <div class="form-group" style="margin-bottom:0">
                            <label>Git Remote URL <span style="font-weight:normal;color:#94a3b8">(optional)</span></label>
                            <input type="text" name="git_remote" placeholder="git@github.com:you/your-site.git" value="<?= htmlspecialchars($envVars['VELA_GIT_REMOTE'] ?? '') ?>">
                            <small>Set your own git remote for deployment. The default Vela starter remote will be removed automatically.</small>
                        </div>
                    </div>

                    <button type="submit" class="btn btn-primary" onclick="this.innerHTML='<span class=spinner></span> Finalizing...';this.disabled=true;this.form.submit();">
                        Complete Installation
                    </button>
                </form>
                <script>
                    document.getElementById('track-static-cb').addEventListener('change', function () {
                        document.getElementById('git-remote-box').style.display = this.checked ? 'block' : 'none';
                    });
                </script>
            <?php endif; ?>

        <?php // ============================================================ ?>
        <?php // STEP 7: Complete ?>
        <?php // ============================================================ ?>
        <?php elseif ($step === 'complete'): ?>
            <div class="complete-icon">&#10003;</div>
            <h2 style="text-align:center">Installation Complete!</h2>
            <p style="text-align:center;margin-bottom:24px">Your Vela CMS site is ready.</p>
            <div style="text-align:center">
                <a href="<?= htmlspecialchars($siteBase) ?>/admin" class="btn btn-primary" style="margin-right:8px">Go to Admin Panel</a>
                <a href="<?= htmlspecialchars($siteBase) ?>/" class="btn btn-secondary">View Site</a>
            </div>
        <?php endif; ?>
    </div>
</div>
</body>
</html>
