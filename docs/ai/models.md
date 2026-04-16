# Eloquent Models Reference

All models live in `vendor/velabuild/core/src/Models/` under the `VelaBuild\Core\Models\` namespace.

## Conventions (all models)

- Table names use `vela_` prefix; always declared explicitly via `public $table`
- All models use `SoftDeletes` trait — deleted records remain in DB with `deleted_at` set
- `serializeDate(DateTimeInterface $date)` is overridden to format as `Y-m-d H:i:s`
- `$dates` array includes `created_at`, `updated_at`, `deleted_at`
- `HasFactory` trait for test factories

---

## VelaUser

**Table**: `vela_users`  
**Traits**: `SoftDeletes`, `HasFactory`, `Notifiable`, `InteractsWithMedia`  
**Implements**: `MustVerifyEmail`, `HasMedia`

**Fillable fields**: `name`, `email`, `email_verified_at`, `password`, `two_factor`, `two_factor_code`, `remember_token`, `last_login_at`, `last_ip`, `useragent`, `bio`, `subscribe_newsletter`, `two_factor_expires_at`

**Relationships**:
- `role()` → `belongsTo(Role)` via `role_id`
- `permissions()` → through role

**Notes**:
- Used as the auth user for the `vela` guard
- `two_factor_code` is a TOTP secret; `generateTwoFactorCode()` / `resetTwoFactorCode()` methods manage it
- Media library integration for profile photos

---

## Content

**Table**: `vela_contents`  
**Traits**: `SoftDeletes`, `HasFactory`, `InteractsWithMedia`  
**Implements**: `HasMedia`

**Fillable fields**: `title`, `slug`, `type`, `description`, `keyword`, `content`, `author_id`, `status`, `written_at`, `approved_at`, `published_at`

**Constants**:
- `TYPE_SELECT`: `['page', 'post']`
- `STATUS_SELECT`: `['planned', 'draft', 'scheduled', 'published']`

**Casts**: `content` → `array` (EditorJS JSON format)

**Relationships**:
- `author()` → `belongsTo(VelaUser, 'author_id')`
- `categories()` → `belongsToMany(Category, 'vela_category_content')`
- Media conversions: `thumb` (50×50), `preview` (120×120)

**Notes**:
- `content` column stores EditorJS block format as JSON
- Slug is auto-generated from title on create via model observer
- `type` distinguishes between blog posts and standalone pages (different from `Page` model — `Page` is for nav/structural pages)

---

## Category

**Table**: `vela_categories`  
**Traits**: `SoftDeletes`, `HasFactory`, `InteractsWithMedia`  
**Implements**: `HasMedia`

**Fillable fields**: `name`, `icon`, `order_by`

**Relationships**:
- `contents()` → `belongsToMany(Content, 'vela_category_content')`

**Media conversions**: `thumb` (50×50), `preview` (120×120)

---

## Page

**Table**: `vela_pages`  
**Traits**: `SoftDeletes`, `HasFactory`, `InteractsWithMedia`  
**Implements**: `HasMedia`

**Fillable fields**: `title`, `slug`, `locale`, `status`, `meta_title`, `meta_description`, `custom_css`, `custom_js`, `order_column`, `parent_id`

**Constants**:
- `STATUS_SELECT`: `['draft', 'published', 'unlisted']`
- `RESERVED_SLUGS`: array of slugs that cannot be used (system routes)

**Relationships**:
- `rows()` → `hasMany(PageRow)` — structural rows containing blocks
- `parent()` → `belongsTo(Page, 'parent_id')`
- `children()` → `hasMany(Page, 'parent_id')`

**Notes**:
- Pages use a row/block layout system (different from Content's EditorJS format)
- `PageRow` → `PageBlock` is the nested structure for page builder

---

## PageRow

**Table**: `vela_page_rows`  
**Traits**: `SoftDeletes`, `HasFactory`

**Fillable fields**: `page_id`, `order_column`, `settings`

**Relationships**:
- `page()` → `belongsTo(Page)`
- `blocks()` → `hasMany(PageBlock)`

---

## PageBlock

**Table**: `vela_page_blocks`  
**Traits**: `SoftDeletes`, `HasFactory`

**Fillable fields**: `page_row_id`, `type`, `content`, `settings`, `order_column`

**Casts**: `content` → `array`, `settings` → `array`

**Relationships**:
- `row()` → `belongsTo(PageRow)`

---

## Idea

**Table**: `vela_ideas`  
**Traits**: `SoftDeletes`, `HasFactory`

**Fillable fields**: `name`, `details`, `keyword`, `status`, `category_id`

**Constants**:
- `STATUS_SELECT`: `['new', 'planned', 'created', 'reject']`
- `STATUS_FILTERS`: `['open', 'new', 'planned', 'created', 'reject']`

**Relationships**:
- `category()` → `belongsTo(Category)`

---

## VelaConfig

**Table**: `vela_configs`  
**Traits**: `SoftDeletes`, `HasFactory`

**Fillable fields**: `key`, `value`

**Notes**:
- Simple key/value store for runtime configuration overrides
- Takes priority over `config/vela.php` values when read via `SiteContext` or similar helpers
- Common keys: `site_name`, `site_niche`, `site_description`, `css_--primary` (template CSS vars)
- Accessed via `VelaConfig::where('key', $key)->value('value')`
- Updated via `VelaConfig::updateOrCreate(['key' => $key], ['value' => $value])`

---

## Permission

**Table**: `vela_permissions`  
**Traits**: `SoftDeletes`, `HasFactory`

**Fillable fields**: `title`

**Relationships**:
- `roles()` → `belongsToMany(Role, 'vela_permission_role')`

**Notes**:
- Permission titles are snake_case strings (e.g., `content_create`, `ai_chat_access`)
- Gate checks resolve against the authenticated user's role's permissions
- Seeded via `VelaPermissionsSeeder` using `Permission::firstOrCreate(['title' => $name])`

---

## Role

**Table**: `vela_roles`  
**Traits**: `SoftDeletes`, `HasFactory`

**Fillable fields**: `title`

**Relationships**:
- `permissions()` → `belongsToMany(Permission, 'vela_permission_role')`
- `users()` → `hasMany(VelaUser)`

**Notes**:
- Default roles: `Admin` (all permissions) and `User` (subset of permissions)
- `VelaRolesSeeder` defines `$userExcluded` — permissions that only Admin gets

---

## AiConversation

**Table**: `vela_ai_conversations`  
**Traits**: `SoftDeletes`, `HasFactory`

**Fillable fields**: `user_id`, `title`, `context`

**Casts**: `context` → `array`

**Relationships**:
- `user()` → `belongsTo(VelaUser, 'user_id')`
- `messages()` → `hasMany(AiMessage, 'conversation_id')->orderBy('created_at')`
- `actionLogs()` → `hasMany(AiActionLog, 'conversation_id')`

**Notes**:
- Created automatically when a user sends the first message in a session
- `context` stores the page context (URL, route) at conversation start
- `title` is set from the first 50 characters of the first user message

---

## AiMessage

**Table**: `vela_ai_messages`  
**Traits**: None (no SoftDeletes — messages are permanent)

**Fillable fields**: `conversation_id`, `role`, `content`, `tool_calls`, `tool_call_id`, `tokens_used`

**Casts**: `tool_calls` → `array`, `tokens_used` → `integer`

**Roles**: `user`, `assistant`, `system`, `tool`

**Relationships**:
- `conversation()` → `belongsTo(AiConversation)`

**Notes**:
- `tool_calls` stores the AI's requested tool invocations as a JSON array
- `tool_call_id` links tool result messages back to the originating tool call
- `tokens_used` tracks API token consumption for cost monitoring

---

## AiActionLog

**Table**: `vela_ai_action_logs`  
**Traits**: None (no SoftDeletes)

**Fillable fields**: `conversation_id`, `message_id`, `user_id`, `tool_name`, `parameters`, `previous_state`, `result`, `status`, `undone_at`

**Casts**: `parameters` → `array`, `previous_state` → `array`, `result` → `array`, `undone_at` → `datetime`

**Status values**: `pending`, `completed`, `failed`

**Relationships**:
- `conversation()` → `belongsTo(AiConversation)`
- `message()` → `belongsTo(AiMessage)`
- `user()` → `belongsTo(VelaUser)`

**Key method**:
```php
public function canUndo(): bool
{
    return $this->status === 'completed' && $this->undone_at === null;
}
```

**Notes**:
- `previous_state` is populated BEFORE the tool executes (enables undo)
- Created with `status=pending`, updated to `completed` or `failed` after execution
- Undo sets `undone_at` timestamp; `canUndo()` checks both conditions

---

## Other Models

### Comment
**Table**: `vela_comments` — User comments on content. SoftDeletes.

### FormSubmission
**Table**: `vela_form_submissions` — Contact/form data. SoftDeletes.

### Translation
**Table**: `vela_translations` — Stores translated strings for multilingual support. SoftDeletes.
