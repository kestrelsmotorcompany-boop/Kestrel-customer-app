const panels = document.querySelectorAll('.panel');

function openPanel(id) {
  panels.forEach(p => p.classList.remove('show'));
  const panel = document.getElementById(id);
  if (panel) panel.classList.add('show');
}

document.querySelectorAll('[data-panel]').forEach(el => {
  el.addEventListener('click', () => openPanel(el.dataset.panel));
});

document.querySelectorAll('.close').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.panel').classList.remove('show'));
});

let activeVehicle = null;

document.getElementById('bookingForm').addEventListener('submit', e => {
  e.preventDefault();
  if (!activeVehicle) {
    document.getElementById('bookingMsg').textContent = 'Please refresh the page and try again.';
    return;
  }
  const type = document.getElementById('bookingType').value;
  const date = document.getElementById('bookingDate').value;
  const notes = document.getElementById('bookingNotes').value.trim();
  const message = `Hi Kestrels, I'd like to request a ${type} booking for my ${activeVehicle.make}, registration ${activeVehicle.registration}. Preferred date: ${date}.${notes ? ` Notes: ${notes}` : ''}`;
  window.open(`https://wa.me/447939249588?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  document.getElementById('bookingMsg').textContent = 'Your booking request is ready to send in WhatsApp.';
});

document.getElementById('aiHelp').addEventListener('click', () => {
  document.getElementById('aiBox').classList.toggle('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}


const params = new URLSearchParams(window.location.search);
const customerId = params.get('customer') || 'demo-001';

function showCustomer(customer) {
  const vehicle = customer.vehicle;
  activeVehicle = vehicle;
  const whatsappLinks = document.querySelectorAll('a[href*="wa.me/"]');
  const vehicleName = vehicle.make;
  const registration = vehicle.registration;

  const whatsappMessages = [
    `Hi Kestrels, I'd like to book my ${vehicleName}, registration ${registration}, in for a service, MOT or repair.`,
    `Hi Kestrels, I need some help with my ${vehicleName}, registration ${registration}.`,
    `Hi Kestrels, I'd like to arrange a service or MOT for my ${vehicleName}, registration ${registration}.`
  ];

  whatsappLinks.forEach((link, index) => {
    if (whatsappMessages[index]) {
      link.href = `https://wa.me/447939249588?text=${encodeURIComponent(whatsappMessages[index])}`;
    }
  });

  document.querySelector('.car-card h2').textContent = vehicle.make;
  document.querySelector('.car-card .reg').textContent = vehicle.registration;

  const stats = document.querySelectorAll('.car-card .stats strong');
  if (stats[0]) stats[0].textContent = vehicle.motDue;
  if (stats[1]) stats[1].textContent = vehicle.serviceDue;

  const reminders = document.querySelectorAll('#service .reminder span');
  if (reminders[0]) reminders[0].textContent = vehicle.motDue;
  if (reminders[1]) reminders[1].textContent = vehicle.serviceDue;

  const info = document.querySelectorAll('#vehicle .info-list strong');
  if (info[0]) info[0].textContent = vehicle.registration;
  if (info[1]) info[1].textContent = vehicle.make;
  if (info[2]) info[2].textContent = vehicle.mileage + ' miles';
  if (info[3]) info[3].textContent = vehicle.warranty;
}
fetch('/api/customers/' + encodeURIComponent(customerId), { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error('Customer not found');
    return response.json();
  })
  .then(customer => showCustomer({
    vehicle: {
      make: customer.make,
      registration: customer.registration,
      mileage: customer.mileage,
      motDue: customer.mot_due,
      serviceDue: customer.service_due,
      warranty: customer.warranty
    }
  }))
  .catch(error => {
    console.log('Customer data error:', error);
    document.querySelector('.hero h1').textContent = 'Customer link not found';
    document.querySelector('.hero > div > p:last-child').textContent =
      'Please contact Kestrels Motor Company for a new link.';
    document.querySelector('.car-card').style.display = 'none';
    document.querySelector('.grid').style.display = 'none';
  });
