# AI Services Reference

## Overview

The AI integration uses a provider abstraction layer. All AI operations go through `AiProviderManager` — never instantiate provider services directly. This allows switching providers via `.env` without code changes.

All providers use Laravel's `Http` facade for API calls (no SDK packages). Every provider logs interactions with `Log::info()` / `Log::error()` and returns `null` on failure.

---

## Interfaces

### `AiTextProvider`

**Namespace**: `VelaBuild\Core\Contracts\AiTextProvider`  
**File**: `src/Contracts/AiTextProvider.php`

```php
interface AiTextProvider
{
    public function generateText(string $prompt, int $maxTokens = 1000, float $temperature = 0.7): ?string;

    public function chat(array $messages, array $tools = [], int $maxTokens = 4096): ?array;
}
```

**`generateText()`** — Single prompt → single string response. Returns `null` on API failure.

**`chat()`** — Multi-turn conversation with optional tool/function calling. Returns normalized response array:
```php
[
    'content'    => 'string or null',           // text response
    'tool_calls' => [                           // null if no tools called
        ['id' => '...', 'name' => 'tool_name', 'arguments' => [...]]
    ],
    'usage' => ['input' => 100, 'output' => 50] // token counts
]
```

---

### `AiImageProvider`

**Namespace**: `VelaBuild\Core\Contracts\AiImageProvider`  
**File**: `src/Contracts/AiImageProvider.php`

```php
interface AiImageProvider
{
    public function generateImage(string $prompt, array $options = []): ?array;

    public function saveBase64Image(string $base64Data, string $filename, string $disk = 'public'): ?string;
}
```

**`generateImage()`** — Returns normalized response: `['data' => [['b64_json' => '...']]]` or `null`.

**`$options` keys**: `size` (e.g., `'1024x1024'`), `quality` (e.g., `'high'`), `n` (count), `aspect_ratio` (e.g., `'1:1'`)

**`saveBase64Image()`** — Saves decoded image to storage disk. Returns relative path or `null`.

---

## AiProviderManager

**Namespace**: `VelaBuild\Core\Services\AiProviderManager`  
**Registered as**: Singleton in `VelaServiceProvider::register()`

```php
$aiManager = app(AiProviderManager::class);
// or inject via constructor: public function __construct(private AiProviderManager $aiManager)
```

### Methods

```php
// Resolve text provider (respects config default + fallback)
$textProvider = $aiManager->resolveTextProvider(?string $provider = null): AiTextProvider;

// Resolve image provider
$imageProvider = $aiManager->resolveImageProvider(?string $provider = null): AiImageProvider;

// Check availability before resolving (avoids RuntimeException)
$aiManager->hasTextProvider(): bool;
$aiManager->hasImageProvider(): bool;

// List available provider names
$aiManager->availableProviders('text'): string[];  // e.g. ['openai', 'anthropic']
$aiManager->availableProviders('image'): string[];
```

### Provider Resolution Logic

1. If `$provider` argument passed, use that provider
2. Otherwise read `config('vela.ai.default_text_provider')` (set via `AI_TEXT_PROVIDER` env)
3. If the default has no API key, fall through to next in fallback order
4. Fallback order — Text: `openai` → `anthropic` → `gemini`; Image: `gemini` → `openai`
5. Throws `RuntimeException` if no provider has an API key

### Provider → Class Map

| Provider name | Text class | Image class |
|---------------|-----------|-------------|
| `openai` | `OpenAiTextService` | `OpenAiImageService` |
| `anthropic` | `ClaudeTextService` | — |
| `gemini` | `GeminiTextService` | `GeminiImageService` |

### API Key Config

| Provider | Config path | Env var |
|----------|------------|---------|
| OpenAI | `vela.ai.openai.api_key` | `OPENAI_API_KEY` |
| Anthropic | `vela.ai.anthropic.api_key` | `ANTHROPIC_API_KEY` |
| Gemini | `vela.ai.gemini.api_key` | `GEMINI_API_KEY` |

---

## Text Provider Implementations

### OpenAiTextService

**File**: `src/Services/OpenAiTextService.php`  
**API**: `https://api.openai.com/v1/chat/completions`  
**Model**: `gpt-4o`

- `generateText()` calls `generateTextRaw()` and extracts `choices[0].message.content`
- `generateTextRaw()` returns the full OpenAI response array (for internal use by legacy callers)
- `chat()` sends messages array + optional tools in OpenAI function-calling format
- `generateSingleIdea()` — generates a content idea using `SiteContext` for site-aware prompts

**Headers**: `Authorization: Bearer {api_key}`

---

### ClaudeTextService

**File**: `src/Services/ClaudeTextService.php`  
**API**: `https://api.anthropic.com/v1/messages`  
**Model**: `claude-sonnet-4-20250514`

**Required headers**:
```
x-api-key: {api_key}
anthropic-version: 2023-06-01
Content-Type: application/json
```

**`generateText()`**: Sends `messages: [{role: 'user', content: $prompt}]`, returns `content[0].text`

**`chat()`**: Anthropic returns tool calls as content blocks with `type='tool_use'`. These are normalized to the standard `tool_calls` format.

---

### GeminiTextService

**File**: `src/Services/GeminiTextService.php`  
**API**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`  
**Auth**: `?key={api_key}` query parameter (not a header)

**`generateText()`**: Wraps prompt in `contents: [{parts: [{text: $prompt}]}]` format, returns `candidates[0].content.parts[0].text`

**`chat()`**: Converts messages to Gemini format — role mapping: `assistant` → `model`. Tools converted to Gemini function declarations format.

---

## Image Provider Implementations

### GeminiImageService

**File**: `src/Services/GeminiImageService.php`

- `generateImageRaw(string $prompt, string $aspectRatio = '1:1')` — original signature for internal use
- `generateImage(string $prompt, array $options = [])` — interface method, reads `$options['aspect_ratio']`
- `saveBase64Image()` — saves to specified storage disk

---

### OpenAiImageService

**File**: `src/Services/OpenAiImageService.php`

- `generateImageRaw(string $prompt, string $size, string $quality, int $n)` — original signature
- `generateImage(string $prompt, array $options = [])` — interface method, reads `$options['size']`, `$options['quality']`, `$options['n']`
- `saveBase64Image()` — saves to specified storage disk

---

## SiteContext

**Namespace**: `VelaBuild\Core\Services\SiteContext`  
**File**: `src/Services/SiteContext.php`

Provides site metadata for AI prompts. Replaces all hardcoded site name references.

```php
$ctx = app(SiteContext::class);

$ctx->getName(): string           // e.g. "My Website"
$ctx->getNiche(): string          // e.g. "technology"
$ctx->getSiteDescription(): string // e.g. "a blog about web development"
$ctx->getDescription(): string    // formatted: "a technology website called 'My Website'"
```

### Config Resolution

Each method checks `VelaConfig` (DB) first, falls back to `config/vela.php`:

| Method | VelaConfig key | Config path | Env var |
|--------|---------------|-------------|---------|
| `getName()` | `site_name` | `vela.ai.site_context.name` | `SITE_NAME` |
| `getNiche()` | `site_niche` | `vela.ai.site_context.niche` | `SITE_NICHE` |
| `getSiteDescription()` | `site_description` | `vela.ai.site_context.description` | `SITE_DESCRIPTION` |

### `getDescription()` format

```
"a {niche} website called '{name}'. {description}"
// Example: "a technology website called 'My Website'. A blog about web development."
// If niche is 'general': "a website called 'My Site'"
```

---

## AI Chat System

### ChatToolRegistry

**File**: `src/Services/AiChat/ChatToolRegistry.php`

Defines the 15 tools the chatbot can invoke. Each tool definition:
```php
[
    'name'        => 'update_site_config',
    'description' => 'Update a site configuration value in the database',
    'parameters'  => ['type' => 'object', 'properties' => [...], 'required' => [...]],
    'write'       => true,   // false = read-only, no action log
    'gate'        => 'config_edit',  // null = no permission check
]
```

Methods:
- `all()` — all 15 tool definitions
- `forUser($user)` — filtered by Gate permissions
- `has(string $name)` — whitelist check
- `toOpenAiFormat(array $tools)` — converts to OpenAI function-calling schema
- `toAnthropicFormat(array $tools)` — converts to Anthropic tools schema
- `toGeminiFormat(array $tools)` — converts to Gemini function declarations schema

**Available tools**:

| Tool | Write | Gate |
|------|-------|------|
| `get_site_config` | No | — |
| `list_pages` | No | `page_access` |
| `list_articles` | No | `content_access` |
| `list_categories` | No | `category_access` |
| `get_page_info` | No | `page_access` |
| `get_template_file` | No | `ai_chat_template_edit` |
| `update_site_config` | Yes | `config_edit` |
| `update_template_colors` | Yes | `config_edit` |
| `create_page` | Yes | `page_create` |
| `edit_page_content` | Yes | `page_edit` |
| `create_article` | Yes | `content_create` |
| `edit_article_content` | Yes | `content_edit` |
| `create_category` | Yes | `category_create` |
| `generate_image` | Yes | `content_create` |
| `edit_template_file` | Yes | `ai_chat_template_edit` |

---

### ChatToolExecutor

**File**: `src/Services/AiChat/ChatToolExecutor.php`

Executes tool calls with whitelist enforcement, permission checks, and action logging.

```php
$result = $executor->execute(
    toolName: 'update_site_config',
    parameters: ['key' => 'site_name', 'value' => 'My Site'],
    conversationId: $conversation->id,
    messageId: $assistantMsg->id,
    user: $user
);
// Returns array: either tool result data or ['error' => '...']

$executor->undoAction(AiActionLog $actionLog): void;
```

**Execution flow**:
1. Whitelist check — tool name must exist in `ChatToolRegistry`
2. Gate permission check — `Gate::forUser($user)->denies($gate)`
3. Create `AiActionLog` with `status=pending` (write tools only)
4. Execute tool handler (`BaseTool` subclass)
5. Update action log to `completed` or `failed`

---

### Tool Handlers (BaseTool subclasses)

**Directory**: `src/Services/AiChat/Tools/`

Each tool extends `BaseTool`:
```php
abstract class BaseTool
{
    abstract public function execute(array $parameters, ?AiActionLog $actionLog = null): array;
    public function undo(AiActionLog $actionLog): void; // throws by default
}
```

Key write tools store `previous_state` in `$actionLog` before making changes:
- `UpdateSiteConfigTool` — stores old `VelaConfig` value; undo restores or deletes
- `UpdateTemplateColorsTool` — stores old CSS variable values; undo restores each
- `CreatePageTool` / `CreateArticleTool` / `CreateCategoryTool` — store created ID; undo soft-deletes
- `EditPageContentTool` / `EditArticleContentTool` — store previous content; undo restores
- `GenerateImageTool` — stores file path; undo deletes file
- `EditTemplateFileTool` — stores backup path; undo copies backup back; security scan before write

**Template file safety** (`EditTemplateFileTool`):
- Path traversal prevention via `realpath()` check
- Dangerous pattern blocklist: `@php`, `{!!`, `eval(`, `system(`, `exec(`, `shell_exec(`, `passthru(`, `proc_open(`, `popen(`
- Blade compilation validation before committing
- Auto-rollback from backup on compilation failure
- Backup retention: configurable via `config('vela.ai.chat.backup_retention', 5)`

---

## Adding a New Provider

1. Create `src/Services/MyProviderTextService.php` implementing `AiTextProvider`
2. Add API key config to `vendor/velabuild/core/config/vela.php` and `config/vela.php`:
   ```php
   'myprovider' => ['api_key' => env('MYPROVIDER_API_KEY')],
   ```
3. Add to `AiProviderManager` text provider map:
   ```php
   'myprovider' => MyProviderTextService::class,
   ```
4. Add to fallback order in `resolveTextProvider()`
5. Add to `availableProviders()` check

The provider is now available via `AI_TEXT_PROVIDER=myprovider` in `.env`.
