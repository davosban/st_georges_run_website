'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const showMessage = (el, message, color = '#a44130') => {
  if (!el) return;
  el.textContent = message;
  el.style.color = color;
};

document.addEventListener('DOMContentLoaded', () => {
  const form = $('#registrationForm');
  if (!form) return;

  const msg = $('#formMessage');
  const button = $('#submitBtn');
  const ageSelect = $('#ageGroup', form);
  const guardianPanel = $('#guardianFields', form);
  const guardianName = $('#guardianName', form);
  const guardianPhone = $('#guardianPhone', form);
  const guardianApproval = $('#guardianAcknowledged', form);

  function updateGuardianFields() {
    const minor = ageSelect.value === 'under18';
    if (guardianPanel) guardianPanel.hidden = !minor;
    if (guardianName) guardianName.required = minor;
    if (guardianPhone) guardianPhone.required = minor;
    if (guardianApproval) guardianApproval.required = minor;
    if (!minor) {
      if (guardianName) guardianName.value = '';
      if (guardianPhone) guardianPhone.value = '';
      if (guardianApproval) guardianApproval.checked = false;
    }
  }

  if (ageSelect) {
    ageSelect.addEventListener('change', updateGuardianFields);
    updateGuardianFields();
  }

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!form.reportValidity()) return;

    showMessage(msg, '');
    button.disabled = true;
    button.textContent = 'Submitting your registration…';

    const data = {
      ticket: 'general',
      distance: form.elements.namedItem('distance')?.value || '5 km',
      fullName: form.elements.namedItem('fullName')?.value || '',
      email: form.elements.namedItem('email')?.value || '',
      phone: form.elements.namedItem('phone')?.value || '',
      ageGroup: form.elements.namedItem('ageGroup')?.value || 'adult',
      emergencyName: form.elements.namedItem('emergencyName')?.value || '',
      emergencyPhone: form.elements.namedItem('emergencyPhone')?.value || '',
      guardianName: form.elements.namedItem('guardianName')?.value || '',
      guardianPhone: form.elements.namedItem('guardianPhone')?.value || '',
      guardianAcknowledged: form.elements.namedItem('guardianAcknowledged')?.checked || false,
      waiverAccepted: form.elements.namedItem('waiverAccepted')?.checked || false,
      medicalConsent: form.elements.namedItem('medicalConsent')?.checked || false,
      photoConsent: form.elements.namedItem('photoConsent')?.checked || false,
      marketing: form.elements.namedItem('marketing')?.checked || false
    };

    const targetUrl = 'https://stgeorgesheight.com/product/sunrise-run-walk-ticket/';

    // Local Node dev server uses /api/register; shared hosting uses register.php
    const isLocalNode = window.location.port === '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const endpoint = isLocalNode ? '/api/register' : 'register.php';

    if (window.location.protocol === 'file:') {
      window.location.href = targetUrl;
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json().catch(() => ({ ok: true, redirect: targetUrl }));
      if (response.ok && result.ok) {
        window.location.href = result.redirect || targetUrl;
      } else {
        throw new Error(result.error || 'Registration submission failed. Redirecting to ticket purchase…');
      }
    } catch (err) {
      console.warn('Dispatch note:', err);
      // Fallback: Ensure participant is never blocked from buying ticket
      window.location.href = targetUrl;
    }
  });
});
