<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class StaticRewriteUrls extends Command
{
    protected $signature = 'vela:static-rewrite-urls
        {--from= : Source URL to replace (defaults to APP_URL)}
        {--to= : Target URL to write (defaults to LIVE_URL)}
        {--reverse : Swap defaults — rewrite LIVE_URL back to APP_URL (for restoring local dev after a push)}
        {--path= : Static cache path (defaults to config vela.static.path)}
        {--dry-run : Report what would change without writing}';

    protected $description = 'Rewrite absolute dev URLs in resources/static/*.html to the production host.';

    public function handle(): int
    {
        $appUrl  = rtrim((string) config('app.url'), '/');
        $liveUrl = rtrim((string) env('LIVE_URL', ''), '/');

        if ($this->option('reverse')) {
            $from = rtrim((string) ($this->option('from') ?: $liveUrl), '/');
            $to   = rtrim((string) ($this->option('to')   ?: $appUrl),  '/');
        } else {
            $from = rtrim((string) ($this->option('from') ?: $appUrl),  '/');
            $to   = rtrim((string) ($this->option('to')   ?: $liveUrl), '/');
        }

        if ($from === '') {
            $this->error('No source URL — set APP_URL or pass --from.');
            return 1;
        }

        if ($to === '') {
            $this->error('No target URL — set LIVE_URL in .env or pass --to.');
            return 1;
        }

        if ($from === $to) {
            $this->info("APP_URL already equals LIVE_URL ({$from}) — nothing to do.");
            return 0;
        }

        $base = $this->option('path') ?: config('vela.static.path', resource_path('static'));

        if (!is_dir($base)) {
            $this->error("Static cache path not found: {$base}");
            return 1;
        }

        $dryRun = (bool) $this->option('dry-run');

        $files     = $this->findHtmlFiles($base);
        $changed   = 0;
        $untouched = 0;
        $replaced  = 0;

        foreach ($files as $file) {
            $original = file_get_contents($file);
            if ($original === false) {
                $this->warn("Could not read {$file}");
                continue;
            }

            $count    = 0;
            $updated  = str_replace($from, $to, $original, $count);

            if ($count === 0) {
                $untouched++;
                continue;
            }

            $changed++;
            $replaced += $count;

            if ($dryRun) {
                $this->line("would rewrite {$count}× in " . $this->relative($file, $base));
                continue;
            }

            $tmp = $file . '.tmp';
            file_put_contents($tmp, $updated);
            rename($tmp, $file);
        }

        $verb = $dryRun ? 'Would rewrite' : 'Rewrote';
        $this->info("{$verb} {$replaced} occurrence(s) across {$changed} file(s) ({$untouched} unchanged).");
        $this->line("  from: {$from}");
        $this->line("    to: {$to}");

        return 0;
    }

    private function findHtmlFiles(string $base): array
    {
        $files = [];
        $iter  = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iter as $info) {
            if ($info->isFile() && strtolower($info->getExtension()) === 'html') {
                $files[] = $info->getPathname();
            }
        }

        sort($files);
        return $files;
    }

    private function relative(string $file, string $base): string
    {
        $base = rtrim($base, '/') . '/';
        return str_starts_with($file, $base) ? substr($file, strlen($base)) : $file;
    }
}
