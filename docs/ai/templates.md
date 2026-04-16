# Template System Reference

## Overview

Templates are PHP packages registered with the `TemplateRegistry`. The active template is read from `config('vela.template.active')`. All template customization goes through config overrides or the provided artisan commands — never edit template files directly in production without backups.

---

## Template Registration

Templates register themselves via `TemplateRegistry`. The registry stores each template's metadata including its filesystem path:

```php
$vela = app(\VelaBuild\Core\Vela::class);
$templates = $vela->templates()->all();
// ['default' => ['path' => '/path/to/template', ...], ...]
```

**Active template path resolution:**
```php
$templateName = config('vela.template.active', 'default');
$templatePath = app(\VelaBuild\Core\Vela::class)->templates()->all()[$templateName]['path'];
```

---

## Blade Structure Conventions

Template Blade views live in the template package's `resources/views/` directory. Typical layout:

```
resources/views/
├── layouts/
│   └── app.blade.php        # Main layout wrapper
├── partials/
│   ├── header.blade.php     # Site header / navigation
│   ├── footer.blade.php     # Site footer
│   └── sidebar.blade.php    # Optional sidebar
├── pages/
│   └── show.blade.php       # Page content display
├── content/
│   ├── index.blade.php      # Blog listing
│   └── show.blade.php       # Single article
└── home.blade.php           # Homepage
```

Templates receive standard Vela view data through the public controllers. Site name, description, and other metadata are injected via the `SiteContext` service.

---

## CSS Variable System

### How It Works

Templates use CSS custom properties (variables) for theming. The active values are stored as `VelaConfig` database entries with a `css_` key prefix:

| VelaConfig key | CSS variable | Example value |
|----------------|-------------|---------------|
| `css_--primary` | `--primary` | `#0066cc` |
| `css_--secondary` | `--secondary` | `#6c757d` |
| `css_--font-family-base` | `--font-family-base` | `"Inter", sans-serif` |

The template's CSS file reads these variables and applies them throughout the design.

### Reading CSS Variables at Runtime

A controller or view composer assembles the CSS variables from `VelaConfig` and injects them as a `<style>` block:

```php
$cssVars = VelaConfig::where('key', 'like', 'css_%')
    ->pluck('value', 'key')
    ->mapWithKeys(fn ($v, $k) => [substr($k, 4) => $v]); // strip 'css_' prefix
```

Rendered as:
```html
<style>:root { --primary: #0066cc; --secondary: #6c757d; }</style>
```

### Updating CSS Variables

**Via artisan (recommended for CI/CD):**
```bash
php artisan vela:customize-template --colors='{"--primary":"#0066cc","--secondary":"#495057"}'
```

**Via the chatbot:**
> "Change the primary color to deep blue #1a237e"

**Via code:**
```php
VelaConfig::updateOrCreate(['key' => 'css_--primary'], ['value' => '#0066cc']);
```

Changes take effect immediately — no cache clear or recompile needed.

---

## Customizing Templates

### Method 1: CSS Variable Overrides (Non-destructive)

Best for color, font, and spacing changes. Stored in the database; original template files are never touched.

```bash
php artisan vela:customize-template --colors='{
  "--primary": "#1a237e",
  "--background": "#f8f9fa",
  "--font-size-base": "16px"
}'
```

To reset a variable to the template default, delete the corresponding `VelaConfig` entry.

### Method 2: AI-Powered File Editing

For structural HTML/Blade changes. Requires `--prompt` and `--file`:

```bash
php artisan vela:customize-template \
  --file="resources/views/partials/header.blade.php" \
  --prompt="Add a sticky navigation bar with a search icon"
```

The command:
1. Reads the current file
2. Sends file content + instructions to the AI text provider
3. Validates the response (safety scan + Blade compilation)
4. Creates a backup, then writes the file atomically
5. Rolls back from backup if compilation fails

### Method 3: Admin Chatbot

Non-technical users can customize templates through the AI chatbot sidebar:
> "Update the header to include a phone number in the top bar"
> "Make the footer background dark grey"

The chatbot uses the `edit_template_file` tool, which applies the same safety and backup guardrails as the artisan command.

---

## Security Guardrails for Template Editing

Every AI-generated template edit is checked before writing:

### Blocked Patterns

The following patterns in AI output cause the edit to be rejected immediately:

| Pattern | Reason |
|---------|--------|
| `@php` | Raw PHP execution |
| `{!!` | Unescaped output (XSS risk) |
| `eval(` | Dynamic PHP execution |
| `system(` | OS command execution |
| `exec(` | OS command execution |
| `shell_exec(` | OS command execution |
| `passthru(` | OS command execution |
| `proc_open(` | Process spawning |
| `popen(` | Process spawning |

If any blocked pattern is found, the edit is aborted with an error and the original file is unchanged.

### Blade Compilation Check

After the security scan, the proposed content is compiled using Laravel's Blade compiler:

```php
app('blade.compiler')->compileString($newContent);
```

If compilation throws, the edit is rejected and the file remains unchanged. If the file was already backed up, the backup is retained for manual inspection.

### Allowed Modifications

AI template edits may only contain:
- HTML structure (`<div>`, `<nav>`, `<section>`, etc.)
- CSS classes (Bootstrap, CoreUI, or custom)
- Safe Blade directives: `@if`, `@foreach`, `@include`, `@extends`, `@section`, `@yield`, `@can`, `@auth`, `{{ $variable }}`, etc.
- Inline styles using CSS custom properties

---

## Backup and Rollback System

### Backup Location

All template file backups are stored in:
```
storage/app/template-backups/{filename}.{Y-m-d-H-i-s}.backup
```

Example: `storage/app/template-backups/header.blade.php.2026-04-03-14-30-00.backup`

### Retention Policy

Only the last N backups per file are kept (default: 5, configurable via `config('vela.ai.chat.backup_retention')`). Older backups are automatically deleted after each successful write.

### Manual Rollback

To manually restore a file from backup:
```bash
cp storage/app/template-backups/header.blade.php.2026-04-03-14-30-00.backup \
   /path/to/template/resources/views/partials/header.blade.php
```

### Undo via Chatbot

Actions performed through the chatbot can be undone using the **Undo** button that appears after each change. The undo restores the backup copy atomically. The undo window is limited to the last 10 actions per conversation.

---

## Atomic Write Pattern

All template file writes follow the tmp-then-rename pattern to prevent partial writes:

```
1. Write new content to {file}.tmp
2. Validate Blade compilation
3. rename({file}.tmp, {file})   ← atomic on POSIX filesystems
```

If step 2 fails, the `.tmp` file is deleted and the original is untouched.

---

## Configuration Reference

```php
// config/vela.php
'template' => [
    'active' => env('VELA_TEMPLATE', 'default'),
],

'ai' => [
    'chat' => [
        'backup_retention' => 5,   // backups kept per file
        'max_undo_depth'   => 10,  // undoable actions per conversation
    ],
],
```

Environment variable:
```env
VELA_TEMPLATE=default
```
