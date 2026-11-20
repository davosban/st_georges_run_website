'use strict';
const $ = (s, root = document) => root.querySelector(s);
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
    const buttonText = button.textContent;
    button.disabled = true;
    button.textContent = 'Submitting your registration…';

    const data = {
      ticket: 'general',
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
      agree: form.elements.namedItem('agree')?.checked || false,
      photoConsent: form.elements.namedItem('photoConsent')?.checked || false,
      marketing: form.elements.namedItem('marketing')?.checked || false
    };

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.redirect) {
        showMessage(msg, result.error || 'Registration could not be submitted. Please try again.');
        button.disabled = false;
        button.textContent = buttonText;
        return;
      }
      button.textContent = 'Opening the payment page…';
      window.location.assign(result.redirect);
    } catch {
      showMessage(msg, 'Registration could not be submitted. Please try again.');
      button.disabled = false;
      button.textContent = buttonText;
    }
  });
});
