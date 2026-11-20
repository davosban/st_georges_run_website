<?php
// Prevent directory listings and serve index.html directly
if (file_exists(__DIR__ . '/index.html')) {
    include __DIR__ . '/index.html';
    exit;
}
?>
