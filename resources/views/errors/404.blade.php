@include('vela::errors._shell', [
    'code'    => '404',
    'title'   => __('Page not found'),
    'message' => __("The page you're looking for doesn't exist, has moved, or is no longer available."),
])
