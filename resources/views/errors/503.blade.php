@include('vela::errors._shell', [
    'code'    => '503',
    'title'   => __('Temporarily unavailable'),
    'message' => __("We're performing some maintenance. The site will be back shortly."),
    'hint'    => __('If this persists, please try again in a few minutes.'),
])
