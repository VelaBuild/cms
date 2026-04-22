# Vela CMS

A ready-to-go project starter for [Vela.build](https://vela.build) — clone once, customise forever, receive updates via Composer.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## About

This repository is the starting point for new Vela-powered sites. It provides a standard Laravel application pre-configured with the [Vela Core](https://github.com/velabuild/core) package. You clone it once to begin your project, then never pull from this repo again — all CMS updates arrive through the `velabuild/core` Composer package.

## Requirements

- PHP 8.1+
- Composer
- MySQL 5.7+ / MariaDB 10.3+ / PostgreSQL 10+
- Node.js 16+ (for asset compilation)

## Installation

### Web Installer (recommended)

The easiest way to get started — no command line required.

1. Clone the starter and point your web server at the `public/` directory:

```bash
git clone https://github.com/velabuild/cms.git my-site
```

2. Visit your site in a browser. You'll be automatically redirected to the installation wizard, which walks you through:

   - **Requirements check** — PHP version, extensions, directory permissions
   - **Database & environment** — enter your database credentials, site name, and URL. The installer tests the connection and writes your `.env` file automatically.
   - **Dependencies** — installs Composer packages (downloads Composer itself if needed)
   - **Database setup** — runs migrations, seeds permissions and roles, creates the storage symlink
   - **Admin account** — create your first admin user
   - **Finalize** — generates static files and marks the installation as complete

Once finished, the installer disables itself and you're taken straight to the admin panel.

### CLI Installation (alternative)

If you prefer the command line, or are setting up in a CI/CD pipeline:

```bash
git clone https://github.com/velabuild/cms.git my-site
cd my-site
composer install
cp .env.example .env
php artisan key:generate
```

Edit `.env` with your database credentials, site details, and API keys, then run:

```bash
php artisan vela:install
```

This will publish config and assets, run migrations, seed default data, create the storage symlink, and prompt you to create an admin user.

### After installation

Detach from the starter repo — this is your project now:

```bash
git remote remove origin
git remote add origin <your-own-repo-url>
```

### Native App Setup (optional)

To build native Android/iOS apps with Capacitor:

```bash
php artisan vela:app-init
```

This creates a Capacitor project in `/capacitor/`, installs platform dependencies, and generates the config from your site settings.

## Updating Vela Core

CMS updates are delivered through Composer. Your site-level customisations (templates, config, routes, app overrides) are untouched by updates:

```bash
composer update velabuild/core
```

After updating, check for new migrations or publishable assets:

```bash
php artisan migrate
php artisan vendor:publish --tag=vela-assets --force
```

## Project Structure

```
├── app/                    # Your application overrides
│   ├── Http/               # Custom controllers, middleware
│   ├── Models/             # Custom models (extend Vela models if needed)
│   └── Providers/          # App service providers
├── config/
│   └── vela.php            # Vela configuration (override package defaults)
├── database/
│   └── seeders/            # Your custom seeders
├── public/                 # Web root
├── resources/
│   ├── views/              # Override Vela views here
│   ├── lang/vendor/vela/   # Translation overrides (published from core)
│   └── static/             # Static site cache
├── routes/
│   └── web.php             # Your custom routes
├── storage/                # Logs, cache, uploads
└── tests/                  # Your tests
```

## Customisation

### Templates

Set your active template in `.env`:

```
SITE_TEMPLATE=my-template
```

Or in `config/vela.php`:

```php
'template' => [
    'active' => 'my-template',
],
```

### Overriding Views

Publish Vela views to customise them:

```bash
php artisan vendor:publish --tag=vela-views
```

Published views in `resources/views/vendor/vela/` take priority over the package views.

### Overriding Translations

All translations ship with Vela Core and update automatically. To override specific strings:

```bash
php artisan vendor:publish --tag=vela-lang
```

Published translations in `resources/lang/vendor/vela/` take priority. Only override what you need — unpublished keys continue to receive updates from core.

### Configuration

All Vela configuration can be overridden in `config/vela.php`. See the file for available options including route prefixes, middleware, languages, AI providers, and image optimisation settings.

### AI Services

Configure one or more AI providers in `.env`:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
AI_TEXT_PROVIDER=openai
AI_IMAGE_PROVIDER=gemini
```

## Deployment via static cache

Vela can serve `resources/static/*.html` ahead of booting Laravel — commit that cache with the repo and your site loads without DB or PHP in the hot path. Because Blade bakes `APP_URL` into every `<link>`, `<meta og:image>`, logo `srcset`, etc., the committed HTML must reference the live domain, not `localhost`.

Set `LIVE_URL` in `.env` once per machine:

```
LIVE_URL=https://example.com
```

Typical publish flow:

```bash
php artisan vela:generate-static --clear     # rebuild cache against local APP_URL
php artisan vela:static-rewrite-urls         # APP_URL -> LIVE_URL (in-place rewrite)
git add resources/static && git commit -m '…' && git push
php artisan vela:static-rewrite-urls --reverse   # LIVE_URL -> APP_URL (restore local)
```

Additional options:

```bash
php artisan vela:static-rewrite-urls --dry-run
php artisan vela:static-rewrite-urls --from=<url> --to=<url>
```

The command walks `resources/static/**/*.html` and does a literal `str_replace($from, $to)` on each file — deterministic, reversible, no in-process URL-generator magic. Sites free to wrap it in their own `pushgit.sh`-style script for an auto-rewrite-commit-reverse loop.

## Testing

```bash
php artisan test
```

Or directly:

```bash
vendor/bin/phpunit
```

## Security

If you discover a security vulnerability, please email [m@awcode.com](mailto:m@awcode.com) instead of opening a public issue.

## License

Vela CMS is open-source software licensed under the [MIT License](LICENSE).

## Links

- [Vela.build](https://vela.build)
- [Vela Core Package](https://github.com/VelaBuild/core)
- [Documentation](https://vela.build/docs)
