<?php
/**
 * St. George's Sunrise Run & Walk - Form Submission & Email Dispatcher
 * Compatible with all shared hosting (cPanel, LiteSpeed, Apache, Nginx + PHP)
 */
header('X-Content-Type-Options: nosniff');

function sendSmtpMail($to, $subject, $body, $replyTo = null) {
    $host = 'ssl://host9.registrar-servers.com';
    $port = 465;
    $user = 'webmaster@stgeorgesheight.com';
    $pass = 'WCy,D9xjpE^Rw)xW';
    $from = 'webmaster@stgeorgesheight.com';

    $context = stream_context_create([
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
            'allow_self_signed' => true
        ]
    ]);

    $socket = @stream_socket_client($host . ':' . $port, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $context);
    if (!$socket) {
        // Fallback to PHP mail()
        $headers  = "From: St. George's Sunrise Run <{$from}>\r\n";
        if ($replyTo) $headers .= "Reply-To: {$replyTo}\r\n";
        $headers .= "MIME-Version: 1.0\r\n";
        $headers .= "Content-Type: text/plain; charset=utf-8\r\n";
        $headers .= "X-Mailer: PHP/" . phpversion();
        return @mail($to, $subject, $body, $headers);
    }

    $read = function() use ($socket) {
        $data = '';
        while ($line = fgets($socket, 512)) {
            $data .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $data;
    };

    $read();
    fputs($socket, "EHLO " . ($_SERVER['SERVER_NAME'] ?? 'stgeorgesheight.com') . "\r\n");
    $read();
    fputs($socket, "AUTH LOGIN\r\n");
    $read();
    fputs($socket, base64_encode($user) . "\r\n");
    $read();
    fputs($socket, base64_encode($pass) . "\r\n");
    $authResp = $read();

    if (substr($authResp, 0, 3) !== '235') {
        fclose($socket);
        // Fallback to mail()
        $headers  = "From: St. George's Sunrise Run <{$from}>\r\n";
        if ($replyTo) $headers .= "Reply-To: {$replyTo}\r\n";
        $headers .= "MIME-Version: 1.0\r\n";
        $headers .= "Content-Type: text/plain; charset=utf-8\r\n";
        return @mail($to, $subject, $body, $headers);
    }

    fputs($socket, "MAIL FROM:<{$user}>\r\n");
    $read();
    fputs($socket, "RCPT TO:<{$to}>\r\n");
    $read();
    fputs($socket, "DATA\r\n");
    $read();

    $headers  = "From: \"St. George's Sunrise Run & Walk\" <{$user}>\r\n";
    $headers .= "To: {$to}\r\n";
    if ($replyTo) $headers .= "Reply-To: {$replyTo}\r\n";
    $headers .= "Subject: =?UTF-8?B?" . base64_encode($subject) . "?=\r\n";
    $headers .= "Date: " . date(DATE_RFC2822) . "\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/plain; charset=utf-8\r\n";
    $headers .= "Content-Transfer-Encoding: 8bit\r\n\r\n";

    fputs($socket, $headers . $body . "\r\n.\r\n");
    $read();
    fputs($socket, "QUIT\r\n");
    fclose($socket);
    return true;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: text/plain');
    echo 'Method not allowed';
    exit;
}

$raw = file_get_contents('php://input');
$isJson = false;
$data = [];

if (!empty($raw)) {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        $data = $decoded;
        $isJson = true;
    }
}

if (empty($data) && !empty($_POST)) {
    $data = $_POST;
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
    if ($isJson) {
        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'Please provide your full name, valid email address and contact phone number.']);
    } else {
        echo "<script>alert('Please provide your full name, valid email address and contact phone number.'); history.back();</script>";
    }
    exit;
}

if (!$waiverAccepted || !$medicalConsent) {
    if ($isJson) {
        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'Please read and accept the health declaration and participation waiver.']);
    } else {
        echo "<script>alert('Please read and accept the health declaration and participation waiver.'); history.back();</script>";
    }
    exit;
}

$code = 'SG-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 6));

// 1. Dispatch email to bookings@stgeorgesheight.com
$adminSubject = "[New Registration] {$code} - {$fullName} ({$distance})";
$adminBody = "A new registration has been received for the St. George's Sunrise Run & Walk:\n\n";
$adminBody .= "Registration Code: {$code}\n";
$adminBody .= "Participant Name: {$fullName}\n";
$adminBody .= "Email: {$email}\n";
$adminBody .= "Phone: {$phone}\n";
$adminBody .= "Route: {$distance}\n";
$adminBody .= "Age Group: {$ageGroup}\n";
$adminBody .= "Emergency Contact: {$emergencyName} ({$emergencyPhone})\n";
if ($ageGroup === 'under18') {
    $adminBody .= "Parent/Guardian: {$guardianName} ({$guardianPhone})\n";
}
$adminBody .= "Medical First Aid Consent: " . ($medicalConsent ? "Yes" : "No") . "\n";
$adminBody .= "Waiver Accepted: " . ($waiverAccepted ? "Yes" : "No") . "\n";
$adminBody .= "Photo Consent: " . ($photoConsent ? "Yes" : "No") . "\n";
$adminBody .= "Marketing Consent: " . ($marketing ? "Yes" : "No") . "\n";
$adminBody .= "Submitted: " . date('Y-m-d H:i:s') . "\n";

sendSmtpMail('bookings@stgeorgesheight.com', $adminSubject, $adminBody, $email);

// 2. Dispatch confirmation to participant
$pSubject = "Registration Confirmation - St. George's Sunrise Run & Walk ({$code})";
$pBody = "Hello {$fullName},\n\n";
$pBody .= "Thank you for registering for the St. George's Sunrise Run & Walk (The Doboro Edition)!\n\n";
$pBody .= "Your Registration Code is: {$code}\n";
$pBody .= "Selected Route: {$distance}\n\n";
$pBody .= "To complete your ticket purchase, please proceed here:\n";
$pBody .= "https://stgeorgesheight.com/product/sunrise-run-walk-ticket/\n\n";
$pBody .= "If you have any questions, feel free to reply directly to this email or reach our organising team at bookings@stgeorgesheight.com.\n\n";
$pBody .= "Warm regards,\nSt. George's Heights";

sendSmtpMail($email, $pSubject, $pBody, 'bookings@stgeorgesheight.com');

// 3. Response / Redirect
$ticketUrl = 'https://stgeorgesheight.com/product/sunrise-run-walk-ticket/';

if ($isJson) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => true,
        'code' => $code,
        'redirect' => $ticketUrl
    ]);
} else {
    header("Location: {$ticketUrl}");
}
exit;
