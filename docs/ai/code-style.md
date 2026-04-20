# Vela Code Style Guide

This is the official source-formatting standard for Vela. It applies to **every** Blade template, page-builder block, JSON fixture, and PHP file shipped in `velabuild/core` and its companion repos. Generated HTML is also expected to follow from clean sources — jagged rendered output is a symptom of jagged Blade.

The rules below are not suggestions. Pick this up before writing or editing any view.

---

## 1. Universal rules

| Rule | Value |
|------|-------|
| Indent | **4 spaces**. No tabs. No 2-space. |
| Line endings | **LF** (`\n`). No CRLF. |
| End of file | **Single trailing newline**. |
| Trailing whitespace | **None**. |
| Consecutive blank lines | **At most one**. |
| Charset | **UTF-8**, no BOM. |
| Soft line limit | **120 chars** — split long attribute lists past this. |

All of these are mechanically checkable. If a linter disagrees with a human, fix the code, not the linter.

---

## 2. Blade files

### 2.1 Directives as indent levels

`@if` / `@elseif` / `@else` / `@endif`, `@foreach` / `@endforeach`, `@for` / `@endfor`, `@while` / `@endwhile`, `@section` / `@endsection`, `@push` / `@endpush`, `@component` / `@endcomponent` **all create an indent level.** Content inside them is indented one step (+4) relative to the directive.

**Correct:**

```blade
@if($posts->isNotEmpty())
    <div class="block-posts-grid">
        @foreach($posts as $post)
            <a href="{{ $post->url }}">{{ $post->title }}</a>
        @endforeach
    </div>
@else
    @include('vela::public.pages.blocks._empty_state', [...])
@endif
```

**Wrong** (content at same level as directive — makes nesting invisible):

```blade
@if($posts->isNotEmpty())
<div class="block-posts-grid">
    ...
</div>
@endif
```

Both the `@if` and `@else` branches must use the same style. Do not indent one branch and not the other.

### 2.2 `@php … @endphp`

The directive stays at the enclosing indent level. Its body is indented +4.

```blade
@php
    $title = $block->content['title'] ?? '';
    $url   = $block->content['url']   ?? '';
@endphp
```

Aligning the `=` is encouraged when four or fewer variables are defined in a single `@php` block and the alignment makes scanning easier. Do not align if it forces awkward long gaps.

### 2.3 Attribute wrapping

Short tags stay on one line:

```blade
<a href="{{ $url }}" class="btn-primary">{{ $label }}</a>
```

Once the opening tag (excluding content) exceeds the 120-char soft limit, break attributes onto their own lines, indented +4 from the tag:

```blade
<a
    href="{{ $url }}"
    class="btn-primary btn-lg"
    data-analytics="{{ $slug }}"
    rel="noopener">
    {{ $label }}
</a>
```

The closing `>` of the opening tag sits on the last attribute's line — not on its own line. The content then opens at the child indent level.

### 2.4 Blade whitespace: rendered HTML indentation

Blade + PHP have two quirks that affect what indentation the **rendered HTML** has, independent of source style:

1. **PHP eats the `\n` after `?>`.** Every `@if`, `@endif`, `@foreach`, `@include`, `@stack`, `@php`, etc. compiles to a `<?php ... ?>` that swallows its own trailing newline. Any leading whitespace on that source line therefore gets prepended to the next line's output.
2. **Laravel's `PhpEngine` wraps every partial in `ltrim(ob_get_clean())`.** The first line of any `@include`d partial has its leading whitespace stripped.

Two practical rules follow:

- **Put block-level Blade directives at column 0 in partials** — `@if`, `@foreach`, `@endphp` on the outer boundary. Their body stays at the target indent; only the directive line itself is flush-left. This prevents leading whitespace from leaking into the next output line. (Example: `hreflang.blade.php`, `meta-pwa.blade.php`.)
- **`@include` for a partial that is guaranteed to emit content** (meta-seo, meta-opengraph, hreflang) is indented to col 4 in the layout; the ltrim of its first line is cancelled out by the layout's leading spaces. **`@include` for a partial that may be empty** (analytics, theme-colors, custom-css, `@stack`) is flush-left at col 0 so empty renders don't accumulate whitespace.

The rule for in-page Blade (not head partials) stays the same: directives add an indent level for their body (see 2.1). The head-partial exception is documented because `<head>` is the one place where the visual output matters as much as the source.

### 2.5 Inline Blade directives in attributes

Prefer inline directives over splitting a tag just to condition an attribute:

```blade
<details class="switcher"@if($open) open @endif>
```

Not this:

```blade
@if($open)
    <details class="switcher" open>
@else
    <details class="switcher">
@endif
    ...
```

### 2.6 Void elements

No trailing slash on HTML5 void elements. This includes `<img>`, `<link>`, `<meta>`, `<br>`, `<hr>`, `<input>`, `<source>`, `<track>`, `<wbr>`.

```html
<link rel="stylesheet" href="/css/app.css">   ✓
<link rel="stylesheet" href="/css/app.css" /> ✗
```

### 2.7 Boolean attributes

Use the bare form.

```html
<input type="checkbox" checked>       ✓
<details open>                        ✓
<input type="checkbox" checked="checked">  ✗
```

### 2.8 Array `@include` calls

Multi-key array includes are stacked vertically, aligned `=>`, with a trailing comma on the last element:

```blade
@include('vela::public.pages.blocks._empty_state', [
    'icon'    => 'fa-newspaper',
    'title'   => trans('vela::global.posts_grid_empty_title'),
    'message' => trans('vela::global.posts_grid_empty_message'),
    'ctaText' => trans('vela::global.posts_grid_empty_cta'),
    'ctaUrl'  => route('vela.admin.contents.create'),
])
```

Single-key includes stay inline: `@include('foo', ['x' => 1])`.

### 2.9 Inline styles

Inline `style=""` is acceptable for one-off positioning (e.g. grid columns driven by DB settings). Do not use it for anything a template-level stylesheet could express. Pack declarations with no space after the colon or between them: `style="display:grid;gap:20px;"`. That's what the page-builder emits, so keep hand-written markup consistent.

### 2.10 Blade expression spacing

```blade
{{ $var }}        ✓ one space on each side
{{$var}}          ✗
{!! $html !!}     ✓
{!!$html!!}       ✗
```

Echo the escaped form (`{{ … }}`) by default. Only use `{!! … !!}` for values that are demonstrably already-safe HTML (e.g. output of `vela_image()`).

---

## 3. JSON fixtures (`home-template.json`, seed data, etc.)

- 4-space indent
- Double-quoted keys and strings
- No trailing commas (it's JSON, not PHP)
- Final newline
- Object key order: user-visible identity first (`name`, `slug`, `title`), then structural props (`css_class`, `background_*`, `text_*`, `width`, `padding`), then `order`, then nested collections (`blocks`). Keep this order consistent across every row/block.

Example:

```json
{
    "name": "Hero",
    "css_class": "home-row-hero",
    "background_color": "#1e3a5f",
    "text_color": "#ffffff",
    "width": "full",
    "order": 0,
    "blocks": [
        {
            "column_index": 0,
            "column_width": 12,
            "order": 0,
            "type": "hero",
            "content": { "title": "Welcome" },
            "settings": { "min_height": "80vh" }
        }
    ]
}
```

---

## 4. PHP files

### 4.1 PSR-12 baseline

Vela PHP follows PSR-12 with two Vela-specific amendments:

### 4.2 Model skeletons

Every Eloquent model (see database conventions elsewhere) must declare fillable, dates, and `serializeDate` in this order:

```php
class PageRow extends Model
{
    use HasFactory, SoftDeletes;

    public $table = 'vela_page_rows';

    protected $fillable = [
        'page_id',
        'name',
        'width',
        'order_column',
    ];

    protected $dates = ['created_at', 'updated_at', 'deleted_at'];

    protected function serializeDate(DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
```

### 4.3 Array formatting

Multi-element arrays span lines. Short inline arrays are fine when the full expression fits in 120 chars:

```php
$payload = [
    'name'  => $row->name,
    'width' => $row->width,
];

$sizes = [640, 960, 1280, 1920];
```

---

## 5. CSS

- 4-space indent (for multi-line rules).
- Single-line rules are the preferred form for simple utility selectors: `.block-empty-state-icon { font-size: 2.2rem; opacity: 0.45; }` — same convention used throughout `page-blocks.css`.
- One space after the colon, one space before `{`, one space before `}`.
- CSS custom properties (`--accent`) are kebab-case; always fall back: `color: var(--accent, #3b82f6);`.
- Group rules by the section they belong to, with a `/* Section name */` comment preceding each block.

---

## 6. Enforcement

If a file deviates from this guide, **fix the whole file** rather than the one deviation you touched — partial cleanups create a ragged-edge codebase that's worse than consistent wrong. The goal is that every file you open looks like it was written by the same person on the same day.

When adding new templates or blocks, start from an existing clean file (`cta.blade.php`, `accordion.blade.php`) rather than from scratch.
