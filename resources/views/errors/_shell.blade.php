{{-- Shared shell for Vela's default error pages.
     Standalone on purpose: site layouts run DB queries (menus, settings);
     a 500 in the layout while rendering a 500 page is the nastiest loop.

     Variables the caller must pass:
       $code    — big numeric/label shown above the heading
       $title   — <h1> text
       $message — lead paragraph
       $hint    — optional secondary paragraph (muted)
--}}
<!DOCTYPE html>
<html lang="{{ app()->getLocale() ?? 'en' }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $title ?? 'Error' }}</title>
    <meta name="robots" content="noindex">
    <style>
        :root {
            --ink: #0f172a;
            --muted: #64748b;
            --surface: #ffffff;
            --bg: #f8fafc;
            --border: #e5e7eb;
            --accent: #4f46e5;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --ink: #f1f5f9;
                --muted: #94a3b8;
                --surface: #0f172a;
                --bg: #020617;
                --border: #1e293b;
                --accent: #818cf8;
            }
        }
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; height: 100%; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI",
                         Roboto, "Helvetica Neue", Arial, sans-serif;
            color: var(--ink);
            background: var(--bg);
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 48px 24px;
            line-height: 1.55;
            -webkit-font-smoothing: antialiased;
        }
        main {
            max-width: 520px;
            width: 100%;
            text-align: center;
        }
        .mark {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
            color: var(--muted);
            text-decoration: none;
            margin-bottom: 56px;
            letter-spacing: 0.01em;
        }
        .mark-dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            background: var(--accent);
            display: inline-block;
        }
        .code {
            font-size: clamp(56px, 9vw, 84px);
            font-weight: 300;
            letter-spacing: -0.04em;
            color: var(--muted);
            margin: 0 0 4px;
            font-variant-numeric: tabular-nums;
            line-height: 1;
        }
        h1 {
            font-size: clamp(22px, 3.2vw, 30px);
            font-weight: 600;
            letter-spacing: -0.02em;
            margin: 16px 0 14px;
            color: var(--ink);
        }
        p {
            color: var(--muted);
            margin: 0 0 12px;
            font-size: 16px;
        }
        p.hint {
            font-size: 14px;
            color: var(--muted);
            opacity: 0.85;
        }
        .actions {
            margin-top: 32px;
            display: flex;
            gap: 10px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .btn {
            display: inline-block;
            padding: 11px 22px;
            border-radius: 999px;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            transition: background .15s ease, transform .1s ease;
        }
        .btn:active { transform: scale(.98); }
        .btn-primary {
            background: var(--ink);
            color: var(--bg);
        }
        .btn-primary:hover { background: var(--accent); }
        .btn-ghost {
            color: var(--ink);
            border: 1px solid var(--border);
        }
        .btn-ghost:hover { border-color: var(--ink); }
    </style>
</head>
<body>
    <main>
        <a href="{{ url('/') }}" class="mark" aria-label="Home">
            <span class="mark-dot"></span>
            <span>{{ config('app.name', 'Vela') }}</span>
        </a>

        <p class="code">{{ $code }}</p>
        <h1>{{ $title }}</h1>
        <p>{{ $message }}</p>
        @isset($hint)
            <p class="hint">{{ $hint }}</p>
        @endisset

        <div class="actions">
            <a href="{{ url('/') }}" class="btn btn-primary">Back to home</a>
            @isset($secondary)
                <a href="{{ $secondary['url'] }}" class="btn btn-ghost">{{ $secondary['label'] }}</a>
            @endisset
        </div>
    </main>
</body>
</html>
