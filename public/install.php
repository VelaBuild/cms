<?php
/**
 * Vela CMS Web Installer
 *
 * Standalone installer that works without Laravel/Composer.
 * Handles: requirements check, .env setup, composer install, migrations, admin user, setup wizard.
 * Self-disables after installation.
 */

// ============================================================================
// SECURITY: Abort if already installed
// ============================================================================

$basePath = dirname(__DIR__);

// Only block access if the installation marker file exists — this is the single
// source of truth written by the finalize step. Heuristics (checking .env + vendor
// + DB tables) cause false positives mid-install when the DB is migrated but the
// wizard hasn't finished yet.
if (file_exists($basePath . '/storage/vela_installed')) {
    http_response_code(404);
    echo '<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>';
    exit;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

$step = $_POST['step'] ?? $_GET['step'] ?? 'requirements';
$errors = [];
$success = [];

session_start();

// ============================================================================
// STEP HANDLERS
// ============================================================================

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
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
            $step = handleFinalize($basePath);
            break;
    }
}

// ============================================================================
// REQUIREMENTS CHECK
// ============================================================================

function checkRequirements(): array
{
    $checks = [];
    $checks['php_version'] = ['label' => 'PHP >= 8.1', 'ok' => version_compare(PHP_VERSION, '8.1.0', '>='), 'value' => PHP_VERSION];
    $checks['pdo'] = ['label' => 'PDO Extension', 'ok' => extension_loaded('pdo'), 'value' => extension_loaded('pdo') ? 'Installed' : 'Missing'];
    $checks['pdo_mysql'] = ['label' => 'PDO MySQL', 'ok' => extension_loaded('pdo_mysql'), 'value' => extension_loaded('pdo_mysql') ? 'Installed' : 'Missing'];
    $checks['mbstring'] = ['label' => 'Mbstring Extension', 'ok' => extension_loaded('mbstring'), 'value' => extension_loaded('mbstring') ? 'Installed' : 'Missing'];
    $checks['openssl'] = ['label' => 'OpenSSL Extension', 'ok' => extension_loaded('openssl'), 'value' => extension_loaded('openssl') ? 'Installed' : 'Missing'];
    $checks['json'] = ['label' => 'JSON Extension', 'ok' => extension_loaded('json'), 'value' => extension_loaded('json') ? 'Installed' : 'Missing'];
    $checks['curl'] = ['label' => 'cURL Extension', 'ok' => extension_loaded('curl'), 'value' => extension_loaded('curl') ? 'Installed' : 'Missing'];
    $checks['gd'] = ['label' => 'GD Extension', 'ok' => extension_loaded('gd'), 'value' => extension_loaded('gd') ? 'Installed' : 'Missing (optional, for images)'];
    $checks['storage_writable'] = ['label' => 'storage/ writable', 'ok' => is_writable(dirname(__DIR__) . '/storage'), 'value' => is_writable(dirname(__DIR__) . '/storage') ? 'Writable' : 'Not writable'];
    $checks['env_writable'] = ['label' => 'Root dir writable', 'ok' => is_writable(dirname(__DIR__)), 'value' => is_writable(dirname(__DIR__)) ? 'Writable' : 'Not writable'];
    return $checks;
}

// ============================================================================
// ENVIRONMENT SETUP
// ============================================================================

function handleEnvironment(string $basePath): string
{
    global $errors, $success;

    $dbHost = trim($_POST['db_host'] ?? 'localhost');
    $dbPort = trim($_POST['db_port'] ?? '3306');
    $dbName = trim($_POST['db_name'] ?? '');
    $dbUser = trim($_POST['db_user'] ?? '');
    $dbPass = $_POST['db_pass'] ?? '';
    $appUrl = trim($_POST['app_url'] ?? '');
    $appName = trim($_POST['app_name'] ?? 'Vela CMS');

    if (!$dbName || !$dbUser) {
        $errors[] = 'Database name and user are required.';
        return 'environment';
    }

    // Test DB connection
    try {
        $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName}";
        $pdo = new PDO($dsn, $dbUser, $dbPass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo = null;
    } catch (PDOException $e) {
        $errors[] = 'Database connection failed: ' . $e->getMessage();
        return 'environment';
    }

    // Generate app key
    $appKey = 'base64:' . base64_encode(random_bytes(32));

    // Create .env
    $envExample = file_exists($basePath . '/.env.example') ? file_get_contents($basePath . '/.env.example') : '';

    if ($envExample) {
        $env = $envExample;
        $replacements = [
            'APP_NAME' => $appName,
            'APP_URL' => $appUrl,
            'APP_KEY' => $appKey,
            'DB_HOST' => $dbHost,
            'DB_PORT' => $dbPort,
            'DB_DATABASE' => $dbName,
            'DB_USERNAME' => $dbUser,
            'DB_PASSWORD' => $dbPass,
        ];
        foreach ($replacements as $key => $value) {
            // Quote values that contain spaces, quotes, or other shell-special characters
            if (preg_match('/[\s"\'#\\\\$]/', $value) || $value === '') {
                $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $value);
                $value = '"' . $escaped . '"';
            }
            $env = preg_replace("/^{$key}=.*/m", "{$key}={$value}", $env);
        }
    } else {
        $env = "APP_NAME=\"{$appName}\"\nAPP_ENV=production\nAPP_KEY={$appKey}\nAPP_DEBUG=false\nAPP_URL={$appUrl}\n\n"
            . "DB_CONNECTION=mysql\nDB_HOST={$dbHost}\nDB_PORT={$dbPort}\nDB_DATABASE={$dbName}\nDB_USERNAME={$dbUser}\nDB_PASSWORD={$dbPass}\n\n"
            . "QUEUE_CONNECTION=sync\nSESSION_DRIVER=file\nCACHE_DRIVER=file\n";
    }

    if (!file_put_contents($basePath . '/.env', $env)) {
        $errors[] = 'Failed to write .env file. Check directory permissions.';
        return 'environment';
    }

    $_SESSION['install_env'] = true;
    $success[] = 'Environment configured successfully.';

    // Check if composer already installed
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

    // Check for composer — prefer global install, then look in storage (out of web root)
    $composerPhar = $basePath . '/storage/composer.phar';
    $composerGlobal = trim(shell_exec('which composer 2>/dev/null') ?? '');
    $downloadedComposer = false;

    if (!$composerGlobal && !file_exists($composerPhar)) {
        // Download composer installer
        $installerUrl = 'https://getcomposer.org/installer';
        $installer = @file_get_contents($installerUrl);
        if (!$installer) {
            $errors[] = 'Failed to download Composer installer. Check internet connection.';
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
        $output = shell_exec('cd ' . escapeshellarg($basePath . '/storage') . ' && php composer-setup.php 2>&1');
        @unlink($setupPath);

        if (!file_exists($composerPhar)) {
            $errors[] = 'Composer installation failed: ' . ($output ?? 'unknown error');
            return 'composer';
        }
        $downloadedComposer = true;
    }

    // Run composer install
    $composer = $composerGlobal ?: 'php ' . escapeshellarg($composerPhar);
    $cmd = 'cd ' . escapeshellarg($basePath) . " && {$composer} install --no-dev --optimize-autoloader 2>&1";

    $output = [];
    $exitCode = 0;
    exec($cmd, $output, $exitCode);

    // Clean up downloaded composer.phar — no longer needed once vendor is installed
    if ($downloadedComposer && file_exists($composerPhar)) {
        @unlink($composerPhar);
    }

    if ($exitCode !== 0 || !file_exists($basePath . '/vendor/autoload.php')) {
        $errors[] = 'Composer install failed. Output: ' . implode("\n", array_slice($output, -10));
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
    // Clear cached config so the freshly-written .env is actually read
    $cachedConfig = $basePath . '/bootstrap/cache/config.php';
    if (file_exists($cachedConfig)) {
        @unlink($cachedConfig);
    }

    require $basePath . '/vendor/autoload.php';
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
            \Illuminate\Support\Facades\Artisan::call('storage:link');
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

    if (strlen($password) < 8) {
        $errors[] = 'Password must be at least 8 characters.';
        return 'admin';
    }

    try {
        bootLaravel($basePath);

        $user = \VelaBuild\Core\Models\VelaUser::where('email', $email)->first();

        if ($user) {
            // Update existing user and ensure admin role
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

function handleFinalize(string $basePath): string
{
    global $success;

    $trackStatic = ($_POST['track_static'] ?? '0') === '1';

    // Detach from the Vela CMS starter repo — this is the user's project now
    $starterOrigins = ['git@github.com:VelaBuild/cms.git', 'https://github.com/VelaBuild/cms.git', 'git@github.com:velabuild/cms.git', 'https://github.com/velabuild/cms.git'];
    $originUrl = trim(shell_exec('cd ' . escapeshellarg($basePath) . ' && git remote get-url origin 2>/dev/null') ?? '');
    if (in_array(rtrim($originUrl, '.git') . '.git', $starterOrigins, true) || in_array($originUrl, $starterOrigins, true)) {
        shell_exec('cd ' . escapeshellarg($basePath) . ' && git remote remove origin 2>/dev/null');
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
// RENDER
// ============================================================================

$requirements = checkRequirements();
$allPassed = !in_array(false, array_column($requirements, 'ok'));
$steps = ['requirements' => 1, 'environment' => 2, 'composer' => 3, 'database' => 4, 'admin' => 5, 'finalize' => 6, 'complete' => 7];
$currentStep = $steps[$step] ?? 1;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vela CMS - Installation</title>
    <style>
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
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 14px; }
        .form-group input { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
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
        @keyframes spin { to { transform: rotate(360deg); } }
        .complete-icon { font-size: 48px; text-align: center; margin-bottom: 16px; }
    </style>
</head>
<body>
<div class="container">
    <div class="card">
        <h1>Vela CMS</h1>
        <p class="subtitle">Installation Wizard</p>

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

        <?php if ($step === 'requirements'): ?>
            <h2>Step 1: Requirements Check</h2>
            <ul class="check-list">
                <?php foreach ($requirements as $check): ?>
                    <li>
                        <span><?= $check['label'] ?></span>
                        <span class="<?= $check['ok'] ? 'check-ok' : 'check-fail' ?>"><?= $check['value'] ?></span>
                    </li>
                <?php endforeach; ?>
            </ul>
            <br>
            <?php if ($allPassed): ?>
                <a href="?step=environment" class="btn btn-primary">Continue</a>
            <?php else: ?>
                <p style="color:#ef4444">Please fix the failed requirements before continuing.</p>
                <a href="?step=requirements" class="btn btn-secondary">Re-check</a>
            <?php endif; ?>

        <?php elseif ($step === 'environment'): ?>
            <h2>Step 2: Database & Environment</h2>
            <form method="POST">
                <input type="hidden" name="step" value="environment">
                <div class="form-group">
                    <label>Site Name</label>
                    <input type="text" name="app_name" value="<?= htmlspecialchars($_POST['app_name'] ?? 'Vela CMS') ?>">
                </div>
                <div class="form-group">
                    <label>Site URL</label>
                    <input type="text" name="app_url" value="<?= htmlspecialchars($_POST['app_url'] ?? (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/')) ?>" placeholder="https://example.com">
                </div>
                <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0">
                <div class="form-group">
                    <label>Database Host</label>
                    <input type="text" name="db_host" value="<?= htmlspecialchars($_POST['db_host'] ?? 'localhost') ?>">
                </div>
                <div class="form-group">
                    <label>Database Port</label>
                    <input type="text" name="db_port" value="<?= htmlspecialchars($_POST['db_port'] ?? '3306') ?>">
                </div>
                <div class="form-group">
                    <label>Database Name</label>
                    <input type="text" name="db_name" value="<?= htmlspecialchars($_POST['db_name'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Database User</label>
                    <input type="text" name="db_user" value="<?= htmlspecialchars($_POST['db_user'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Database Password</label>
                    <input type="password" name="db_pass" value="">
                </div>
                <button type="submit" class="btn btn-primary">Connect & Continue</button>
            </form>

        <?php elseif ($step === 'composer'): ?>
            <h2>Step 3: Installing Dependencies</h2>
            <p>This may take a few minutes...</p>
            <form method="POST" id="composer-form">
                <input type="hidden" name="step" value="composer">
                <br>
                <button type="submit" class="btn btn-primary" id="composer-btn" onclick="this.innerHTML='<span class=spinner></span> Installing...';this.disabled=true;this.form.submit();">
                    Install Dependencies
                </button>
            </form>

        <?php elseif ($step === 'database'): ?>
            <h2>Step 4: Database Setup</h2>
            <p>Creating tables, permissions, and roles...</p>
            <form method="POST" id="db-form">
                <input type="hidden" name="step" value="database">
                <br>
                <button type="submit" class="btn btn-primary" onclick="this.innerHTML='<span class=spinner></span> Setting up...';this.disabled=true;this.form.submit();">
                    Setup Database
                </button>
            </form>

        <?php elseif ($step === 'admin'): ?>
            <h2>Step 5: Create Admin Account</h2>
            <form method="POST">
                <input type="hidden" name="step" value="admin">
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

        <?php elseif ($step === 'finalize'): ?>
            <h2>Step 6: Finalizing</h2>
            <form method="POST">
                <input type="hidden" name="step" value="finalize">

                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px">
                    <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-weight:500">
                        <input type="checkbox" name="track_static" value="1" style="margin-top:4px">
                        Track static HTML files in git
                    </label>
                    <p style="color:#64748b;font-size:13px;margin:8px 0 0 26px">
                        Vela generates static HTML snapshots of your pages for fast serving. By default these are <strong>not</strong> committed to git, which is best for most setups since they are regenerated automatically.
                    </p>
                    <p style="color:#64748b;font-size:13px;margin:6px 0 0 26px">
                        Enable this if you build your site on a local or staging server and deploy to production via git &mdash; the static files will be included in your repository so the live server can serve them immediately without needing to regenerate.
                    </p>
                </div>

                <button type="submit" class="btn btn-primary" onclick="this.innerHTML='<span class=spinner></span> Finalizing...';this.disabled=true;this.form.submit();">
                    Complete Installation
                </button>
            </form>

        <?php elseif ($step === 'complete'): ?>
            <div class="complete-icon">&#10003;</div>
            <h2 style="text-align:center">Installation Complete!</h2>
            <p style="text-align:center;margin-bottom:24px">Your Vela CMS site is ready.</p>
            <div style="text-align:center">
                <a href="<?= rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') ?>/../admin" class="btn btn-primary" style="margin-right:8px">Go to Admin Panel</a>
                <a href="<?= rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') ?>/" class="btn btn-secondary">View Site</a>
            </div>
        <?php endif; ?>
    </div>
</div>
</body>
</html>
