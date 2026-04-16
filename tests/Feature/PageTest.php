<?php

namespace Tests\Feature;

use App\Models\FormSubmission;
use App\Models\Page;
use App\Models\PageBlock;
use App\Models\PageRow;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Tests\TestCase;

class PageTest extends TestCase
{
    private ?User $adminUser = null;
    private ?User $regularUser = null;
    private array $createdPageIds = [];
    private array $createdSubmissionIds = [];
    private array $createdUserIds = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->adminUser = User::whereHas('roles', fn ($q) => $q->where('roles.id', 1))->first();
    }

    protected function tearDown(): void
    {
        Page::whereIn('id', $this->createdPageIds)->forceDelete();
        FormSubmission::whereIn('id', $this->createdSubmissionIds)->forceDelete();
        User::whereIn('id', $this->createdUserIds)->forceDelete();
        parent::tearDown();
    }

    private function createTestPage(array $overrides = []): Page
    {
        $page = Page::create(array_merge([
            'title'  => 'Test Page ' . uniqid(),
            'slug'   => 'test-page-' . uniqid(),
            'locale' => 'en',
            'status' => 'published',
        ], $overrides));
        $this->createdPageIds[] = $page->id;
        return $page;
    }

    private function createTestPageWithContactForm(): array
    {
        $page = $this->createTestPage();
        $row  = PageRow::create([
            'page_id'      => $page->id,
            'name'         => 'Row 1',
            'order_column' => 0,
        ]);
        $block = PageBlock::create([
            'page_row_id'  => $row->id,
            'column_index' => 0,
            'column_width' => 12,
            'order_column' => 0,
            'type'         => 'contact_form',
            'content'      => [],
            'settings'     => [
                'fields' => [
                    'name'    => ['enabled' => true, 'required' => true],
                    'email'   => ['enabled' => true, 'required' => true],
                    'phone'   => ['enabled' => false, 'required' => false],
                    'subject' => ['enabled' => false, 'required' => false],
                    'message' => ['enabled' => true, 'required' => true],
                ],
                'submit_label'    => 'Send',
                'success_message' => 'Thanks!',
            ],
        ]);
        return [$page, $row, $block];
    }

    private function createTestSubmission(Page $page): FormSubmission
    {
        $submission = FormSubmission::create([
            'page_id'    => $page->id,
            'block_id'   => null,
            'data'       => ['name' => 'Test User', 'email' => 'test@example.com', 'message' => 'Hello'],
            'ip_address' => '127.0.0.1',
            'user_agent' => 'Test Agent',
            'is_read'    => false,
        ]);
        $this->createdSubmissionIds[] = $submission->id;
        return $submission;
    }

    private function createRegularUser(): User
    {
        $uid  = uniqid();
        $user = User::create([
            'name'              => 'Test User ' . $uid,
            'email'             => 'testuser_' . $uid . '@example.com',
            'password'          => bcrypt('password'),
            'email_verified_at' => now(),
        ]);
        // Assign User role (id=2) which has no page_access permission
        $user->roles()->attach(2);
        $this->createdUserIds[] = $user->id;
        return $user;
    }

    // -------------------------------------------------------------------------
    // Admin CRUD Tests
    // -------------------------------------------------------------------------

    public function test_admin_can_access_pages_index(): void
    {
        $response = $this->actingAs($this->adminUser)->get('/admin/pages');
        $response->assertStatus(200);
        $response->assertViewIs('admin.pages.index');
    }

    public function test_admin_can_access_page_create_form(): void
    {
        $response = $this->actingAs($this->adminUser)->get('/admin/pages/create');
        $response->assertStatus(200);
    }

    public function test_admin_can_store_page(): void
    {
        $slug = 'test-store-' . uniqid();
        $rows = json_encode([[
            'name'      => 'Row 1',
            'css_class' => '',
            'order'     => 0,
            'blocks'    => [[
                'column_index' => 0,
                'column_width' => 12,
                'order'        => 0,
                'type'         => 'text',
                'content'      => ['blocks' => [['type' => 'paragraph', 'data' => ['text' => 'Hello']]]],
                'settings'     => [],
            ]],
        ]]);

        $response = $this->actingAs($this->adminUser)->post('/admin/pages', [
            'title'  => 'Test Store Page',
            'slug'   => $slug,
            'locale' => 'en',
            'status' => 'draft',
            'rows'   => $rows,
        ]);

        $response->assertRedirect(route('admin.pages.index'));

        $page = Page::where('slug', $slug)->where('locale', 'en')->first();
        $this->assertNotNull($page, 'Page was not created in DB');
        $this->assertEquals('Test Store Page', $page->title);
        $this->assertEquals(1, $page->rows()->count());
        $this->assertEquals(1, $page->rows()->first()->blocks()->count());

        $this->createdPageIds[] = $page->id;
    }

    public function test_admin_can_update_page(): void
    {
        $page = $this->createTestPage(['status' => 'draft']);

        $response = $this->actingAs($this->adminUser)->put('/admin/pages/' . $page->id, [
            'title'  => 'Updated Title',
            'slug'   => $page->slug,
            'locale' => 'en',
            'status' => 'published',
            'rows'   => '[]',
        ]);

        $response->assertRedirect(route('admin.pages.index'));
        $this->assertEquals('Updated Title', $page->fresh()->title);
        $this->assertEquals('published', $page->fresh()->status);
    }

    public function test_admin_can_delete_page(): void
    {
        $page = $this->createTestPage();

        $response = $this->actingAs($this->adminUser)->delete('/admin/pages/' . $page->id);
        $response->assertRedirect();

        $this->assertNotNull(Page::withTrashed()->find($page->id)->deleted_at);
    }

    public function test_slug_uniqueness_per_locale(): void
    {
        $uid  = uniqid();
        $slug = 'test-unique-' . $uid;
        $this->createTestPage(['slug' => $slug, 'locale' => 'en']);

        $response = $this->actingAs($this->adminUser)->post('/admin/pages', [
            'title'  => 'Duplicate',
            'slug'   => $slug,
            'locale' => 'en',
            'status' => 'draft',
        ]);

        $response->assertSessionHasErrors('slug');
    }

    public function test_same_slug_different_locale_allowed(): void
    {
        $uid  = uniqid();
        $slug = 'about-' . $uid;
        $this->createTestPage(['slug' => $slug, 'locale' => 'en']);

        $response = $this->actingAs($this->adminUser)->post('/admin/pages', [
            'title'  => 'About FR',
            'slug'   => $slug,
            'locale' => 'fr',
            'status' => 'draft',
            'rows'   => '[]',
        ]);

        $response->assertRedirect(route('admin.pages.index'));

        $frPage = Page::where('slug', $slug)->where('locale', 'fr')->first();
        $this->assertNotNull($frPage);
        $this->createdPageIds[] = $frPage->id;
    }

    public function test_reserved_slugs_rejected(): void
    {
        $response = $this->actingAs($this->adminUser)->post('/admin/pages', [
            'title'  => 'Posts Page',
            'slug'   => 'posts',
            'locale' => 'en',
            'status' => 'draft',
        ]);

        $response->assertSessionHasErrors('slug');
    }

    public function test_unauthorized_user_cannot_access_pages(): void
    {
        $user = $this->createRegularUser();

        $response = $this->actingAs($user)->get('/admin/pages');
        $response->assertStatus(403);
    }

    public function test_page_mass_destroy(): void
    {
        $page1 = $this->createTestPage();
        $page2 = $this->createTestPage();

        $response = $this->actingAs($this->adminUser)->delete('/admin/pages/destroy', [
            'ids' => [$page1->id, $page2->id],
        ]);

        $response->assertStatus(204);
        $this->assertNotNull(Page::withTrashed()->find($page1->id)->deleted_at);
        $this->assertNotNull(Page::withTrashed()->find($page2->id)->deleted_at);
    }

    // -------------------------------------------------------------------------
    // Public Page Tests
    // -------------------------------------------------------------------------

    public function test_published_page_renders(): void
    {
        $page = $this->createTestPage(['status' => 'published']);
        $row  = PageRow::create(['page_id' => $page->id, 'name' => 'Row', 'order_column' => 0]);
        PageBlock::create([
            'page_row_id'  => $row->id,
            'column_index' => 0,
            'column_width' => 12,
            'order_column' => 0,
            'type'         => 'text',
            'content'      => ['blocks' => [['type' => 'paragraph', 'data' => ['text' => 'Hello World']]]],
            'settings'     => [],
        ]);

        $response = $this->get('/' . $page->slug);
        $response->assertStatus(200);
    }

    public function test_draft_page_returns_404(): void
    {
        $page     = $this->createTestPage(['status' => 'draft']);
        $response = $this->get('/' . $page->slug);
        $response->assertStatus(404);
    }

    public function test_unlisted_page_renders(): void
    {
        $page     = $this->createTestPage(['status' => 'unlisted']);
        $response = $this->get('/' . $page->slug);
        $response->assertStatus(200);
    }

    public function test_nonexistent_slug_returns_404(): void
    {
        $response = $this->get('/this-page-does-not-exist-ever-xyz');
        $response->assertStatus(404);
    }

    public function test_existing_routes_still_work(): void
    {
        // Posts and categories routes should not be intercepted by the page catch-all
        $this->get('/posts')->assertStatus(200);
        $this->get('/categories')->assertStatus(200);
    }

    // -------------------------------------------------------------------------
    // Contact Form Tests
    // -------------------------------------------------------------------------

    public function test_contact_form_submission_saved(): void
    {
        [$page, $row, $block] = $this->createTestPageWithContactForm();

        $response = $this->post('/page-form/' . $page->id, [
            'block_id' => $block->id,
            'name'     => 'John Doe',
            'email'    => 'john@example.com',
            'message'  => 'Hello, I have a question.',
        ]);

        $response->assertRedirect();

        $submission = FormSubmission::where('page_id', $page->id)->latest()->first();
        $this->assertNotNull($submission);
        $this->assertEquals('John Doe', $submission->data['name']);
        $this->assertEquals('john@example.com', $submission->data['email']);
        $this->createdSubmissionIds[] = $submission->id;
    }

    public function test_honeypot_rejects_bots(): void
    {
        [$page, $row, $block] = $this->createTestPageWithContactForm();

        $response = $this->post('/page-form/' . $page->id, [
            'block_id'    => $block->id,
            'name'        => 'Spammer',
            'email'       => 'spam@example.com',
            'message'     => 'Buy now!',
            'website_url' => 'http://spam.com',
        ]);

        $response->assertStatus(422);
    }

    public function test_contact_form_validates_required_fields(): void
    {
        [$page, $row, $block] = $this->createTestPageWithContactForm();

        $response = $this->post('/page-form/' . $page->id, [
            'block_id' => $block->id,
            'name'     => 'John Doe',
            'email'    => '', // required but empty
            'message'  => 'Hello',
        ]);

        $response->assertSessionHasErrors('email');
    }

    // -------------------------------------------------------------------------
    // Form Submission Admin Tests
    // -------------------------------------------------------------------------

    public function test_admin_can_view_submissions_index(): void
    {
        $page       = $this->createTestPage();
        $submission = $this->createTestSubmission($page);

        $response = $this->actingAs($this->adminUser)->get('/admin/form-submissions');
        $response->assertStatus(200);
    }

    public function test_admin_can_view_single_submission(): void
    {
        $page       = $this->createTestPage();
        $submission = $this->createTestSubmission($page);

        $response = $this->actingAs($this->adminUser)->get('/admin/form-submissions/' . $submission->id);
        $response->assertStatus(200);

        $this->assertTrue($submission->fresh()->is_read);
    }

    public function test_admin_can_delete_submission(): void
    {
        $page       = $this->createTestPage();
        $submission = $this->createTestSubmission($page);

        $response = $this->actingAs($this->adminUser)->delete('/admin/form-submissions/' . $submission->id);
        $response->assertRedirect();

        $this->assertNull(FormSubmission::find($submission->id));
        // Remove from cleanup since it's already deleted
        $this->createdSubmissionIds = array_filter(
            $this->createdSubmissionIds,
            fn ($id) => $id !== $submission->id
        );
    }
}
