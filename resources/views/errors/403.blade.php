@include('vela::errors._shell', [
    'code'    => '403',
    'title'   => __('Forbidden'),
    'message' => __("You don't have permission to access this resource."),
])
