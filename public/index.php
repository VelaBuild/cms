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
|
| If the application is in maintenance / demo mode via the "down" command
| we will load this file so that any pre-rendered content can be shown
| instead of starting the framework, which could cause an exception.
|
*/

if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

/*
|--------------------------------------------------------------------------
| Static File Front-Controller
|--------------------------------------------------------------------------
|
| Serve pre-rendered static HTML files without booting the framework.
| Only intercepts GET requests for known content URL patterns.
|
*/

// Check VELA_CACHE from .env (lightweight parse, no framework needed)
$__velaCache = true;
$__envFile = dirname(__DIR__) . '/.env';
if (is_file($__envFile)) {
    $__envLine = preg_grep('/^VELA_CACHE\s*=/m', file($__envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES));
    if (!empty($__envLine)) {
        $__val = trim(explode('=', end($__envLine), 2)[1] ?? '');
        $__velaCache = !in_array(strtolower($__val), ['false', '0', 'off', 'no', ''], true);
    }
}
unset($__envFile, $__envLine, $__val);

$__staticMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($__velaCache && $__staticMethod === 'GET') {
    $__staticRawUri = rawurldecode(strtok($_SERVER['REQUEST_URI'] ?? '/', '?'));
    // Strip the base path so the app works in subdirectories
    // SCRIPT_NAME with .htaccess rewrite = /subdir/public/index.php
    $__staticScriptName = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
    $__staticScriptDir = rtrim(str_replace('\\', '/', dirname($__staticScriptName)), '/');
    if ($__staticScriptDir !== '' && strpos($__staticRawUri, $__staticScriptDir) === 0) {
        $__staticUri = substr($__staticRawUri, strlen($__staticScriptDir));
    } else {
        $__staticUri = $__staticRawUri;
    }
    $__staticUri = rtrim($__staticUri, '/') ?: '/';
    $__staticBase = dirname(__DIR__) . '/resources/static';

    // Exclusion list: never intercept these prefixes
    $__staticExclude = ['admin', 'vela', 'login', 'logout', 'register', 'password',
        'home', 'profile', 'two-factor', 'imgp', 'imgr', 'api', 'page-form',
        'storage', 'vendor', 'livewire', 'horizon', 'telescope'];

    $__staticSegments = explode('/', ltrim($__staticUri, '/'));
    $__staticFirst = $__staticSegments[0] ?? '';

    // Check if first segment is an excluded prefix
    $__staticExcluded = in_array($__staticFirst, $__staticExclude, true);

    if (!$__staticExcluded) {
        $__staticFile = null;

        // Detect locale prefix: 2-char or 5-char codes like "th", "zh-Hans"
        $__staticLocale = null;
        $__staticSlugSegments = $__staticSegments;
        if (preg_match('/^[a-z]{2}(-[A-Za-z]{2,4})?$/', $__staticFirst)) {
            $__staticLocale = $__staticFirst;
            array_shift($__staticSlugSegments);
        }

        $__staticPath = implode('/', $__staticSlugSegments);

        if ($__staticUri === '/') {
            // Homepage
            $__staticFile = $__staticBase . '/home/index.html';
        } elseif ($__staticLocale !== null && $__staticPath === '') {
            // Locale-only homepage: /th → home translation
            $__staticFile = $__staticBase . '/home/translations/' . $__staticLocale . '.html';
        } elseif ($__staticLocale !== null) {
            // Locale-prefixed URL: try translation snapshot
            // Determine content type from path
            if (strpos($__staticPath, 'posts/') === 0) {
                $__slug = substr($__staticPath, 6);
                $__staticFile = $__staticBase . '/posts/' . $__slug . '/translations/' . $__staticLocale . '.html';
            } elseif ($__staticPath === 'posts') {
                $__staticFile = $__staticBase . '/posts/translations/' . $__staticLocale . '.html';
            } elseif (strpos($__staticPath, 'categories/') === 0) {
                $__slug = substr($__staticPath, 11);
                $__staticFile = $__staticBase . '/categories/' . $__slug . '/translations/' . $__staticLocale . '.html';
            } elseif ($__staticPath === 'categories') {
                $__staticFile = $__staticBase . '/categories/translations/' . $__staticLocale . '.html';
            } else {
                $__staticFile = $__staticBase . '/pages/' . $__staticPath . '/translations/' . $__staticLocale . '.html';
            }
        } elseif ($__staticPath === 'posts') {
            $__staticFile = $__staticBase . '/posts/index.html';
        } elseif (strpos($__staticPath, 'posts/') === 0) {
            $__slug = substr($__staticPath, 6);
            $__staticFile = $__staticBase . '/posts/' . $__slug . '/index.html';
        } elseif ($__staticPath === 'categories') {
            $__staticFile = $__staticBase . '/categories/index.html';
        } elseif (strpos($__staticPath, 'categories/') === 0) {
            $__slug = substr($__staticPath, 11);
            $__staticFile = $__staticBase . '/categories/' . $__slug . '/index.html';
        } else {
            // Pages catch-all
            $__staticFile = $__staticBase . '/pages/' . $__staticPath . '/index.html';
        }

        // Path traversal protection + serve
        if ($__staticFile !== null) {
            $__staticReal = realpath($__staticFile);
            $__staticBaseReal = realpath($__staticBase);
            if ($__staticReal !== false
                && $__staticBaseReal !== false
                && strpos($__staticReal, $__staticBaseReal . DIRECTORY_SEPARATOR) === 0
                && substr($__staticReal, -5) === '.html'
                && is_file($__staticReal)
            ) {
                header('Content-Type: text/html; charset=UTF-8');
                header('Cache-Control: public, max-age=300');
                header('X-Static: true');
                readfile($__staticReal);
                exit;
            }
        }
    }
    // Clean up front-controller variables
    unset($__staticMethod, $__staticRawUri, $__staticScriptName, $__staticScriptDir,
          $__staticUri, $__staticBase, $__staticExclude, $__staticSegments,
          $__staticFirst, $__staticExcluded, $__staticFile, $__staticLocale,
          $__staticSlugSegments, $__staticPath, $__staticReal, $__staticBaseReal);
}
unset($__velaCache);

/*
|--------------------------------------------------------------------------
| Register The Auto Loader
|--------------------------------------------------------------------------
|
| Composer provides a convenient, automatically generated class loader for
| this application. We just need to utilize it! We'll simply require it
| into the script here so we don't need to manually load our classes.
|
*/

require __DIR__.'/../vendor/autoload.php';

/*
|--------------------------------------------------------------------------
| Run The Application
|--------------------------------------------------------------------------
|
| Once we have the application, we can handle the incoming request using
| the application's HTTP kernel. Then, we will send the response back
| to this client's browser, allowing them to enjoy our application.
|
*/

$app = require_once __DIR__.'/../bootstrap/app.php';

$kernel = $app->make(Kernel::class);

$response = $kernel->handle(
    $request = Request::capture()
)->send();

$kernel->terminate($request, $response);
