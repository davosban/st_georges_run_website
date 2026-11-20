<?php
/**
 * St. George's Sunrise Run & Walk - Form Submission Handler for Shared Hosting (PHP)
 * Compatible with cPanel / Namecheap / Apache / LiteSpeed
 */
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid submission data']);
    exit;
}

$fullName       = trim($data['fullName'] ?? '');
$email          = trim($data['email'] ?? '');
$phone          = trim($data['phone'] ?? '');
$distance       = trim($data['distance'] ?? '5 km');
$ageGroup       = trim($data['ageGroup'] ?? 'adult');
$emergencyName  = trim($data['emergencyName'] ?? '');
$emergencyPhone = trim($data['emergencyPhone'] ?? '');
$guardianName   = trim($data['guardianName'] ?? '');
$guardianPhone  = trim($data['guardianPhone'] ?? '');
$medicalConsent = !empty($data['medicalConsent']);
$waiverAccepted = !empty($data['waiverAccepted']);
$photoConsent   = !empty($data['photoConsent']);
$marketing      = !empty($data['marketing']);

if (strlen($fullName) < 3 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($phone) < 8) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Please provide full name, valid email address and contact phone number.']);
    exit;
}

if (!$waiverAccepted || !$medicalConsent) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Please read and accept the health declaration and participation waiver.']);
    exit;
}

$code = 'SG-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 6));

// Email notification
$to = 'bookings@stgeorgesheight.com';
$from = 'webmaster@stgeorgesheight.com';
$subject = "[New Registration] {$code} - {$fullName} ({$distance})";

$message = "A new registration has been received for the St. George's Sunrise Run & Walk:\n\n";
$message .= "Registration Code: {$code}\n";
$message .= "Participant Name: {$fullName}\n";
$message .= "Email: {$email}\n";
$message .= "Phone: {$phone}\n";
$message .= "Route: {$distance}\n";
$message .= "Age Group: {$ageGroup}\n";
$message .= "Emergency Contact: {$emergencyName} ({$emergencyPhone})\n";
if ($ageGroup === 'under18') {
    $message .= "Parent/Guardian: {$guardianName} ({$guardianPhone})\n";
}
$message .= "Medical First Aid Consent: " . ($medicalConsent ? "Yes" : "No") . "\n";
$message .= "Waiver Accepted: " . ($waiverAccepted ? "Yes" : "No") . "\n";
$message .= "Photo Consent: " . ($photoConsent ? "Yes" : "No") . "\n";
$message .= "Marketing Consent: " . ($marketing ? "Yes" : "No") . "\n";
$message .= "Date: " . date('Y-m-d H:i:s') . "\n";

$headers  = "From: St. George's Sunrise Run <{$from}>\r\n";
$headers .= "Reply-To: {$email}\r\n";
$headers .= "X-Mailer: PHP/" . phpversion();

@mail($to, $subject, $message, $headers);

// Also send confirmation to participant
$pSubject = "Registration Confirmation - St. George's Sunrise Run & Walk ({$code})";
$pMessage = "Hello {$fullName},\n\n";
$pMessage .= "Thank you for registering for the St. George's Sunrise Run & Walk (The Doboro Edition)!\n\n";
$pMessage .= "Your Registration Code is: {$code}\n";
$pMessage .= "Selected Route: {$distance}\n\n";
$pMessage .= "To complete your ticket purchase, please proceed here:\n";
$pMessage .= "https://stgeorgesheight.com/product/sunrise-run-walk-ticket/\n\n";
$pMessage .= "If you have any questions, feel free to reply to this email or reach us at bookings@stgeorgesheight.com.\n\n";
$pMessage .= "Warm regards,\nSt. George's Heights";

$pHeaders  = "From: St. George's Heights <{$from}>\r\n";
$pHeaders .= "Reply-To: bookings@stgeorgesheight.com\r\n";
$pHeaders .= "X-Mailer: PHP/" . phpversion();

@mail($email, $pSubject, $pMessage, $pHeaders);

echo json_encode([
    'ok' => true,
    'code' => $code,
    'redirect' => 'https://stgeorgesheight.com/product/sunrise-run-walk-ticket/'
]);
