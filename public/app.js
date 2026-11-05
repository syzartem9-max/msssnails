const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0a0a0f');
  tg.setBackgroundColor('#0a0a0f');
}

const API = window.location.origin;

let selectedSlot = null;
let currentBookingId = null;
let adminToken = localStorage.getItem('adminToken') || null;

// === Navigation ===
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    showPage(page);
  });
});

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  
  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');
  
  const navBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Reset booking flow when opening book page
  if (pageId === 'book') {
    document.getElementById('booking-form').classList.add('hidden');
    document.getElementById('payment-screen').classList.add('hidden');
    document.getElementById('success-screen').classList.add('hidden');
    document.getElementById('slots-list').parentElement.classList.remove('hidden');
    loadSlots();
  }

  if (pageId === 'admin') {
    if (adminToken) {
      showAdminPanel();
    } else {
      document.getElementById('admin-login').classList.remove('hidden');
      document.getElementById('admin-panel').classList.add('hidden');
    }
  }
}

// === Load available slots ===
async function loadSlots() {
  const container = document.getElementById('slots-list');
  container.innerHTML = '<div class="loading">Загрузка слотов...</div>';

  try {
    const res = await fetch(`${API}/api/slots`);
    const slots = await res.json();

    if (!slots.length) {
      container.innerHTML = '<div class="loading">Свободных окошек пока нет.<br>Загляните позже ✨</div>';
      return;
    }

    container.innerHTML = '';
    slots.forEach(slot => {
      const el = document.createElement('div');
      el.className = 'slot-item';
      el.dataset.id = slot.id;
      
      const dateObj = new Date(slot.date + 'T00:00:00');
      const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      const dayName = days[dateObj.getDay()];
      const formatted = `${dayName} ${slot.date.slice(8)}.${slot.date.slice(5, 7)}`;

      el.innerHTML = `
        <div>
          <div class="slot-date">${formatted}</div>
          <div class="slot-time">${slot.time}</div>
        </div>
        <div style="color: var(--success); font-size: 13px;">свободно</div>
      `;

      el.addEventListener('click', () => {
        document.querySelectorAll('.slot-item').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        selectedSlot = slot;
        document.getElementById('booking-form').classList.remove('hidden');
        document.getElementById('booking-form').scrollIntoView({ behavior: 'smooth' });
      });

      container.appendChild(el);
    });
  } catch (e) {
    container.innerHTML = '<div class="loading">Ошибка загрузки. Попробуйте позже.</div>';
  }
}

// === Submit booking ===
document.getElementById('btn-submit-booking').addEventListener('click', async () => {
  const name = document.getElementById('client-name').value.trim();
  const phone = document.getElementById('client-phone').value.trim();
  const username = document.getElementById('client-username').value.trim();
  const service = document.getElementById('client-service').value.trim();
  const comment = document.getElementById('client-comment').value.trim();

  if (!name || !phone) {
    alert('Заполните имя и телефон');
    return;
  }
  if (!selectedSlot) {
    alert('Выберите время');
    return;
  }

  const tgId = tg?.initDataUnsafe?.user?.id || null;
  const tgUsername = tg?.initDataUnsafe?.user?.username || username;

  try {
    const res = await fetch(`${API}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot_id: selectedSlot.id,
        client_name: name,
        client_username: tgUsername || username,
        client_phone: phone,
        service,
        comment,
        tg_id: tgId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Ошибка');
      return;
    }

    currentBookingId = selectedSlot.id;

    // Show payment
    document.getElementById('booking-form').classList.add('hidden');
    document.querySelector('#page-book .liquid-card').classList.add('hidden'); // slots card
    document.getElementById('payment-screen').classList.remove('hidden');

    // Load QR
    const uname = (tgUsername || username || 'username').replace('@', '');
    const qrRes = await fetch(`${API}/api/qr?username=${encodeURIComponent(uname)}`);
    const qrData = await qrRes.json();
    
    document.getElementById('qr-image').src = qrData.qr;
    document.getElementById('pay-phone').textContent = qrData.phone;
    document.getElementById('pay-name').textContent = qrData.name;

  } catch (e) {
    alert('Ошибка сети. Попробуйте ещё раз.');
  }
});

// === I paid ===
document.getElementById('btn-i-paid').addEventListener('click', async () => {
  if (!currentBookingId) return;

  try {
    await fetch(`${API}/api/paid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot_id: currentBookingId,
        tg_id: tg?.initDataUnsafe?.user?.id
      })
    });

    document.getElementById('payment-screen').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');
  } catch (e) {
    alert('Ошибка. Напишите мастеру напрямую.');
  }
});

// === Admin Login ===
document.getElementById('btn-admin-login').addEventListener('click', async () => {
  const login = document.getElementById('admin-login-input').value.trim();
  const password = document.getElementById('admin-password-input').value;

  try {
    const res = await fetch(`${API}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Ошибка входа');
      return;
    }

    adminToken = data.token;
    localStorage.setItem('adminToken', adminToken);
    showAdminPanel();
  } catch (e) {
    alert('Ошибка сети');
  }
});

function showAdminPanel() {
  document.getElementById('admin-login').classList.add('hidden');
  document.getElementById('admin-panel').classList.remove('hidden');
  loadAdminSlots();
}

// === Admin slots ===
async function loadAdminSlots() {
  const container = document.getElementById('admin-slots-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch(`${API}/api/admin/slots`, {
      headers: { 'X-Admin-Token': adminToken }
    });
    
    if (res.status === 401) {
      localStorage.removeItem('adminToken');
      adminToken = null;
      showPage('admin');
      return;
    }

    const slots = await res.json();
    container.innerHTML = '';

    if (!slots.length) {
      container.innerHTML = '<div class="loading">Слотов нет</div>';
      return;
    }

    slots.forEach(slot => {
      const el = document.createElement('div');
      el.className = 'admin-slot';

      const dateObj = new Date(slot.date + 'T00:00:00');
      const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      const dayName = days[dateObj.getDay()];
      const formatted = `${dayName} ${slot.date.slice(8)}.${slot.date.slice(5, 7)} • ${slot.time}`;

      let clientInfo = '';
      if (slot.client_name) {
        clientInfo = `
          <div class="admin-slot-info">
            👤 ${slot.client_name}<br>
            📞 ${slot.client_phone || '—'}<br>
            ${slot.client_username ? '@' + slot.client_username.replace('@','') + '<br>' : ''}
            ${slot.service ? '💅 ' + slot.service + '<br>' : ''}
            ${slot.comment ? '💬 ' + slot.comment : ''}
          </div>
        `;
      }

      el.innerHTML = `
        <div class="admin-slot-header">
          <strong>${formatted}</strong>
          <span class="admin-slot-status status-${slot.status}">${statusLabel(slot.status)}</span>
        </div>
        ${clientInfo}
        <div class="admin-actions">
          ${slot.status === 'pending' ? `
            <button class="btn success" onclick="confirmBooking('${slot.id}')">Подтвердить</button>
            <button class="btn danger" onclick="cancelBooking('${slot.id}')">Отклонить</button>
          ` : ''}
          ${slot.status === 'available' ? `
            <button class="btn danger" onclick="deleteSlot('${slot.id}')">Удалить</button>
          ` : ''}
          ${slot.status === 'booked' ? `
            <button class="btn secondary" onclick="cancelBooking('${slot.id}')">Отменить</button>
          ` : ''}
        </div>
      `;

      container.appendChild(el);
    });
  } catch (e) {
    container.innerHTML = '<div class="loading">Ошибка загрузки</div>';
  }
}

function statusLabel(s) {
  return {
    available: 'свободно',
    pending: 'ожидает оплаты',
    booked: 'записан',
    cancelled: 'отменён'
  }[s] || s;
}

// Add slot
document.getElementById('btn-add-slot').addEventListener('click', async () => {
  const date = document.getElementById('new-slot-date').value;
  const time = document.getElementById('new-slot-time').value;

  if (!date || !time) {
    alert('Укажите дату и время');
    return;
  }

  try {
    const res = await fetch(`${API}/api/admin/slots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken
      },
      body: JSON.stringify({ date, time })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Ошибка');
      return;
    }

    loadAdminSlots();
    document.getElementById('new-slot-date').value = '';
  } catch (e) {
    alert('Ошибка сети');
  }
});

async function confirmBooking(id) {
  await updateSlot(id, { status: 'booked' });
  loadAdminSlots();
}

async function cancelBooking(id) {
  if (!confirm('Отменить эту запись?')) return;
  await updateSlot(id, { status: 'cancelled' });
  loadAdminSlots();
}

async function deleteSlot(id) {
  if (!confirm('Удалить слот?')) return;
  try {
    await fetch(`${API}/api/admin/slots/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': adminToken }
    });
    loadAdminSlots();
  } catch (e) {
    alert('Ошибка');
  }
}

async function updateSlot(id, data) {
  try {
    await fetch(`${API}/api/admin/slots/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken
      },
      body: JSON.stringify(data)
    });
  } catch (e) {
    alert('Ошибка обновления');
  }
}

// Init
showPage('home');
loadSlots();
