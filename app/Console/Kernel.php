<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        $schedule->command('vela:queue-work')->everyMinute();

        $schedule->command('vela:process-images')
            ->everyThirtyMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        $schedule->command('vela:find-translations')
            ->hourly()
            ->withoutOverlapping()
            ->runInBackground();

        $schedule->command('vela:generate-category-images')
            ->hourly()
            ->withoutOverlapping()
            ->runInBackground();
    }

    protected function commands(): void
    {
        // App-level commands (e.g. vela:static-rewrite-urls)
        $this->load(__DIR__.'/Commands');

        // Package commands are registered by VelaServiceProvider
        require base_path('routes/console.php');
    }
}
