# Artisan Commands Reference

All Vela artisan commands are prefixed with `vela:` and follow a consistent pattern: constructor DI for services, `--dry-run` to preview without changes, `--force` to skip confirmation prompts, and exit code `0` (success) / `1` (error).

---

## `vela:create-content`

Generate a new blog article using AI.

**Signature:**
```
vela:create-content
    [--title=]        Content title
    [--prompt=]       AI prompt describing the content to generate
    [--category=]     Category name or ID to assign
    [--type=post]     Content type: post or page
    [--status=draft]  Content status: draft, published, planned, scheduled
    [--with-images]   Queue image generation after creating the article
    [--dry-run]       Show the AI prompt without creating any records
```

**Behaviour:**
- Validates that a text provider is configured; exits 1 with a clear error if not
- In non-interactive mode (all flags provided), creates the record and exits without prompting
- In interactive mode, prompts for missing title, prompt, and category
- Converts AI markdown output to EditorJS JSON before saving
- On success, prints a JSON line to stdout for CI/CD piping: `{"id":1,"title":"...","slug":"..."}`

**CI/CD examples:**
```bash
# Create a draft article, no interaction
php artisan vela:create-content \
  --title="10 Tips for Beginners" \
  --prompt="Write practical beginner tips in an encouraging tone" \
  --category="Tutorials" \
  --status=draft

# Create and queue image generation, capture JSON output
RESULT=$(php artisan vela:create-content \
  --title="Product Review" \
  --prompt="Detailed review of the latest model" \
  --with-images \
  --status=published)
ARTICLE_ID=$(echo $RESULT | jq -r '.id')

# Preview prompt without creating
php artisan vela:create-content \
  --title="Test Post" \
  --prompt="A test" \
  --dry-run
```

---

## `vela:customize-template`

Customize the active template via CSS variable overrides or AI-powered file editing.

**Signature:**
```
vela:customize-template
    [--template=]   Template name (defaults to active template from config)
    [--colors=]     JSON object of CSS variable overrides e.g. {"--primary":"#ff0000"}
    [--prompt=]     Natural language description of changes for AI editing
    [--file=]       Template file to edit, relative to the template directory
    [--dry-run]     Show changes without applying them
    [--force]       Overwrite without backup confirmation
```

**Two modes:**

**Mode 1: Config-based (CSS variables)**
Stores values as `VelaConfig` entries with `css_` prefix (e.g., `css_--primary`). The template reads these at runtime to build `custom.css`. No file writes, instantly reversible.

```bash
# Single variable
php artisan vela:customize-template --colors='{"--primary":"#0066cc"}'

# Multiple variables
php artisan vela:customize-template --colors='{
  "--primary": "#0066cc",
  "--secondary": "#6c757d",
  "--font-family-base": "\"Inter\", sans-serif"
}'

# Preview
php artisan vela:customize-template --colors='{"--primary":"#ff0000"}' --dry-run
```

**Mode 2: AI-powered file editing**
Requires both `--prompt` and `--file`. Reads the current file, asks AI to apply the described changes, validates the output, creates a backup, then writes atomically.

```bash
# Edit a specific Blade file
php artisan vela:customize-template \
  --file="resources/views/partials/header.blade.php" \
  --prompt="Add a 'Subscribe' button to the top navigation"

# Preview the AI's proposed changes
php artisan vela:customize-template \
  --file="resources/views/layouts/app.blade.php" \
  --prompt="Remove the sidebar and make the main content full width" \
  --dry-run
```

**Safety guardrails (AI mode):**
- Rejects output containing `@php`, `{!!`, `eval(`, `system(`, `exec(`, `shell_exec(`, `passthru(`, `proc_open(`, `popen(`
- Validates Blade compilation before writing (rolls back on failure)
- Creates a timestamped backup before every write
- Keeps last 5 backups per file (configurable via `vela.ai.chat.backup_retention`)

---

## `vela:generate-image`

Generate an image using the configured AI image provider.

**Signature:**
```
vela:generate-image
    [--prompt=]    Detailed description of the image to generate
    [--type=content]  Image type hint: logo, hero, content
    [--size=1024x1024]  Size (OpenAI) or aspect ratio (Gemini), e.g. 1:1, 16:9
    [--provider=]  Force a specific provider: openai or gemini
    [--output=]    Output file path (default: public/images/generated-{timestamp}.png)
    [--dry-run]    Print the prompt without generating
```

**Behaviour:**
- Exits 1 if no image provider is configured
- Writes image atomically (tmp file then rename)
- On success, prints JSON to stdout: `{"path":"/path/to/image.png","size":102400}`

**CI/CD examples:**
```bash
# Generate a hero image
php artisan vela:generate-image \
  --prompt="Wide panoramic mountain landscape at sunset, photorealistic" \
  --type=hero \
  --size="16:9" \
  --output=public/images/hero.png

# Generate logo with OpenAI specifically
php artisan vela:generate-image \
  --prompt="Minimalist abstract logo, flat design, navy and white" \
  --type=logo \
  --provider=openai \
  --output=public/images/logo.png

# Dry run preview
php artisan vela:generate-image \
  --prompt="Abstract geometric pattern" \
  --dry-run
```

---

## `vela:wizard`

Interactive, step-by-step AI-powered site setup wizard. Delegates to the atomic commands above.

**Signature:**
```
vela:wizard
    [--skip=]   Comma-separated steps to skip: template,colors,graphics,categories,content
```

**Steps (in order):**
1. **template** — Select template from available registered templates
2. **colors** — Set primary color and other CSS variables (delegates to `vela:customize-template --colors`)
3. **graphics** — Generate logo and hero image (delegates to `vela:setup-graphics`)
4. **categories** — Enter category names to create
5. **content** — Generate N draft articles (delegates to `vela:create-content --with-images`)

**Examples:**
```bash
# Full interactive wizard
php artisan vela:wizard

# Skip graphics (no image provider configured)
php artisan vela:wizard --skip=graphics

# Skip everything except content generation
php artisan vela:wizard --skip=template,colors,graphics,categories

# Non-interactive via piped input (CI)
echo -e "default\n#0066cc\nNews,Tutorials,Reviews\n3" | php artisan vela:wizard --skip=graphics
```

---

## `vela:setup-graphics`

Generate logo and hero images for the active template using the configured image provider.

**Signature:**
```
vela:setup-graphics
    [--force]       Skip confirmation prompts and overwrite existing files
    [--only=]       Comma-separated: logo, hero (generate only specified types)
    [--dry-run]     Show what would be generated without calling the API
```

**Behaviour:**
- Checks for image provider; exits 1 if none configured
- Reads site context from `SiteContext` service to build prompts
- Saves images to the active template's asset directory
- Backs up existing images before overwriting

**Examples:**
```bash
# Generate both logo and hero (prompts for confirmation)
php artisan vela:setup-graphics

# Overwrite without confirmation
php artisan vela:setup-graphics --force

# Regenerate only the hero image
php artisan vela:setup-graphics --only=hero --force

# Preview prompts
php artisan vela:setup-graphics --dry-run
```

---

## Common Patterns

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (missing config, validation failure, AI error) |

### Non-Interactive Mode

All commands support fully non-interactive execution by providing all required flags. This is required for CI/CD pipelines:

```bash
# All flags provided — no prompts
php artisan vela:create-content \
  --title="My Article" \
  --prompt="Write about topic X" \
  --type=post \
  --status=draft
```

### JSON Output for Piping

Commands that create records print a JSON object to stdout on the last line. Use `jq` to extract fields:

```bash
OUTPUT=$(php artisan vela:create-content --title="Test" --prompt="Write test content")
ID=$(echo "$OUTPUT" | tail -1 | jq -r '.id')
```

### Provider Configuration

Commands use `AiProviderManager` to resolve the active provider. Configure via `.env`:

```env
AI_TEXT_PROVIDER=openai    # openai | anthropic | gemini
AI_IMAGE_PROVIDER=gemini   # gemini | openai
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
```

If the configured provider has no API key, `AiProviderManager` falls back:
- Text: `openai` → `anthropic` → `gemini`
- Image: `gemini` → `openai`
