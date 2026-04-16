<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run()
    {
        $this->call(\VelaBuild\Core\Database\Seeders\VelaDatabaseSeeder::class);
    }
}
