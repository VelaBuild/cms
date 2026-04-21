@include('vela::errors._shell', [
    'code'    => '500',
    'title'   => __('Something went wrong'),
    'message' => __('An unexpected error occurred while handling your request.'),
    'hint'    => __('Our team has been notified. Please try again in a few moments.'),
])
