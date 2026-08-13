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

document.getElementById('bookingForm').addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('bookingMsg').textContent =
    'Thanks — your demo booking request has been recorded. Live booking/email delivery will be connected next.';
  e.target.reset();
});

document.getElementById('aiHelp').addEventListener('click', () => {
  document.getElementById('aiBox').classList.toggle('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
