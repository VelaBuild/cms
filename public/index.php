<?php

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

/*
|--------------------------------------------------------------------------
| Auto-redirect to Installer if Not Installed
|--------------------------------------------------------------------------
*/

if (!file_exists(dirname(__DIR__) . '/storage/vela_installed')
    && !file_exists(dirname(__DIR__) . '/vendor/autoload.php')
    && file_exists(__DIR__ . '/install.php')
) {
    header('Location: ' . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/install.php');
    exit;
}

/*
|--------------------------------------------------------------------------
| Check If The Application Is Under Maintenance
|--------------------------------------------------------------------------
*/

if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

/*
|--------------------------------------------------------------------------
| Static File Front-Controller
|--------------------------------------------------------------------------
|
| Pre-rendered pages are served without booting the framework. The logic
| lives in velabuild/core so it updates with the package; it is required by
| path because the autoloader isn't loaded yet.
|
*/

if (is_file($__velaFront = dirname(__DIR__) . '/vendor/velabuild/core/src/Http/StaticFrontController.php')) {
    require $__velaFront;
    \VelaBuild\Core\Http\StaticFrontController::handle(dirname(__DIR__));
}
unset($__velaFront);

/*
|--------------------------------------------------------------------------
| Register The Auto Loader & Run The Application
|--------------------------------------------------------------------------
*/

require __DIR__.'/../vendor/autoload.php';

$app = require_once __DIR__.'/../bootstrap/app.php';

$kernel = $app->make(Kernel::class);

$response = $kernel->handle(
    $request = Request::capture()
)->send();

$kernel->terminate($request, $response);
