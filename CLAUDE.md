# Vela CMS — Architecture Guide for AI Coding Assistants

## Project Structure

Laravel 11 application with a core package installed via Composer (`velabuild/core`):

```
/
├── app/                         # App-level overrides (thin)
├── config/                      # App-level config (mirrors package config)
├── vendor/velabuild/core/       # Core package (installed via Composer — do not edit directly)
│   ├── src/
│   │   ├── Commands/            # Artisan console commands
│   │   ├── Contracts/           # PHP interfaces (AiTextProvider, AiImageProvider)
│   │   ├── Http/
│   │   │   ├── Controllers/Admin/   # Admin panel controllers
│   │   │   ├── Controllers/Public/  # Public-facing controllers
│   │   │   ├── Controllers/Auth/    # Auth controllers
│   │   │   ├── Middleware/
│   │   │   └── Requests/
│   │   ├── Jobs/                # Queued jobs
│   │   ├── Models/              # Eloquent models
│   │   ├── Registries/          # TemplateRegistry and others
│   │   ├── Services/            # Business logic services
│   │   │   └── AiChat/          # Chatbot tool system
│   │   │       └── Tools/       # Individual tool implementations
│   │   └── VelaServiceProvider.php
│   ├── config/vela.php          # Package config (canonical source)
│   ├── database/
│   │   ├── migrations/
│   │   └── seeders/
│   ├── resources/views/
│   └── routes/admin.php
├── public/vendor/vela/          # Published assets (CSS, JS)
└── .env
```

## Namespace

All package code uses `VelaBuild\Core\` namespace.

Examples:
- `VelaBuild\Core\Models\Content`
- `VelaBuild\Core\Services\AiProviderManager`
- `VelaBuild\Core\Commands\CreateContent`
- `VelaBuild\Core\Http\Controllers\Admin\IdeasController`

## Database Conventions

- **Table prefix**: All tables use `vela_` prefix (e.g., `vela_contents`, `vela_users`)
- **SoftDeletes**: Every model uses the `SoftDeletes` trait
- **`$table` property**: Every model explicitly declares its table name — never rely on Laravel's convention
- **`serializeDate()`**: Every model overrides this to format dates as `Y-m-d H:i:s`
- **`$dates` array**: Declare all date columns including `deleted_at`

Example model skeleton:
```php
class Content extends Model
{
    use SoftDeletes, HasFactory;

    public $table = 'vela_contents';

    protected $fillable = ['title', 'slug', /* ... */];

    protected $dates = ['created_at', 'updated_at', 'deleted_at'];

    protected function serializeDate(DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
```

## Authentication

- **Guard**: `vela` (not the default `web` guard)
- **User model**: `VelaBuild\Core\Models\VelaUser`
- **Get authenticated user**: `auth('vela')->user()`
- **Permissions**: Gate-based via `VelaAuthGates` middleware. Permissions stored in `vela_permissions` table, assigned to roles via `vela_permission_role` pivot.
- **In controllers**: `abort_if(Gate::denies('permission_name'), 403)`
- **In Blade**: `@can('permission_name') ... @endcan`
- **Two-factor auth**: TOTP codes stored on the user; `VelaAuthGates` middleware validates on each admin request

## Configuration

Two-layer config system:

1. **`config/vela.php`** (and `vendor/velabuild/core/config/vela.php`) — Static defaults read at boot. The app-level `config/vela.php` is the canonical runtime config; the package config is the published template.
2. **`VelaConfig` model** (`vela_configs` table) — Key/value store for runtime overrides. DB values take priority over config file values.

Reading config with DB override:
```php
$dbValue = VelaConfig::where('key', 'site_name')->value('value');
$value = $dbValue ?: config('vela.ai.site_context.name', 'My Website');
```

The `SiteContext` service encapsulates this pattern for AI-related site metadata.

## Template System

- Templates are PHP packages registered via `TemplateRegistry`
- Active template: `config('vela.template.active')`
- Template path resolved via `app(Vela::class)->templates()->all()[$name]['path']`
- Blade views are in the template package's `resources/views/` directory
- CSS variables for theming are stored in `VelaConfig` with keys prefixed `css_` (e.g., `css_--primary`)

## AI Services

The AI system uses a provider abstraction — never instantiate AI service classes directly.

### Provider Resolution
```php
$aiManager = app(AiProviderManager::class);  // or inject via constructor
$textProvider = $aiManager->resolveTextProvider();   // AiTextProvider instance
$imageProvider = $aiManager->resolveImageProvider(); // AiImageProvider instance
```

### Interfaces
- `VelaBuild\Core\Contracts\AiTextProvider` — `generateText()` and `chat()` methods
- `VelaBuild\Core\Contracts\AiImageProvider` — `generateImage()` and `saveBase64Image()` methods

### Providers
| Name | Text Service | Image Service | Config Key |
|------|-------------|---------------|------------|
| `openai` | `OpenAiTextService` | `OpenAiImageService` | `vela.ai.openai.api_key` / `OPENAI_API_KEY` |
| `anthropic` | `ClaudeTextService` | — | `vela.ai.anthropic.api_key` / `ANTHROPIC_API_KEY` |
| `gemini` | `GeminiTextService` | `GeminiImageService` | `vela.ai.gemini.api_key` / `GEMINI_API_KEY` |

### Fallback Order
- Text: `openai` → `anthropic` → `gemini`
- Image: `gemini` → `openai`

### API Calls
All providers use Laravel's `Http` facade — **no SDK packages**. 120-second timeout. Log all interactions with `Log::info()` / `Log::error()`.

### Site Context
Use `SiteContext` service instead of hardcoding site names:
```php
$siteContext = app(SiteContext::class);
$prompt = "Write content for {$siteContext->getDescription()}.";
```

## Command Pattern

All artisan commands follow this structure:
- **Constructor DI**: Inject services (e.g., `AiProviderManager`) via constructor
- **Flags**: `--force` skips confirmation prompts; `--dry-run` shows what would happen without doing it
- **Prerequisite validation**: Check API keys / config early, return exit code 1 with clear error
- **Backup before overwrite**: Copy original file to `storage/app/*/` before modifying
- **Atomic writes**: Write to `.tmp` file, then `rename()` to final path (prevents partial writes)
- **Exit codes**: 0 = success, 1 = error
- **CI/CD output**: Print JSON on stdout for piping (e.g., `{"id": 1, "slug": "my-post"}`)

```php
class CreateContent extends Command
{
    protected $signature = 'vela:create-content {--title=} {--dry-run}';

    public function __construct(private AiProviderManager $aiManager)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        if (!$this->aiManager->hasTextProvider()) {
            $this->error('No AI text provider configured. Set OPENAI_API_KEY in .env');
            return 1;
        }
        // ... atomic write pattern:
        file_put_contents($tmpPath, $content);
        rename($tmpPath, $finalPath);
        return 0;
    }
}
```

## Test Pattern

**CRITICAL**: Always use `DatabaseTransactions` — never `RefreshDatabase`. Tests run against the seeded database and roll back after each test.

```php
use VelaBuild\Core\Tests\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;

class MyTest extends TestCase
{
    use DatabaseTransactions;

    public function test_something(): void
    {
        $this->loginAsAdmin();  // helper from TestCase
        // ... test code ...
    }
}
```

Helpers available in `TestCase`:
- `loginAsAdmin()` — logs in as admin user
- `loginAsUser()` — logs in as non-admin user

For permission-specific tests, use:
```php
Permission::firstOrCreate(['title' => 'my_permission']);
```

**Never** use `RefreshDatabase` — it wipes the seeded database that tests depend on.

## Admin UI Stack

- **CSS Framework**: Bootstrap 4 + CoreUI 3.2
- **JavaScript**: jQuery 3.3 (available globally as `$`)
- **AJAX**: Use `$.ajax()` or native `fetch()` — no axios
- **CSRF token**: Read from meta tag: `document.querySelector('meta[name="csrf-token"]').getAttribute('content')`
- **Icons**: Font Awesome 5 (`fas fa-*` classes)
- **Modal dialogs**: Bootstrap 4 modal component

AJAX pattern:
```javascript
fetch('/admin/some-endpoint', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
    },
    body: JSON.stringify({ key: 'value' })
})
.then(res => res.json())
.then(data => { /* handle */ });
```

## Route Naming

Admin routes follow the pattern `vela.admin.{resource}.{action}`:
- `vela.admin.content.index`
- `vela.admin.ai-chat.message`
- `vela.admin.pages.edit`

Routes are defined in `vendor/velabuild/core/routes/admin.php` and grouped under the `admin` prefix with middleware: `['web', 'vela.auth', 'vela.2fa', 'vela.gates', 'vela.locale']`.

## Key Files Quick Reference

| Purpose | File |
|---------|------|
| Service provider / boot | `src/VelaServiceProvider.php` |
| AI provider resolution | `src/Services/AiProviderManager.php` |
| Site context for AI prompts | `src/Services/SiteContext.php` |
| Chatbot job | `src/Jobs/ProcessAiChatMessageJob.php` |
| Chatbot tools registry | `src/Services/AiChat/ChatToolRegistry.php` |
| Chatbot tool executor | `src/Services/AiChat/ChatToolExecutor.php` |
| Admin layout | `resources/views/layouts/admin.blade.php` |
| Package config | `config/vela.php` |
| Admin routes | `routes/admin.php` |
| Permissions seeder | `database/seeders/VelaPermissionsSeeder.php` |
