<?php

namespace Tests\Feature\Commands;

use Illuminate\Support\Facades\File;
use Tests\TestCase;
use VelaBuild\Core\Contracts\AiImageProvider;
use VelaBuild\Core\Services\AiProviderManager;

class SetupGraphicsTest extends TestCase
{
    private string $logoPath;

    private string $heroPath;

    private string $logoBackupPath;

    private string $heroBackupPath;

    private ?string $originalLogoContent = null;

    private ?string $originalHeroContent = null;

    protected function setUp(): void
    {
        parent::setUp();

        $this->logoPath = public_path('images/logo.png');
        $this->heroPath = public_path('images/hero.png');
        $this->logoBackupPath = public_path('images/logo.backup.png');
        $this->heroBackupPath = public_path('images/hero.backup.png');

        // Store original contents if they exist
        if (File::exists($this->logoPath)) {
            $this->originalLogoContent = File::get($this->logoPath);
        }
        if (File::exists($this->heroPath)) {
            $this->originalHeroContent = File::get($this->heroPath);
        }
    }

    protected function tearDown(): void
    {
        // Restore original files or delete if they were created by tests
        if ($this->originalLogoContent !== null) {
            File::put($this->logoPath, $this->originalLogoContent);
        } else {
            File::delete($this->logoPath);
        }

        if ($this->originalHeroContent !== null) {
            File::put($this->heroPath, $this->originalHeroContent);
        } else {
            File::delete($this->heroPath);
        }

        // Delete any backup or temporary files
        File::delete($this->logoBackupPath);
        File::delete($this->heroBackupPath);
        File::delete($this->logoPath . '.tmp');
        File::delete($this->heroPath . '.tmp');

        parent::tearDown();
    }

    private function mockManagerWithNoProvider(): void
    {
        $manager = $this->mock(AiProviderManager::class);
        $manager->shouldReceive('hasImageProvider')->andReturn(false);
    }

    private function mockManagerWithProvider(AiImageProvider $imageProvider): void
    {
        $manager = $this->mock(AiProviderManager::class);
        $manager->shouldReceive('hasImageProvider')->andReturn(true);
        $manager->shouldReceive('resolveImageProvider')->andReturn($imageProvider);
    }

    private function createMockImageProvider(): \Mockery\MockInterface
    {
        return \Mockery::mock(AiImageProvider::class);
    }

    public function test_command_fails_without_api_key(): void
    {
        $this->mockManagerWithNoProvider();

        $this->artisan('vela:setup-graphics')
            ->assertExitCode(1)
            ->expectsOutputToContain('GEMINI_API_KEY');
    }

    public function test_dry_run_does_not_generate_images(): void
    {
        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldNotReceive('generateImage');
        $this->mockManagerWithProvider($imageProvider);

        $this->artisan('vela:setup-graphics --dry-run --force')
            ->expectsOutputToContain('Dry run')
            ->assertExitCode(0);
    }

    public function test_refuses_without_force_when_files_exist(): void
    {
        File::put($this->logoPath, 'original-logo');
        File::put($this->heroPath, 'original-hero');

        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldNotReceive('generateImage');
        $this->mockManagerWithProvider($imageProvider);

        $this->artisan('vela:setup-graphics')
            ->expectsOutputToContain('logo.png already exists. Use --force to overwrite.')
            ->expectsOutputToContain('hero.png already exists. Use --force to overwrite.')
            ->assertExitCode(0);

        $this->assertEquals('original-logo', File::get($this->logoPath));
        $this->assertEquals('original-hero', File::get($this->heroPath));
    }

    public function test_generates_images_with_force(): void
    {
        File::put($this->logoPath, 'old-logo-data');
        File::put($this->heroPath, 'old-hero-data');

        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldReceive('generateImage')
            ->twice()
            ->andReturnUsing(function ($prompt, $options) {
                $aspectRatio = $options['aspect_ratio'] ?? '1:1';
                if ($aspectRatio === '1:1') {
                    return ['data' => [['b64_json' => base64_encode('fake-logo-data')]]];
                }

                return ['data' => [['b64_json' => base64_encode('fake-hero-data')]]];
            });
        $this->mockManagerWithProvider($imageProvider);

        $this->artisan('vela:setup-graphics --force')
            ->assertExitCode(0)
            ->expectsOutputToContain('logo image saved: images/logo.png')
            ->expectsOutputToContain('hero image saved: images/hero.png');

        $this->assertTrue(File::exists($this->logoPath));
        $this->assertTrue(File::exists($this->heroPath));
        $this->assertEquals('fake-logo-data', File::get($this->logoPath));
        $this->assertEquals('fake-hero-data', File::get($this->heroPath));
    }

    public function test_only_logo_generates_single_image(): void
    {
        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldReceive('generateImage')
            ->once()
            ->andReturn(['data' => [['b64_json' => base64_encode('only-logo-data')]]]);
        $this->mockManagerWithProvider($imageProvider);

        File::delete($this->heroPath);

        $this->artisan('vela:setup-graphics --only=logo --force')
            ->assertExitCode(0)
            ->expectsOutputToContain('logo image saved: images/logo.png')
            ->doesntExpectOutputToContain('hero image saved');

        $this->assertTrue(File::exists($this->logoPath));
        $this->assertEquals('only-logo-data', File::get($this->logoPath));
        $this->assertFalse(File::exists($this->heroPath));
    }

    public function test_only_hero_generates_single_image(): void
    {
        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldReceive('generateImage')
            ->once()
            ->andReturn(['data' => [['b64_json' => base64_encode('only-hero-data')]]]);
        $this->mockManagerWithProvider($imageProvider);

        File::delete($this->logoPath);

        $this->artisan('vela:setup-graphics --only=hero --force')
            ->assertExitCode(0)
            ->expectsOutputToContain('hero image saved: images/hero.png')
            ->doesntExpectOutputToContain('logo image saved');

        $this->assertTrue(File::exists($this->heroPath));
        $this->assertEquals('only-hero-data', File::get($this->heroPath));
        $this->assertFalse(File::exists($this->logoPath));
    }

    public function test_invalid_only_option_fails(): void
    {
        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldNotReceive('generateImage');
        $this->mockManagerWithProvider($imageProvider);

        $this->artisan('vela:setup-graphics --only=invalid')
            ->assertExitCode(1)
            ->expectsOutputToContain('Invalid --only value');
    }

    public function test_backup_created_when_force_overwrites(): void
    {
        File::put($this->logoPath, 'original-content-for-backup');

        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldReceive('generateImage')
            ->once()
            ->andReturn(['data' => [['b64_json' => base64_encode('new-logo-content')]]]);
        $this->mockManagerWithProvider($imageProvider);

        $this->artisan('vela:setup-graphics --only=logo --force')
            ->assertExitCode(0)
            ->expectsOutputToContain('Backed up existing file to logo.backup.png')
            ->expectsOutputToContain('logo image saved');

        $this->assertTrue(File::exists($this->logoBackupPath));
        $this->assertEquals('original-content-for-backup', File::get($this->logoBackupPath));
        $this->assertEquals('new-logo-content', File::get($this->logoPath));
    }

    public function test_command_fails_if_images_directory_not_writable(): void
    {
        $imageProvider = $this->createMockImageProvider();
        $this->mockManagerWithProvider($imageProvider);

        $imagesPath = public_path('images');
        chmod($imagesPath, 0444);

        try {
            $this->artisan('vela:setup-graphics')
                ->assertExitCode(1)
                ->expectsOutputToContain("Directory is not writable: {$imagesPath}");
        } finally {
            chmod($imagesPath, 0755);
        }
    }

    public function test_command_returns_1_on_api_failure(): void
    {
        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldReceive('generateImage')
            ->once()
            ->andReturn(null);
        $this->mockManagerWithProvider($imageProvider);

        $this->artisan('vela:setup-graphics --only=logo --force')
            ->assertExitCode(1)
            ->expectsOutputToContain('Failed to generate logo image');
    }

    public function test_command_returns_1_on_base64_decode_failure(): void
    {
        $imageProvider = $this->createMockImageProvider();
        $imageProvider->shouldReceive('generateImage')
            ->once()
            ->andReturn(['data' => [['b64_json' => '']]]);
        $this->mockManagerWithProvider($imageProvider);

        $this->artisan('vela:setup-graphics --only=logo --force')
            ->assertExitCode(1)
            ->expectsOutputToContain('Failed to generate logo image');
    }
}
