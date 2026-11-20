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

    // Determine target endpoint (supports register.php on shared hosting or /api/register on Node)
    const endpoint = window.location.protocol === 'file:' ? null : (window.location.pathname.endsWith('.html') || window.location.pathname.endsWith('/') ? 'register.php' : '/api/register');

    if (!endpoint) {
      // Direct local file viewing
      window.location.href = 'https://stgeorgesheight.com/product/sunrise-run-walk-ticket/';
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'Failed to submit registration. Please try again.');
      }
      window.location.href = result.redirect || 'https://stgeorgesheight.com/product/sunrise-run-walk-ticket/';
    } catch (err) {
      // If server endpoint isn't present or network fails, fall back to direct redirect
      console.warn('Endpoint error, redirecting directly:', err);
      window.location.href = 'https://stgeorgesheight.com/product/sunrise-run-walk-ticket/';
    }
  });
});
